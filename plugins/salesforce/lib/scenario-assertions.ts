import type { ActionAssertion, AssertionResult, ScenarioCase, TraceStep } from './studio-contract.js';

/** Shared by the form and trusted boundary; reject malformed checks rather than silently dropping them. */
export function parseExtraAssertions(value: unknown): Pick<ScenarioCase['expect'], 'maxLatencyMs' | 'actionChecks' | 'stateChecks'> {
  const row = value as Record<string, unknown>;
  const out: ReturnType<typeof parseExtraAssertions> = {};
  if (row.maxLatencyMs !== undefined) {
    if (!Number.isInteger(row.maxLatencyMs) || Number(row.maxLatencyMs) < 1 || Number(row.maxLatencyMs) > 300_000) throw Error('Maximum response latency must be 1–300000 ms.');
    out.maxLatencyMs = Number(row.maxLatencyMs);
  }
  if (row.actionChecks !== undefined) {
    if (!Array.isArray(row.actionChecks) || row.actionChecks.length > 10) throw Error('Use at most 10 action checks.');
    out.actionChecks = row.actionChecks.map((item): ActionAssertion => {
      const c = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      if (typeof c.action !== 'string' || !/^[A-Za-z_][\w.]{0,159}$/.test(c.action)
        || !['input', 'output'].includes(String(c.side)) || typeof c.field !== 'string' || !/^[\w.[\]-]{1,160}$/.test(c.field)
        || !['equals', 'contains', 'less_than', 'greater_than'].includes(String(c.operator))
        || !(typeof c.value === 'string' && c.value.length <= 200 || typeof c.value === 'number' && Number.isFinite(c.value) || typeof c.value === 'boolean' || c.value === null)
        || (['less_than', 'greater_than'].includes(String(c.operator)) && typeof c.value !== 'number')
        || (c.operator === 'contains' && typeof c.value !== 'string')) throw Error('Each action check needs action, side, field, operator and a scalar value.');
      return { action: c.action, side: c.side as ActionAssertion['side'], field: c.field, operator: c.operator as ActionAssertion['operator'], value: c.value as ActionAssertion['value'] };
    });
  }
  if (row.stateChecks !== undefined) {
    if (!Array.isArray(row.stateChecks) || row.stateChecks.length > 10) throw Error('Use at most 10 state checks.');
    out.stateChecks = row.stateChecks.map(item => {
      const c = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      if (typeof c.variable !== 'string' || !/^[\w.$]{1,160}$/.test(c.variable) || !(typeof c.value === 'string' && c.value.length <= 200 || typeof c.value === 'number' && Number.isFinite(c.value) || typeof c.value === 'boolean' || c.value === null)) throw Error('Each state check needs a variable name and a scalar value.');
      return { variable: c.variable, value: c.value as string | number | boolean | null };
    });
  }
  return out;
}

export const actionCheckLabel = (c: ActionAssertion) => `${c.action} ${c.side}.${c.field} ${c.operator} ${JSON.stringify(c.value)}`;

/** Every invocation must satisfy a check. Redacted, absent or truncated evidence is inconclusive. */
export function extraAssertions(expect: ScenarioCase['expect'], steps: TraceStep[], latencies: Array<number | undefined>, completeTrace = true): AssertionResult[] {
  const results: AssertionResult[] = [];
  if (expect.maxLatencyMs !== undefined) {
    const complete = latencies.length > 0 && latencies.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0);
    const max = Math.max(...latencies.filter((n): n is number => typeof n === 'number'));
    results.push({ label: `Each response ≤ ${expect.maxLatencyMs} ms`, outcome: complete ? max <= expect.maxLatencyMs ? 'pass' : 'fail' : 'inconclusive', actual: complete ? `${max} ms maximum` : 'Response latency unavailable' });
  }
  for (const check of expect.actionChecks ?? []) {
    const calls = steps.filter(s => s.kind === 'action' && s.label === check.action);
    const values = calls.map(s => { const evidence = s.actionEvidence?.[check.side]; return evidence && Object.hasOwn(evidence, check.field) ? evidence[check.field] : undefined; });
    const outcomes = values.map(actual => {
      if (actual === undefined) return 'inconclusive';
      if (check.operator === 'equals') return actual === check.value ? 'pass' : 'fail';
      if (check.operator === 'contains') return typeof actual === 'string' ? actual.includes(String(check.value)) ? 'pass' : 'fail' : 'fail';
      return typeof actual === 'number' && (check.operator === 'less_than' ? actual < Number(check.value) : actual > Number(check.value)) ? 'pass' : 'fail';
    });
    const outcome = outcomes.includes('fail') ? 'fail' : !completeTrace || !calls.length || outcomes.includes('inconclusive') ? 'inconclusive' : 'pass';
    results.push({ label: actionCheckLabel(check), outcome, actual: !calls.length ? 'No action evidence' : values.map(v => v === undefined ? 'Unavailable or redacted' : JSON.stringify(v)).join(', ').slice(0, 240) });
  }
  const state = Object.assign(Object.create(null), ...steps.filter(s => s.kind === 'variable').map(s => s.stateEvidence ?? {})) as Record<string, unknown>;
  for (const check of expect.stateChecks ?? []) {
    const actual = Object.hasOwn(state, check.variable) ? state[check.variable] : undefined;
    results.push({ label: stateCheckLabel(check), outcome: !completeTrace || actual === undefined ? 'inconclusive' : actual === check.value ? 'pass' : 'fail', actual: actual === undefined ? 'Final state unavailable or redacted' : JSON.stringify(actual) });
  }
  return results;
}

export const stateCheckLabel = (c: { variable: string; value: unknown }) => `Final ${c.variable} equals ${JSON.stringify(c.value)}`;
