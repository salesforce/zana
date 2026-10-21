import { expect, it } from 'vitest';
import type { OrgCaseResult, OrgMetricResult, OrgRunRecord, OrgRunResults } from '../../../lib/org-tests-contract.js';
import {
  agentNameFromPath, casesForImport, casesToCsv, changedCases, diffRuns, filterCases, filterDefinitions, fixPrompt, formatDuration, groupDefinitions, metricRates,
  pageOf, sameAgent, passRate, percent, relativeTime, searchCases, sortCases, sparkSeries
} from './org-tests-model.js';

const metric = (extra: Partial<OrgMetricResult> = {}): OrgMetricResult => ({ name: 'topic_sequence_match', expected: 'Billing', actual: 'Billing', result: 'pass', ...extra });
const row = (number: number, verdict: OrgCaseResult['verdict'], extra: Partial<OrgCaseResult> = {}): OrgCaseResult => ({
  number, utterance: `utterance ${number}`, status: 'completed', actions: [], metrics: [metric({ result: verdict === 'pass' ? 'pass' : 'fail' })], verdict, ...extra
});
const run = (cases: OrgCaseResult[], extra: Partial<OrgRunResults> = {}): OrgRunResults => ({
  runId: 'r1', definition: 'Def', orgId: 'o', orgAlias: 'a', status: 'completed', startedAt: 1000, startedBy: 'studio', cases, ...extra
});
const rec = (counts: OrgRunRecord['counts'], extra: Partial<OrgRunRecord> = {}): OrgRunRecord => ({
  runId: 'x', definition: 'Def', orgId: 'o', orgAlias: 'a', status: 'completed', startedAt: 1, startedBy: 'studio', counts, ...extra
});

it('derives the agent name from a path', () => {
  expect(agentNameFromPath('force-app/main/default/aiAuthoringBundles/My_Bot/My_Bot.agent')).toBe('My_Bot');
  expect(agentNameFromPath('a\\b\\aiAuthoringBundles\\X\\X.agent')).toBe('X');
  expect(agentNameFromPath('agents/Other.agent')).toBe('Other');
  expect(agentNameFromPath('notes.txt')).toBeNull();
  expect(agentNameFromPath(null)).toBeNull();
});

it('filters definitions by query and agent', () => {
  const defs = [{ name: 'A1', label: 'Refunds', subjectName: 'MyBot' }, { name: 'B2', subjectName: 'Other' }, { name: 'C3' }];
  expect(filterDefinitions(defs, {})).toHaveLength(3);
  expect(filterDefinitions(defs, { query: ' refund ' }).map(d => d.name)).toEqual(['A1']);
  expect(filterDefinitions(defs, { query: 'other' }).map(d => d.name)).toEqual(['B2']);
  expect(filterDefinitions(defs, { agent: 'mybot' }).map(d => d.name)).toEqual(['A1']);
  expect(filterDefinitions(defs, { agent: 'MyBot', query: 'zzz' })).toEqual([]);
});

it('computes pass rates and sparkline series', () => {
  expect(passRate(undefined)).toBeNull();
  expect(passRate({ total: 3, pass: 0, fail: 0, error: 0, pending: 3 })).toBeNull();
  expect(passRate({ total: 4, pass: 2, fail: 1, error: 1, pending: 0 })).toBe(0.5);
  expect(percent(null)).toBe('—');
  expect(percent(0.756)).toBe('76%');
  const runs = [
    rec({ total: 2, pass: 2, fail: 0, error: 0, pending: 0 }),
    rec({ total: 2, pass: 1, fail: 1, error: 0, pending: 0 }, { status: 'in_progress' }),
    rec(undefined),
    rec({ total: 2, pass: 0, fail: 2, error: 0, pending: 0 })
  ];
  expect(sparkSeries(runs)).toEqual([0, 1]);
  expect(sparkSeries(runs, 1)).toEqual([1]);
});

