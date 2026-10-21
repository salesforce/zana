import { describe, expect, it } from 'vitest';
import { CONTEXT_TYPES, parsePreviewContext } from '../lib/preview-context.js';
import { discoverPreviewContext } from '../lib/preview-context-source.js';
import { parseAgentInput, previewArgs } from '../lib/agent.js';
import { validateUiCommandInput } from '../lib/ui-command-input.js';
import { caseFromRun, exportRunPayload } from './app/agentforce-preview-logic.js';
import { parseScenarioCases } from '../lib/scenario-suites.js';
import { suiteToEvalSpec } from '../lib/eval-spec.js';

const variable = (type = 'Text', value: unknown = '') => ({ name: '$Context.sessionId', type, value });
describe('preview context contract', () => {
  it('keeps empty text, false, zero, null and structured values distinct, and detaches the snapshot', () => {
    expect(parsePreviewContext(undefined)).toEqual([]);
    const values = ['', false, 0, '2026-10-20', '2026-10-20T08:00:00Z', { name: 'Case', nil: null }, [], [], '12.00', '001fake'];
    const rows = CONTEXT_TYPES.map((type, i) => ({ name: `v${i}`, type, value: values[i] }));
    const parsed = parsePreviewContext(rows);
    expect(parsed).toEqual(rows);
    (values[5] as { name: string }).name = 'Changed';
    expect(parsed[5]!.value).toEqual({ name: 'Case', nil: null });
    for (const type of CONTEXT_TYPES) expect(parsePreviewContext([variable(type, null)])[0]!.value).toBeNull();
  });
  it('rejects malformed, duplicate, oversize and non-JSON inputs before a run can start', () => {
    for (const value of [null, {}, [null], [[]], [variable('Text', 4)], [variable('Boolean', 'false')], [variable('Number', Infinity)], [variable('Money', 2)],
      [variable('Date', 'later')], [variable('DateTime', 'today')], [variable('Json', [])], [variable('List', {})], [variable('Object', {})], [variable('Unknown')],
      [{ ...variable(), name: '../secret' }], [{ ...variable(), name: '' }], [variable(), variable()], Array(101).fill(variable()), [variable('Text', 'é'.repeat(33_000))],
      [variable('Json', { bad: undefined })], [variable('Json', { bad: NaN })], [variable('Json', new Date())], [variable('Json', { bad: 1n })]]) {
      expect(() => parsePreviewContext(value), JSON.stringify(value, (_, v) => typeof v === 'bigint' ? 'bigint' : v)).toThrow();
    }
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => parsePreviewContext([variable('Json', cycle)])).toThrow('JSON');
    let deep: unknown = null; for (let i = 0; i < 22; i++) deep = { nested: deep };
    expect(() => parsePreviewContext([variable('Json', deep)])).toThrow('20 levels');
  });
  it('passes typed JSON as one CLI argument only on start and validates Codex/UI inputs', () => {
    const contextVariables = [variable('Boolean', false), { name: 'retryCount', type: 'Number', value: 0 }];
    const parsed = parseAgentInput({ action: 'preview.start', path: 'force-app/A.agent', contextVariables });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const args = previewArgs('start', parsed.plan, 'dev', { flag: 'authoring-bundle', apiName: 'A' });
    expect(JSON.parse(args[args.indexOf('--context-variables-json') + 1]!)).toEqual(contextVariables);
    expect(previewArgs('send', parsed.plan, 'dev')).not.toContain('--context-variables-json');
    expect(parseAgentInput({ action: 'preview.send', contextVariables }).ok).toBe(false);
    expect(parseAgentInput({ action: 'preview.start', path: 'a.agent', contextVariables: [variable('Number', '0')] }).ok).toBe(false);
    expect(validateUiCommandInput('preview.start', { engine: 'simulate', contextVariables })).toBeUndefined();
    expect(validateUiCommandInput('preview.start', { contextVariables: {} })).toContain('array');
    expect(validateUiCommandInput('preview.start', { presetId: 'p-1' })).toBeUndefined();
    expect(validateUiCommandInput('preview.start', { presetId: 'p-1', contextVariables })).toContain('not both');
    expect(validateUiCommandInput('preview.start', { presetId: 'bad id!' })).toContain('not both');
    expect(validateUiCommandInput('preview.start', { scenario: 'x' })).toContain('accepts only');
  });
  it('validates context.set: values or a preset, merge only with values', () => {
    const values = [variable('Boolean', true)];
    expect(validateUiCommandInput('context.set', { values })).toBeUndefined();
    expect(validateUiCommandInput('context.set', { values, merge: true })).toBeUndefined();
    expect(validateUiCommandInput('context.set', { presetId: 'p-1' })).toBeUndefined();
    expect(validateUiCommandInput('context.set', {})).toBeDefined();
    expect(validateUiCommandInput('context.set', { values, presetId: 'p-1' })).toBeDefined();
    expect(validateUiCommandInput('context.set', { presetId: 'p-1', merge: true })).toBeDefined();
    expect(validateUiCommandInput('context.set', { values, merge: 'yes' })).toBeDefined();
    expect(validateUiCommandInput('context.set', { presetId: 'bad id!' })).toBeDefined();
    expect(validateUiCommandInput('context.set', { values, extra: 1 })).toBeDefined();
    expect(validateUiCommandInput('context.set', { values: [variable('Number', '0')] })).toBeDefined();
  });
  it('preserves the applied snapshot in saved scenarios and JSON exports', () => {
    const contextVariables = [variable('Boolean', false)];
    const run = { runId: 'r', at: 1, file: 'a.agent', engine: 'simulate' as const, turns: [{ role: 'user' as const, text: 'hi' }], traces: {}, contextVariables };
    const saved = caseFromRun(run, 'A');
    expect(parseScenarioCases([saved])[0]!.contextVariables).toEqual(contextVariables);
    expect(exportRunPayload(run).contextVariables).toEqual(contextVariables);
    expect(saved.contextVariables).not.toBe(contextVariables);
    expect(() => suiteToEvalSpec([saved], { apiName: 'A', name: 'A', from: 'tests/A.scenario.json' })).toThrow('would lose');
  });
});

