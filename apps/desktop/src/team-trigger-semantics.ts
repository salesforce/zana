import { normalizeExecutionPlan } from '@zana-ai/zcc-server/services/launch/preflight';
import { hasPortablePlanStep, parsePortablePlan } from '@zana-ai/zcc-server/services/execution/portable-plan';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';

export const NO_PLAN_STEPS_REASON = 'no portable plan steps found';

export interface ResolvedSquadPlan {
  coordinationMode: 'freeform' | 'structured';
  workUnits?: ExecutionWorkUnitInput[];
  planError?: string;
}

type CandidateCheck = { units: ExecutionWorkUnitInput[] } | { reason: string };

function checkCandidatePlan(text: string): CandidateCheck {
  const parsed = parsePortablePlan(text);
  if (!parsed.ok) return { reason: parsed.reason };
  try {
    return { units: normalizeExecutionPlan(parsed.units, true) as ExecutionWorkUnitInput[] };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The single plan-source resolver shared by interactive and triggered Squad launches.
 *
 * - `infer`: a coordinator-led freeform run; nothing is parsed here. An invalid
 *   coordinator-authored plan is reviewed at hand-off time (see
 *   `inferred-plan-correction.ts`).
 * - `provided`: the first candidate text (snapshotted sources, then the inline
 *   goal) that is a complete durable DAG seeds structured work units. When none
 *   is, the launch carries a `planError` — unparseable, incomplete DAG, or prose
 *   with no plan steps — which parks the Squad in the host plan-correction flow.
 *   A provided plan never silently falls through to coordinator repair.
 */
export function resolveSquadPlan(
  planSource: 'provided' | 'infer',
  candidateTexts: readonly (string | undefined)[]
): ResolvedSquadPlan {
  if (planSource !== 'provided') return { coordinationMode: 'freeform' };
  let stepFailure: string | undefined;
  let anyFailure: string | undefined;
  for (const text of candidateTexts) {
    if (typeof text !== 'string' || !text.trim()) continue;
    const checked = checkCandidatePlan(text);
    if ('units' in checked) return { coordinationMode: 'structured', workUnits: checked.units };
    anyFailure ??= checked.reason;
    // Prefer the reason from a candidate that really contains plan steps.
    if (stepFailure === undefined && hasPortablePlanStep(text)) stepFailure = checked.reason;
  }
  return {
    coordinationMode: 'freeform',
    planError: stepFailure ?? anyFailure ?? NO_PLAN_STEPS_REASON
  };
}

/** Triggered (schedule / goal) launches resolve their single objective text. */
export function resolveTriggeredSquadPlan(planSource: 'provided' | 'infer', objective: string): ResolvedSquadPlan {
  return resolveSquadPlan(planSource, [objective]);
}

/** Initial task for an invalid supplied plan must not expose it as executable work. */
export function invalidProvidedPlanHold(role: 'orchestrator' | 'worker'): string {
  return role === 'orchestrator'
    ? 'The supplied execution plan is invalid and awaiting host-managed correction. Do not begin, assign, or perform work from it. End your turn now; the host will send the exact corrected-plan artifact path.'
    : 'The supplied execution plan is invalid and awaiting host-managed correction. Do not begin, assign, or perform work from it. Wait for the coordinator after host approval.';
}
