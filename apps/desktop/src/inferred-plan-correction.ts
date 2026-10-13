import type { AuthoredPlanRead, CoordinatorHandoffContext } from './team-plan-handoff.js';

/** Plain nudges the hand-off sends a coordinator before an invalid plan escalates to a human. */
export const INFERRED_PLAN_NUDGE_BUDGET = 2;
const MAX_TRACKED_EXECUTIONS = 256;

type ReviewVerdict = Extract<AuthoredPlanRead, { status: 'ok' }> | 'wait' | 'reject' | undefined;

export interface InferredPlanCorrectionDeps {
  /** `PlanCorrectionService.reviewInvalid`: undefined when no correction record exists. */
  reviewInvalid(ctx: CoordinatorHandoffContext, reason: string): Promise<ReviewVerdict>;
  /** `PlanCorrectionService.begin`: opens a correction record for the execution. */
  begin(executionId: string, reason: string, unattended: boolean): Promise<void>;
  nudgeBudget?: number;
}

/**
 * Routes a coordinator-authored (infer) plan that stays invalid into the existing
 * plan-correction flow. The first {@link INFERRED_PLAN_NUDGE_BUDGET} invalid reads
 * pass through so the hand-off can nudge the coordinator to self-repair; the next
 * one opens a correction record and parks the run for the Inbox decision instead
 * of letting the plan-readiness watchdog fail it. Runs that already have a record
 * (provided plans) are reviewed directly.
 */
export function createInferredPlanCorrection(deps: InferredPlanCorrectionDeps) {
  const budget = deps.nudgeBudget ?? INFERRED_PLAN_NUDGE_BUDGET;
  const strikes = new Map<string, number>();
  return {
    async reviewInvalid(ctx: CoordinatorHandoffContext, reason: string): Promise<ReviewVerdict> {
      const verdict = await deps.reviewInvalid(ctx, reason);
      if (verdict !== undefined) return verdict;
      const seen = (strikes.get(ctx.executionId) ?? 0) + 1;
      if (seen <= budget) {
        strikes.delete(ctx.executionId);
        strikes.set(ctx.executionId, seen);
        // Bounded: drop the oldest tracked execution (insertion order) at capacity.
        if (strikes.size > MAX_TRACKED_EXECUTIONS) strikes.delete(strikes.keys().next().value as string);
        return undefined;
      }
      strikes.delete(ctx.executionId);
      await deps.begin(ctx.executionId, reason, false);
      return deps.reviewInvalid(ctx, reason);
    },
    forget(executionId: string): void {
      strikes.delete(executionId);
    }
  };
}