describe('Agent Script context discovery', () => {
  it('uses AST declarations and hides internal state, comments and instructions', () => {
    const fields = discoverPreviewContext(`# @dialect:agentforce
variables:
  sessionId: linked string
    source: @MessagingSession.Id
    label: "Session"
    description: "Session identifier"
  locale: mutable string = "en"
    visibility: "External"
  verified: mutable boolean = False
    visibility: "External"
  count: mutable number = 0
    visibility: "External"
  details: mutable object
    visibility: "External"
  items: mutable list[string]
    visibility: "External"
  date: mutable date
    visibility: "External"
  recordId: linked id
  hidden: mutable string
# other: linked string
topic main:
  reasoning:
    instructions: |
      variables:
        fake: linked string
`);
    expect(fields.map(f => [f.name, f.type])).toEqual([['$Context.sessionId', 'Text'], ['locale', 'Text'], ['verified', 'Boolean'], ['count', 'Number'], ['details', 'Json'], ['items', 'List'], ['date', 'Date'], ['$Context.recordId', 'Ref']]);
    expect(fields[0]).toMatchObject({ label: 'Session', source: '@MessagingSession.Id', description: 'Session identifier' });
    expect(fields[1]!.defaultValue).toBe('en');
    expect(fields[2]!.defaultValue).toBe(false);
    expect(discoverPreviewContext('config:\n  agent_name: "A"')).toEqual([]);
  });
  it('bounds the source and discovered fields', () => {
    expect(() => discoverPreviewContext('x'.repeat(10 * 1024 * 1024 + 1))).toThrow('too large');
    expect(discoverPreviewContext(`variables:\n${Array.from({ length: 102 }, (_, i) => `  var${i}: linked string`).join('\n')}`)).toHaveLength(100);
  });
});
