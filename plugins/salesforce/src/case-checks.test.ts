import { describe, expect, it } from 'vitest';
import { caseChecks, failureReason } from '../lib/case-checks.js';
import type { CaseResult } from '../lib/studio-contract.js';

const expectAll = { topic: 'Quotes', actions: ['Price', 'Submit'], contains: ['quote'], criteria: 'Only reports submission after success' };
const at = { runId: 'r', at: 1 };

describe('caseChecks', () => {
  it('marks every check not run without a result', () => {
    expect(caseChecks(expectAll).map(c => [c.kind, c.state, c.actual])).toEqual([
      ['topic', 'na', 'Not run'], ['action', 'na', 'Not run'], ['action', 'na', 'Not run'], ['contains', 'na', 'Not run'], ['criteria', 'na', 'Not run']
    ]);
    expect(caseChecks({})).toEqual([]);
  });
  it('sets a traced run against each expectation', () => {
    const result: CaseResult = { ...at, outcome: 'fail', notes: ['Action "Submit" not called.', 'Missing text: "quote"', 'AI: claimed submission'], observed: { topics: ['Quotes'], actions: ['Price'], traced: true }, judge: 'fail' };
    expect(caseChecks(expectAll, result).map(c => [c.target, c.state, c.actual])).toEqual([
      ['Quotes', 'ok', 'Routed to Quotes'], ['Price', 'ok', 'Called Price'], ['Submit', 'ko', 'Not called'],
      ['quote', 'ko', 'Not in the reply'], ['Only reports submission after success', 'ko', 'claimed submission']
    ]);
  });
  it('reports the topics a run saw instead of the expected one', () => {
    const result: CaseResult = { ...at, outcome: 'fail', observed: { topics: ['Billing'], actions: [], traced: true } };
    expect(caseChecks({ topic: 'Quotes' }, result)[0]).toMatchObject({ state: 'ko', actual: 'Not entered · saw Billing' });
    expect(caseChecks({ topic: 'Quotes' }, { ...at, outcome: 'fail', notes: ['Topic "Quotes" not entered (saw none).'] })[0]).toMatchObject({ state: 'ko', actual: 'Not entered' });
  });
  it('says when a run had no trace, and reads results saved before evidence was kept', () => {
    const untraced: CaseResult = { ...at, outcome: 'inconclusive', notes: ['Topic/action checks need a Simulate runtime trace.'], observed: { topics: [], actions: [], traced: false } };
    expect(caseChecks({ topic: 'Quotes', contains: ['hi'] }, untraced).map(c => [c.state, c.actual])).toEqual([['na', 'No runtime trace'], ['ok', 'Mentioned']]);
    const legacyPass: CaseResult = { ...at, outcome: 'pass' };
    expect(caseChecks({ topic: 'Quotes', actions: ['Price'], contains: ['x'], criteria: 'c' }, legacyPass).map(c => c.state)).toEqual(['ok', 'ok', 'ok', 'na']);
    const legacyFail: CaseResult = { ...at, outcome: 'fail' };
    expect(caseChecks({ topic: 'Quotes', contains: ['x'], criteria: 'c' }, legacyFail).map(c => [c.state, c.actual])).toEqual([['na', 'Not recorded'], ['na', 'Not recorded'], ['na', 'Not evaluated']]);
    expect(caseChecks({ criteria: 'c' }, { ...at, outcome: 'pass', notes: ['AI: fine'] })[0]).toMatchObject({ state: 'ok', actual: 'fine' });
    expect(caseChecks({ criteria: 'c' }, { ...at, outcome: 'inconclusive', judge: 'inconclusive', notes: ['AI: unsure'] })[0]).toMatchObject({ state: 'na' });
  });
});

describe('failureReason', () => {
  it('joins the notes of a run that did not pass and labels the judge', () => {
    expect(failureReason(undefined)).toBeUndefined();
    expect(failureReason({ ...at, outcome: 'pass', notes: ['AI: ok'] })).toBeUndefined();
    expect(failureReason({ ...at, outcome: 'fail' })).toBeUndefined();
    expect(failureReason({ ...at, outcome: 'fail', notes: ['Action "X" not called.', 'AI: claimed it'] })).toBe('Action "X" not called. Judge: claimed it');
  });
});

it('never infers forbidden action absence from incomplete traces', () => {
  const expectCase = { forbiddenActions: ['Send', '*'] };
  expect(caseChecks(expectCase).map(c => c.state)).toEqual(['na', 'na']);
  const base = { outcome: 'pass' as const, runId: 'r', at: 0, observed: { actions: [], topics: [], traced: true, traceComplete: false } };
  expect(caseChecks(expectCase, base).map(c => c.state)).toEqual(['na', 'na']);
  expect(caseChecks(expectCase, { ...base, observed: { ...base.observed, traceComplete: true } }).map(c => c.state)).toEqual(['ok', 'ok']);
  expect(caseChecks(expectCase, { ...base, observed: { ...base.observed, actions: ['Send'] } }).map(c => c.state)).toEqual(['ko', 'ko']);
  expect(caseChecks({ actions: ['Send'] }, base)[0]).toMatchObject({ state: 'na', actual: 'Incomplete runtime trace' });
});

it('renders deterministic assertion evidence without inventing results for missing checks', () => {
  const checks = { maxLatencyMs: 500, actionChecks: [{ action: 'Credit', side: 'output' as const, field: 'applied', operator: 'equals' as const, value: false }], stateChecks: [{ variable: 'orderExists', value: false }] };
  expect(caseChecks(checks).map(c => [c.kind, c.state, c.actual])).toEqual(Array.from({ length: 3 }, () => ['assertion', 'na', 'Not run']));
  const labels = caseChecks(checks).map(c => c.expected);
  expect(labels).toEqual(['Each response ≤ 500 ms', 'Credit output.applied equals false', 'Final orderExists equals false']);
  const result: CaseResult = { ...at, outcome: 'inconclusive', assertions: [
    { label: labels[0]!, outcome: 'pass', actual: '200 ms maximum' },
    { label: labels[1]!, outcome: 'fail', actual: 'true' }
  ] };
  expect(caseChecks(checks, result).map(c => [c.state, c.actual])).toEqual([['ok', '200 ms maximum'], ['ko', 'true'], ['na', 'Not recorded']]);
});
