import { describe, expect, it } from 'vitest';
import type { OrgCaseResult, OrgTestCase } from '../../../lib/org-tests-contract.js';
import { caseExpectations, caseTopics, filterTestCases, formSummary, metricOf, parseForm, parseList, qualityMetrics, qualityText, resultsByNumber } from './org-cases-model.js';

const tc = (number: number, extra: Partial<OrgTestCase> = {}): OrgTestCase => ({ number, utterance: `u${number}`, conversationHistory: [], contextVariables: [], expectations: [], ...extra });
const topic = (value: string) => ({ name: 'topic_sequence_match', expectedValue: value });

describe('parseForm', () => {
  it('reads JSON and CSV-doubled JSON objects, and leaves anything else as text', () => {
    expect(parseForm(' {"contactId": "003", "n": 2, "ok": true, "list": [1], "none": null} ')).toEqual([['contactId', '003'], ['n', '2'], ['ok', 'true'], ['list', '[1]'], ['none', 'null']]);
    expect(parseForm('{""contactId"": ""003X"", ""billingAccountId"": """"}')).toEqual([['contactId', '003X'], ['billingAccountId', '']]);
    expect(parseForm('{}')).toEqual([]);
    for (const text of ['hello', '{not json}', '[1, 2]', '{"a": 1} and more', '']) expect(parseForm(text)).toBeNull();
  });

  it('summarises a form by its first keys', () => {
    expect(formSummary([])).toBe('{ } Form');
    expect(formSummary([['a', '1']])).toBe('{ } Form · a');
    expect(formSummary([['a', '1'], ['b', '2']])).toBe('{ } Form · a, b');
    expect(formSummary([['a', '1'], ['b', '2'], ['c', '3'], ['d', '4']])).toBe('{ } Form · a, b +2');
  });
});

describe('expectations', () => {
  it('parses action lists in their written forms', () => {
    expect(parseList("['A_One', 'B']")).toEqual(['A_One', 'B']);
    expect(parseList('["A"]')).toEqual(['A']);
    expect(parseList('[]')).toEqual([]);
    expect(parseList(' Bare ')).toEqual(['Bare']);
    expect(parseList(undefined)).toEqual([]);
    expect(parseList('')).toEqual([]);
  });

  it('splits a case into topic, actions, response and the rest, and leaves quality metrics out', () => {
    expect(caseExpectations(tc(1, { expectations: [topic(' Billing '), { name: 'action_sequence_match', expectedValue: "['Lookup']" }, { name: 'bot_response_rating', expectedValue: 'Says hi' }, { name: 'factuality', expectedValue: 'yes' }, { name: 'completeness' }] })))
      .toEqual({ topic: 'Billing', actions: ['Lookup'], response: 'Says hi', other: [{ name: 'factuality', expectedValue: 'yes' }] });
    expect(caseExpectations(tc(2, { expectations: [topic(' '), { name: 'action_sequence_match', expectedValue: '[]' }] }))).toEqual({ topic: undefined, actions: [], other: [] });
    expect(caseExpectations(tc(3))).toEqual({ other: [] });
  });

  it('lists quality metrics once, and topics by case count', () => {
    const cases = [
      tc(1, { expectations: [topic('B'), { name: 'completeness' }, { name: 'coherence' }] }),
      tc(2, { expectations: [topic('A'), { name: 'coherence' }, { name: 'output_latency_milliseconds' }] }),
      tc(3, { expectations: [topic('B')] }),
      tc(4),
      tc(5, { expectations: [topic('C')] }),
    ];
    expect(qualityMetrics(cases)).toEqual(['completeness', 'coherence', 'output_latency_milliseconds']);
    expect(caseTopics(cases)).toEqual([{ topic: 'B', count: 2 }, { topic: 'A', count: 1 }, { topic: 'C', count: 1 }]);
  });
});

describe('filterTestCases', () => {
  const cases = [
    tc(1, { utterance: 'Refund please', expectations: [topic('Billing')] }),
    tc(2, { conversationHistory: [{ role: 'user', message: 'earlier talk' }], expectations: [{ name: 'action_sequence_match', expectedValue: "['Lookup_Order']" }] }),
    tc(3, { contextVariables: [{ name: 'Region', value: 'EU' }], expectations: [{ name: 'bot_response_rating', expectedValue: 'Explains shipping' }] }),
  ];
  const run = (verdicts: Record<number, OrgCaseResult['verdict']>) => resultsByNumber(Object.entries(verdicts).map(([n, verdict]) => ({ number: Number(n), utterance: '', status: 'completed', actions: [], metrics: [], verdict })));

  it('searches every visible part of a case', () => {
    const numbers = (query: string) => filterTestCases(cases, { query }).map(c => c.number);
    expect(numbers('')).toEqual([1, 2, 3]);
    expect(numbers('REFUND')).toEqual([1]);
    expect(numbers('billing')).toEqual([1]);
    expect(numbers('lookup')).toEqual([2]);
    expect(numbers('earlier')).toEqual([2]);
    expect(numbers('shipping')).toEqual([3]);
    expect(numbers('eu')).toEqual([3]);
    expect(numbers('region')).toEqual([3]);
    expect(numbers('nothing')).toEqual([]);
  });

  it('filters by topic and by failures in the run', () => {
    expect(filterTestCases(cases, { topic: 'Billing' }).map(c => c.number)).toEqual([1]);
    expect(filterTestCases(cases, { failedOnly: true, results: run({ 1: 'pass', 2: 'fail', 3: 'error' }) }).map(c => c.number)).toEqual([2, 3]);
    expect(filterTestCases(cases, { failedOnly: true })).toEqual([]);
  });
});

describe('run results', () => {
  it('finds metrics and formats quality scores', () => {
    const row: OrgCaseResult = { number: 4, utterance: '', status: 'completed', actions: [], verdict: 'pass', metrics: [{ name: 'coherence', score: 5, result: null }] };
    expect(resultsByNumber([row]).get(4)).toBe(row);
    expect(resultsByNumber(undefined).size).toBe(0);
    expect(metricOf(row, 'coherence')?.score).toBe(5);
    expect(metricOf(undefined, 'coherence')).toBeUndefined();
    expect(qualityText({ name: 'coherence', score: 5, result: null })).toBe('Coherence 5');
    expect(qualityText({ name: 'conciseness', result: null })).toBe('Conciseness —');
    expect(qualityText({ name: 'output_latency_milliseconds', actual: '3120', result: null })).toBe('Latency 3.1 s');
    expect(qualityText({ name: 'output_latency_milliseconds', score: 900, result: null })).toBe('Latency 0.9 s');
    expect(qualityText({ name: 'output_latency_milliseconds', actual: 'n/a', result: null })).toBe('Latency —');
  });
});
