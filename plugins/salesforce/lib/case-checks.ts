import type { CaseOutcome, CaseResult, ScenarioCase } from './studio-contract.js';
import { actionCheckLabel, stateCheckLabel } from './scenario-assertions.js';

/**
 * One expectation of a scenario case set against what its last Simulate run
 * saw. Shared by the Tests pane (Expected vs Actual) and the conversation map
 * (which nodes a case reached, which it missed). Pure, so the playground can
 * import it too.
 */
export type CheckState = 'ok' | 'ko' | 'na';
export interface CaseCheck { kind: 'topic' | 'action' | 'contains' | 'criteria' | 'assertion' | 'forbidden'; target: string; expected: string; actual: string; state: CheckState }

const NO_TRACE = 'Topic/action checks need a Simulate runtime trace.';
const quoted = (value: string) => `"${value}"`;
const STATE: Record<CaseOutcome, CheckState> = { pass: 'ok', fail: 'ko', inconclusive: 'na' };

/** Whether the judge ran at all: an error during the run leaves only its message in the notes. */
function judged(result: CaseResult): boolean {
  return Boolean(result.observed) || result.outcome === 'pass';
}

function reached(kind: 'topic' | 'action', name: string, result: CaseResult | undefined): Pick<CaseCheck, 'actual' | 'state'> {
  if (!result) return { actual: 'Not run', state: 'na' };
  const notes = result.notes ?? [];
  const missed = kind === 'topic' ? notes.find(note => note.startsWith(`Topic "${name}" not entered`)) : notes.find(note => note === `Action "${name}" not called.`);
  const seen = kind === 'topic' ? result.observed?.topics : result.observed?.actions;
  if (result.observed?.traceComplete === false) return { actual: 'Incomplete runtime trace', state: 'na' };
  if (missed || (result.observed?.traced && !seen?.includes(name))) {
    const others = kind === 'topic' && seen?.length ? ` · saw ${seen.join(', ')}` : '';
    return { actual: `${kind === 'topic' ? 'Not entered' : 'Not called'}${others}`, state: 'ko' };
  }
  if (result.observed?.traced || (result.outcome === 'pass' && !notes.includes(NO_TRACE))) return { actual: kind === 'topic' ? `Routed to ${name}` : `Called ${name}`, state: 'ok' };
  return { actual: notes.includes(NO_TRACE) || result.observed ? 'No runtime trace' : 'Not recorded', state: 'na' };
}

export function caseChecks(expect: ScenarioCase['expect'], result?: CaseResult): CaseCheck[] {
  const checks: CaseCheck[] = [];
  if (expect.topic) checks.push({ kind: 'topic', target: expect.topic, expected: `Routes to ${expect.topic}`, ...reached('topic', expect.topic, result) });
  for (const action of expect.actions ?? []) checks.push({ kind: 'action', target: action, expected: `Calls ${action}`, ...reached('action', action, result) });
  for (const action of expect.forbiddenActions ?? []) {
    const seen = result?.observed?.actions ?? [];
    const called = action === '*' ? seen.length > 0 : seen.includes(action);
    checks.push({ kind: 'forbidden', target: action, expected: `Never calls ${action}`, actual: !result ? 'Not run' : called ? `Called ${action === '*' ? seen.join(', ') : action}` : result.observed?.traced && result.observed.traceComplete === true ? 'Not called' : 'Complete runtime trace unavailable', state: called ? 'ko' : result?.observed?.traced && result.observed.traceComplete === true ? 'ok' : 'na' });
  }
  for (const text of expect.contains ?? []) {
    const missing = result?.notes?.includes(`Missing text: ${quoted(text)}`);
    checks.push({
      kind: 'contains', target: text, expected: `Mentions ${quoted(text)}`,
      ...(!result ? { actual: 'Not run', state: 'na' as const } : missing ? { actual: 'Not in the reply', state: 'ko' as const } : judged(result) ? { actual: 'Mentioned', state: 'ok' as const } : { actual: 'Not recorded', state: 'na' as const })
    });
  }
  if (expect.criteria) {
    const reason = result?.notes?.find(note => note.startsWith('AI: '))?.slice(4);
    const state: CheckState = !result ? 'na' : result.judge ? STATE[result.judge] : reason && result.outcome === 'pass' ? 'ok' : 'na';
    checks.push({ kind: 'criteria', target: expect.criteria, expected: `AI opinion: ${expect.criteria}`, actual: !result ? 'Not run' : reason ?? 'Not evaluated', state });
  }
  const labels = [...(expect.maxLatencyMs !== undefined ? [`Each response ≤ ${expect.maxLatencyMs} ms`] : []), ...(expect.actionChecks?.map(actionCheckLabel) ?? []), ...(expect.stateChecks?.map(stateCheckLabel) ?? [])];
  for (const label of labels) {
    const evidence = result?.assertions?.find(a => a.label === label);
    checks.push({ kind: 'assertion', target: label, expected: label, actual: evidence?.actual ?? (result ? 'Not recorded' : 'Not run'), state: evidence ? STATE[evidence.outcome] : 'na' });
  }
  return checks;
}

/** Why a run did not pass, in one line: judge notes first, the AI reason labelled. */
export function failureReason(result: CaseResult | undefined): string | undefined {
  if (!result || result.outcome === 'pass' || !result.notes?.length) return undefined;
  return result.notes.map(note => note.startsWith('AI: ') ? `Judge: ${note.slice(4)}` : note).join(' ');
}