it('filters, searches, sorts and pages cases', () => {
  const cases = [
    row(1, 'pass', { reply: 'Sure thing', metrics: [metric({ name: 'output_latency_milliseconds', actual: '900', result: null, score: 900 })] }),
    row(2, 'fail', { topic: 'Billing', actions: ['Lookup'], metrics: [metric({ result: 'fail', score: 0.2 }), metric({ name: 'output_latency_milliseconds', actual: '300', result: null })] }),
    row(3, 'error', { metrics: [] }),
    row(4, 'pending', { metrics: [metric({ result: null, score: 0.9 })] })
  ];
  const r = run(cases);
  expect(filterCases(r, 'all').length).toBe(4);
  expect(filterCases(r, 'failing').map(c => c.number)).toEqual([2]);
  expect(filterCases(r, 'passing').map(c => c.number)).toEqual([1]);
  expect(filterCases(r, 'errors').map(c => c.number)).toEqual([3]);
  expect(filterCases(r, 'changed')).toEqual([]);
  expect(searchCases(cases, '').length).toBe(4);
  expect(searchCases(cases, 'LOOKUP').map(c => c.number)).toEqual([2]);
  expect(searchCases(cases, 'sure').map(c => c.number)).toEqual([1]);
  expect(searchCases(cases, 'nothing')).toEqual([]);
  expect(sortCases(cases, 'verdict').map(c => c.number)).toEqual([2, 3, 4, 1]);
  expect(sortCases(cases, 'latency').map(c => c.number)).toEqual([1, 2, 3, 4]);
  expect(sortCases(cases, 'score').map(c => c.number)).toEqual([4, 2, 1, 3]);
  expect(sortCases([...cases].reverse(), 'number').map(c => c.number)).toEqual([1, 2, 3, 4]);
  const many = Array.from({ length: 60 }, (_, i) => i);
  expect(pageOf(many, 0).rows).toHaveLength(25);
  expect(pageOf(many, 2)).toMatchObject({ page: 2, pages: 3 });
  expect(pageOf(many, 2).rows).toHaveLength(10);
  expect(pageOf(many, 99).page).toBe(2);
  expect(pageOf([], -3, 25)).toEqual({ rows: [], page: 0, pages: 1 });
  expect(pageOf(many, Number.NaN).page).toBe(0);
});

it('reports per-metric rates and run diffs', () => {
  const rates = metricRates([
    row(1, 'pass'), row(2, 'fail'),
    row(3, 'pass', { metrics: [metric({ name: 'coherence', result: null, score: 4 }), metric({ name: 'coherence', result: null, score: 2 }), metric({ name: 'x_y', result: null })] })
  ]);
  const topic = rates.find(m => m.name === 'topic_sequence_match')!;
  expect(topic).toMatchObject({ label: 'Topic', pass: 1, fail: 1, rate: 0.5, average: null });
  expect(rates.find(m => m.name === 'coherence')).toMatchObject({ rate: null, average: 3 });
  expect(rates.find(m => m.name === 'x_y')).toMatchObject({ label: 'X y', average: null });

  const before = run([row(1, 'pass'), row(2, 'fail'), row(3, 'error'), row(5, 'pass')]);
  const now = run([row(1, 'fail'), row(2, 'pass'), row(3, 'error'), row(4, 'fail')]);
  const diff = diffRuns(now, before);
  expect(diff.newlyFailing.map(c => c.number)).toEqual([1]);
  expect(diff.fixed.map(c => c.number)).toEqual([2]);
  expect(diffRuns(now, null)).toEqual({ newlyFailing: [], fixed: [] });
  expect(changedCases(now, before).map(c => c.number)).toEqual([1, 2, 4]);
  expect(changedCases(now)).toEqual([]);
  expect(filterCases(now, 'changed', before).length).toBe(3);
});

