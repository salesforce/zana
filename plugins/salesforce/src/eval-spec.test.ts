import { describe, expect, it } from 'vitest';
import { EvalSpecError, GENERATED_SPEC_MARKER, evalCaseOutcomes, evalSpecCases, readYaml, suiteToEvalSpec, yamlScalar } from '../lib/eval-spec.js';
import { parseEvalSpec } from '../lib/agent.js';
import { parseScenarioCases } from '../lib/scenario-suites.js';
import type { ScenarioCase } from '../lib/studio-contract.js';

const cases: ScenarioCase[] = [
  { id: 'refund', name: 'Refund', utterances: ['I want a "refund"'], expect: { topic: 'Billing', actions: ['IssueRefund', 'LogCase'], contains: ['refund'], criteria: 'Offers a refund.' } },
  { id: 'greet', name: 'Greet', utterances: ['Hi', 'Where is my order?'], expect: {} }
];

describe('suiteToEvalSpec', () => {
  it('writes the sf agent test YAML and names multi-turn cases', () => {
    const { text, multiTurn } = suiteToEvalSpec(cases, { apiName: 'MyBot', name: 'MyBot', from: 'tests/MyBot.scenario.json' });
    expect(text.startsWith(`${GENERATED_SPEC_MARKER} from tests/MyBot.scenario.json.`)).toBe(true);
    expect(text).toContain('subjectType: AGENT\nsubjectName: "MyBot"\ntestCases:\n  - utterance: "I want a \\"refund\\""\n    expectedTopic: "Billing"\n    expectedActions:\n      - "IssueRefund"\n      - "LogCase"\n');
    expect(text).toContain('expectedOutcome: "Offers a refund. The reply mentions \\"refund\\"."');
    expect(text).toContain('  - utterance: "Hi"\n');
    expect(multiTurn).toEqual(['greet']);
    expect(parseEvalSpec(text)).toEqual({ ok: true, format: 'yaml', testCount: 2 });
  });

  it('round-trips through the importer', () => {
    const { text } = suiteToEvalSpec(cases, { apiName: 'MyBot', name: 'MyBot', from: 'x' });
    const back = parseScenarioCases(evalSpecCases(text));
    expect(back[0]).toEqual({
      id: 'i-want-a-refund', name: 'I want a "refund"', utterances: ['I want a "refund"'],
      expect: { topic: 'Billing', actions: ['IssueRefund', 'LogCase'], criteria: 'Offers a refund. The reply mentions "refund".' }
    });
    expect(back[1]).toMatchObject({ id: 'hi', utterances: ['Hi'], expect: {} });
  });
});

describe('readYaml', () => {
  it('reads mappings, lists, quoted and block scalars', () => {
    expect(readYaml([
      '---',
      '# comment',
      'name: Suite # trailing',
      "title: 'It''s here'",
      'empty:',
      'nothing: ~',
      'flow: [a, "b, c", \'d\']',
      'items:',
      '- plain',
      '-',
      '  nested: yes',
      '- key: 1',
      '  other: two',
      'literal: |',
      '  line one',
      '',
      '  line two',
      'folded: >-',
      '  joined',
      '  words',
      '',
      '  next',
      'deep:',
      '  inner:',
      '    - x'
    ].join('\n'))).toEqual({
      name: 'Suite', title: "It's here", empty: null, nothing: null, flow: ['a', 'b, c', 'd'],
      items: ['plain', { nested: 'yes' }, { key: '1', other: 'two' }],
      literal: 'line one\n\nline two', folded: 'joined words\nnext', deep: { inner: ['x'] }
    });
    expect(readYaml('')).toBeNull();
    expect(readYaml('- a\n- \n- b')).toEqual(['a', null, 'b']);
  });

  it('reads escapes and rejects broken input', () => {
    expect(yamlScalar('"a\\nb"')).toBe('a\nb');
    expect(yamlScalar('"bad \\x escape"')).toBe('bad \\x escape');
    expect(yamlScalar('null')).toBeNull();
    expect(() => yamlScalar('"open')).toThrow(EvalSpecError);
    expect(() => yamlScalar('[a, b')).toThrow(/Unclosed list/);
    expect(() => readYaml('a: 1\n  b: 2')).toThrow(/line 2/);
    expect(() => readYaml('just words')).toThrow(/line 1/);
  });
});

