import { describe, expect, it } from 'vitest';
import { actionEvidence } from '../lib/agentforce-trace.js';
import { extraAssertions, parseExtraAssertions } from '../lib/scenario-assertions.js';
import type { ActionAssertion, TraceStep } from '../lib/studio-contract.js';

const check: ActionAssertion = { action: 'Lookup', side: 'output', field: 'status', operator: 'equals', value: 'Found' };
const action = (value: unknown): TraceStep => ({ kind: 'action', label: 'Lookup', actionEvidence: { input: {}, output: actionEvidence(value) } });
describe('scenario evidence assertions', () => {
  it('preserves valid checks and rejects malformed requests rather than dropping expectations', () => {
    expect(parseExtraAssertions({})).toEqual({});
    expect(parseExtraAssertions({ maxLatencyMs: 1000, actionChecks: [check] })).toEqual({ maxLatencyMs: 1000, actionChecks: [check] });
    for (const maxLatencyMs of [0, -1, 1.2, 300001, '1000', NaN]) expect(() => parseExtraAssertions({ maxLatencyMs })).toThrow(/latency/);
    for (const actionChecks of [{}, Array(11).fill(check), [null], [{ ...check, side: 'bad' }], [{ ...check, action: 'bad name' }], [{ ...check, field: 'path()' }], [{ ...check, operator: 'eval' }], [{ ...check, value: {} }], [{ ...check, value: 'x'.repeat(201) }], [{ ...check, operator: 'less_than' }], [{ ...check, operator: 'contains', value: 1 }]]) expect(() => parseExtraAssertions({ actionChecks })).toThrow();
  });
  it('compares every invocation; failures beat missing evidence', () => {
    const expectCheck = { actionChecks: [check] };
    expect(extraAssertions(expectCheck, [action({ status: 'Found' })], [])[0]?.outcome).toBe('pass');
    expect(extraAssertions(expectCheck, [action({ status: 'Found' }), action({ status: 'Missing' })], [])[0]?.outcome).toBe('fail');
    expect(extraAssertions(expectCheck, [action({ status: 'Missing' }), action({})], [])[0]?.outcome).toBe('fail');
    expect(extraAssertions(expectCheck, [action({ status: 'Found' }), action({})], [])[0]?.outcome).toBe('inconclusive');
    expect(extraAssertions(expectCheck, [], [])[0]?.actual).toBe('No action evidence');
    expect(extraAssertions({ actionChecks: [{ ...check, field: 'constructor' }] }, [action({})], [])[0]?.outcome).toBe('inconclusive');
  });
  it('supports case-sensitive substring and numeric checks with no type coercion', () => {
    const assertions = (operator: ActionAssertion['operator'], value: string | number, actual: unknown) => extraAssertions({ actionChecks: [{ ...check, operator, value }] }, [action({ status: actual })], [])[0]!.outcome;
    expect(assertions('contains', 'ound', 'Found')).toBe('pass');
    expect(assertions('contains', 'found', 'Found')).toBe('fail');
    expect(assertions('contains', '1', 1)).toBe('fail');
    expect(assertions('less_than', 10, 9)).toBe('pass');
    expect(assertions('less_than', 10, 10)).toBe('fail');
    expect(assertions('greater_than', 10, 11)).toBe('pass');
    expect(assertions('greater_than', 10, '11')).toBe('fail');
    expect(assertions('equals', 10, '10')).toBe('fail');
  });
  it('uses maximum per-response latency; unavailable measurements remain inconclusive', () => {
    const run = (latencies: Array<number | undefined>) => extraAssertions({ maxLatencyMs: 1000 }, [], latencies)[0]!;
    expect(run([0, 1000])).toMatchObject({ outcome: 'pass', actual: '1000 ms maximum' });
    expect(run([1001]).outcome).toBe('fail');
    for (const values of [[], [undefined], [1, undefined], [-1], [NaN]]) expect(run(values).outcome).toBe('inconclusive');
  });
  it('bounds and redacts structured evidence without parsing clipped display text', () => {
    const evidence = actionEvidence({ password: 'secret', userEmail: 'private', ok: true, n: 0, nil: null, nested: { a: [1, 2] }, free: 'email me a@b.com', long: 'x'.repeat(201), token: 'hidden', bad: Infinity });
    expect(evidence).toEqual({ ok: true, n: 0, nil: null, 'nested.a[0]': 1, 'nested.a[1]': 2 });
    expect(Object.keys(actionEvidence(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]))))).toHaveLength(12);
    expect(actionEvidence({ a: { b: { c: { d: 1 } } } })).toEqual({});
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(actionEvidence(circular)).toEqual({});
    expect(extraAssertions({ actionChecks: [{ ...check, field: 'password' }] }, [action({ password: 'secret' })], [])[0]?.outcome).toBe('inconclusive');
  });
});

it('cannot pass from partial trace evidence', () => {
  expect(extraAssertions({ actionChecks: [check] }, [action({ status: 'Found' })], [], false)[0]?.outcome).toBe('inconclusive');
});

it('checks read-only credit and cancellation contracts with scalar backend evidence', () => {
  const checks: ActionAssertion[] = [
    { action: 'Credit', side: 'input', field: 'action', operator: 'equals', value: 'CHECK' },
    { action: 'Credit', side: 'output', field: 'applied', operator: 'equals', value: false },
    { action: 'Credit', side: 'output', field: 'promotion', operator: 'equals', value: null },
  ];
  expect(parseExtraAssertions({ actionChecks: checks }).actionChecks).toEqual(checks);
  const steps: TraceStep[] = [{ kind: 'action', label: 'Credit', actionEvidence: { input: { action: 'CHECK' }, output: { applied: false, promotion: null } } }];
  expect(extraAssertions({ actionChecks: checks }, steps, []).map(r => r.outcome)).toEqual(['pass', 'pass', 'pass']);
});

it('checks final variable state without guessing from partial or redacted updates', () => {
  const stateChecks = [{ variable: 'orderExists', value: false }];
  expect(parseExtraAssertions({ stateChecks }).stateChecks).toEqual(stateChecks);
  const steps: TraceStep[] = [{ kind: 'variable', label: 'orderExists', stateEvidence: { orderExists: true } }, { kind: 'variable', label: 'orderExists', stateEvidence: { orderExists: false } }];
  expect(extraAssertions({ stateChecks }, steps, [])[0]).toMatchObject({ outcome: 'pass', actual: 'false' });
  expect(extraAssertions({ stateChecks }, steps.slice(0, 1), [])[0]?.outcome).toBe('fail');
  expect(extraAssertions({ stateChecks }, steps, [], false)[0]?.outcome).toBe('inconclusive');
  expect(extraAssertions({ stateChecks }, [], [])[0]?.outcome).toBe('inconclusive');
  for (const invalid of [{}, Array(11).fill(stateChecks[0]), [null], [{ variable: 'bad()', value: 1 }], [{ variable: 'ok', value: {} }], [{ variable: 'ok', value: Infinity }]]) expect(() => parseExtraAssertions({ stateChecks: invalid })).toThrow(/state check/);
});