it('exports CSV with quoting and formula guarding', () => {
  const csv = casesToCsv(run([]), [
    row(1, 'fail', { utterance: 'say "hi", please', reply: 'a\nb', metrics: [metric({ explanation: '=cmd', score: 0.5 })] }),
    row(2, 'pass', { metrics: [], actions: ['A', 'B'] })
  ]);
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe('run,definition,case,verdict,utterance,topic,actions,reply,metric,expected,actual,score,result,explanation');
  expect(csv).toContain('"say ""hi"", please"');
  expect(csv).toContain('"a\nb"');
  expect(csv).toContain("'=cmd");
  expect(csv).toContain('2,pass,utterance 2,,A | B,,,,,,');
  expect(csv.endsWith('\r\n')).toBe(true);
  expect(casesToCsv(run([]), [row(3, 'fail', { metrics: [metric({ score: -0.5, expected: '-1' })] })])).toContain(',-0.5,');
  expect(casesToCsv(run([]), [row(3, 'fail', { metrics: [metric({ expected: '-1' })] })])).toContain("'-1");
});

it('formats relative time and durations', () => {
  const now = 10_000_000_000;
  expect(relativeTime(undefined)).toBe('—');
  expect(relativeTime(now - 10_000, now)).toBe('just now');
  expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 d ago');
  expect(relativeTime(now + 5000, now)).toBe('just now');
  expect(formatDuration({ startedAt: 0, endedAt: 42_000 })).toBe('42s');
  expect(formatDuration({ startedAt: 0, endedAt: 125_000 })).toBe('2m 5s');
  expect(formatDuration({ startedAt: 1000 }, 3000)).toBe('2s');
});

it('selects cases to import and builds the fix prompt', () => {
  const cases = [row(1, 'fail'), row(9, 'fail')];
  const out = casesForImport(cases, [{ number: 1, utterance: 'orig', conversationHistory: [], contextVariables: [], expectations: [{ name: 'x', expectedValue: 'y' }] }]);
  expect(out[0].utterance).toBe('orig');
  expect(out[1]).toMatchObject({ number: 9, utterance: 'utterance 9', expectations: [] });
  expect(casesForImport([cases[0]], undefined)[0].number).toBe(1);

  const long = 'x'.repeat(300);
  const failing = [row(1, 'fail', { utterance: long, metrics: [metric({ result: 'fail', expected: long, actual: 'Other' }), metric({ name: 'coherence', expected: undefined, actual: undefined, result: null, error: 'boom' })] }), row(2, 'error', { metrics: [] }), row(3, 'fail')];
  const prompt = fixPrompt(run([], { subjectName: 'Bot' }), failing, null, 2);
  expect(prompt).toContain('for Bot (run r1, definition Def): 3 cases');
  expect(prompt).toContain('Topic: expected ' + 'x'.repeat(200) + '…, got Other');
  expect(prompt).toContain('Coherence: expected —, got boom');
  expect(prompt).toContain('- #2 "utterance 2" -> error');
  expect(prompt).toContain('(+1 more)');
  expect(fixPrompt(run([]), [failing[1]], 'a/b.agent')).toContain('for a/b.agent (run r1, definition Def): 1 case.');
});

it('groups definitions by agent, pinned first, then by size, with unread agents last', () => {
  const defs = [
    { name: 'A1', subjectName: 'Alpha' }, { name: 'B1', subjectName: 'Beta' }, { name: 'B2', subjectName: 'beta' },
    { name: 'C1', subjectName: 'Gamma' }, { name: 'P1' }, { name: 'U1' },
  ];
  const groups = groupDefinitions(defs, new Set(['P1']));
  expect(groups.map(g => [g.key, g.label, g.state, g.defs.map(d => d.name)])).toEqual([
    ['beta', 'Beta', 'agent', ['B1', 'B2']], ['alpha', 'Alpha', 'agent', ['A1']], ['gamma', 'Gamma', 'agent', ['C1']],
    ['loading', 'Reading agent…', 'loading', ['P1']], ['unknown', 'Agent unknown', 'unknown', ['U1']],
  ]);
  expect(groupDefinitions(defs, new Set(), 'GAMMA').map(g => g.key)).toEqual(['gamma', 'beta', 'alpha', 'unknown']);
  expect(groupDefinitions([], new Set())).toEqual([]);
  expect(sameAgent({ subjectName: 'Beta' }, 'beta')).toBe(true);
  expect(sameAgent({ subjectName: 'Beta' }, null)).toBe(false);
  expect(sameAgent({}, 'beta')).toBe(false);
});