describe('evalSpecCases', () => {
  it('reads scenario suites, eval lists, AiEvaluationDefinition rows and bare utterances', () => {
    expect(evalSpecCases(JSON.stringify({ cases: [{ id: 'a', name: 'A', utterances: ['x'], expect: {} }, { id: 'a', name: 'B', utterances: ['y'], expect: {} }] })).map(row => row.id)).toEqual(['a', 'a-2']);
    expect(evalSpecCases(JSON.stringify({
      tests: [{ name: 'Lookup', inputs: { utterance: 'Find order 1' }, expectation: [
        { name: 'topic_sequence_match', expectedValue: 'Orders' },
        { name: 'action_sequence_match', expectedValue: "['Lookup','Log']" },
        { name: 'bot_response_rating', expectedValue: 'Gives the status.' }
      ] }]
    }))).toEqual([{ id: 'lookup', name: 'Lookup', utterances: ['Find order 1'], expect: { topic: 'Orders', actions: ['Lookup', 'Log'], criteria: 'Gives the status.' } }]);
    expect(evalSpecCases(JSON.stringify({ utterances: ['Hello', 'Bye'] })).map(row => row.utterances)).toEqual([['Hello'], ['Bye']]);
    expect(evalSpecCases(JSON.stringify([{ utterance: 'Q', expectedActions: 'One', contains: ['a'], conversationHistory: [{ role: 'user', message: 'Earlier' }, { role: 'agent', message: 'skip' }] }]))[0])
      .toMatchObject({ utterances: ['Earlier', 'Q'], expect: { actions: ['One'], contains: ['a'] } });
    expect(evalSpecCases('testCases:\n  - utterance: 7\n  - expectedTopic: X')[1]).toMatchObject({ id: 'case-2', name: 'Case 2', utterances: [], expect: { topic: 'X' } });
  });

  it('refuses empty, oversized, invalid and overlong specs', () => {
    expect(() => evalSpecCases('  ')).toThrow('The spec is empty.');
    expect(() => evalSpecCases('x'.repeat(256_001))).toThrow(/256 KB/);
    expect(() => evalSpecCases('{ nope')).toThrow('The spec is not valid JSON.');
    expect(() => evalSpecCases('name: Only')).toThrow(/non-empty cases/);
    expect(() => evalSpecCases(JSON.stringify({ utterances: Array.from({ length: 51 }, (_, i) => `u${i}`) }))).toThrow(/at most 50/);
  });
});

describe('evalCaseOutcomes', () => {
  it('maps per-case results by position', () => {
    expect(evalCaseOutcomes({ testCases: [{ status: 'PASS' }, { result: 'FAILURE' }, { passed: true }] }, 4)).toEqual(['pass', 'fail', 'pass', 'inconclusive']);
    expect(evalCaseOutcomes({ result: { tests: [{ testResults: [{ result: 'PASS' }, { result: 'FAIL' }] }, { evaluations: [{ status: 'passed' }] }, { evaluations: [{ status: 'pending' }] }, {}] } }, 4))
      .toEqual(['fail', 'pass', 'inconclusive', 'inconclusive']);
    expect(evalCaseOutcomes({ data: { results: [{ success: false }] } }, 1)).toEqual(['fail']);
    expect(evalCaseOutcomes({ success: true, passedCount: 1 }, 1)).toBeNull();
    expect(evalCaseOutcomes(null, 1)).toBeNull();
  });
});
