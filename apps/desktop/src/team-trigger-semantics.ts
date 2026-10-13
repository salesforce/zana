import { normalizeExecutionPlan } from '@zana-ai/zcc-server/services/launch/preflight';
import { hasPortablePlanStep, parsePortablePlan } from '@zana-ai/zcc-server/services/execution/portable-plan';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';

function seedProvidedPlanWorkUnits(objective: string): ExecutionWorkUnitInput[] | undefined {
  const parsed = parsePortablePlan(objective);
  if (!parsed.ok || parsed.units.length === 0) return undefined;
  try {
    return normalizeExecutionPlan(parsed.units, true) as ExecutionWorkUnitInput[];
  } catch {
    return undefined;
  }
}

function providedPlanFailure(objective: string): string | undefined {
  if (!hasPortablePlanStep(objective)) return undefined;
  const parsed = parsePortablePlan(objective);
  if (!parsed.ok) return parsed.reason;
  try {
    normalizeExecutionPlan(parsed.units, true);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

/**
 * Inferred objectives start a coordinator-led freeform run. A supplied plan earns
 * structured dispatch only after host validation produces a complete durable DAG.
 */
export function resolveTriggeredSquadPlan(planSource: 'provided' | 'infer', objective: string): {
  coordinationMode: 'freeform' | 'structured';
  workUnits?: ExecutionWorkUnitInput[];
  planError?: string;
} {
  const workUnits = planSource === 'provided' ? seedProvidedPlanWorkUnits(objective) : undefined;
  return {
    coordinationMode: workUnits ? 'structured' : 'freeform',
    ...(workUnits ? { workUnits } : {}),
    ...(!workUnits && planSource === 'provided'
      ? { planError: providedPlanFailure(objective) }
      : {})
  };
}

/** Initial task for an invalid supplied plan must not expose it as executable work. */
export function invalidProvidedPlanHold(role: 'orchestrator' | 'worker'): string {
  return role === 'orchestrator'
    ? 'The supplied execution plan is invalid and awaiting host-managed correction. Do not begin, assign, or perform work from it. End your turn now; the host will send the exact corrected-plan artifact path.'
    : 'The supplied execution plan is invalid and awaiting host-managed correction. Do not begin, assign, or perform work from it. Wait for the coordinator after host approval.';
}
