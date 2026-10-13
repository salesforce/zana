import { parsePortablePlan } from '@zana-ai/zcc-server/services/execution/portable-plan';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';
import { launchDigest } from '@zana-ai/zcc-server/services/launch/digest';
import { normalizeExecutionPlan } from '@zana-ai/zcc-server/services/launch/preflight';
import { InboxActionOperatorError } from './inbox-actions/registry.js';
import type { CoordinatorHandoffContext } from './team-plan-handoff.js';

/** Minimal schedule shape needed to decide whether a correction may rewrite it. */
interface ScheduleRef { projectId: string; kind?: string; prompt?: string }

export interface ScheduledPromptDeps {
  getExecution(projectId: string, executionId: string): Promise<{ launchRequestId?: string; request?: { objective?: string } } | undefined>;
  /** Throws when the schedule no longer exists. */
  getSchedule(scheduleId: string): ScheduleRef;
  /** Confined read of the corrected-plan artifact for this execution. */
  readCorrectedPlanText(projectRoot: string, executionId: string): Promise<string | undefined>;
  /** `expectedPrompt` is a compare-and-swap guard enforced by the scheduler at
   *  its write boundary; a mismatch rejects with `code: 'DEFINITION_CONFLICT'`. */
  updateSchedule(scheduleId: string, patch: { prompt: string; expectedPrompt: string }): Promise<unknown>;
  /** Goal-triggered Squads; throws when the goal no longer exists. */
  getGoal?(goalId: string): GoalRef;
  /** `expectedStatement` is the goal manager's compare-and-swap guard. */
  updateGoal?(goalId: string, patch: { statement: string; expectedStatement: string }): Promise<unknown>;
}

/** Minimal goal shape needed to decide whether a correction may rewrite it. */
interface GoalRef { projectId: string; assignment?: { kind?: string }; planSource?: string; statement?: string }

/**
 * Scheduler launch ids are `schedule:<schedule-id>:<run-id>`. Returns the
 * schedule id, undefined for non-scheduled launches, and throws for a malformed
 * scheduled id.
 */
export function parseScheduledLaunchRequestId(requestId: string | undefined): string | undefined {
  if (!requestId?.startsWith('schedule:')) return undefined;
  const separator = requestId.lastIndexOf(':');
  const scheduleId = requestId.slice('schedule:'.length, separator);
  if (!scheduleId || separator === 'schedule:'.length) throw new Error('invalid scheduled Squad launch request');
  return scheduleId;
}

/**
 * Goal launch ids are `goal:<goal-id>:<iteration-id>`. Returns the goal id,
 * undefined for non-goal launches, and throws for a malformed goal id.
 */
export function parseGoalLaunchRequestId(requestId: string | undefined): string | undefined {
  if (!requestId?.startsWith('goal:')) return undefined;
  const separator = requestId.lastIndexOf(':');
  const goalId = requestId.slice('goal:'.length, separator);
  if (!goalId || separator === 'goal:'.length) throw new Error('invalid goal Squad launch request');
  return goalId;
}

const SCHEDULE_EDITED = 'the schedule prompt was edited since this run launched; review the schedule before approving the correction';
const GOAL_EDITED = 'the goal plan was edited since this run launched; review the goal before approving the correction';

/** ScheduleConflictError / GoalConflictError, matched structurally across the package seam. */
function isDefinitionConflict(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'DEFINITION_CONFLICT';
}

/** Run a guarded write; translate a compare-and-swap conflict into the operator message. */
async function guardedWrite(write: () => Promise<unknown>, editedMessage: string): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (isDefinitionConflict(error)) throw new InboxActionOperatorError(editedMessage);
    throw error;
  }
}

function digestOfPlanText(text: string): string | undefined {
  try {
    const parsed = parsePortablePlan(text);
    if (!parsed.ok) return undefined;
    return launchDigest(normalizeExecutionPlan(parsed.units, true) as ExecutionWorkUnitInput[]);
  } catch {
    return undefined;
  }
}

/**
 * True when the stored definition text already is the approved corrected plan.
 * A previous approval can write back and then fail to persist its own approval;
 * the re-approval must succeed instead of tripping the edit fence on its own write.
 */
async function alreadyApplied(
  deps: Pick<ScheduledPromptDeps, 'readCorrectedPlanText'>,
  ctx: CoordinatorHandoffContext,
  approvedUnits: readonly ExecutionWorkUnitInput[],
  current: string | undefined
): Promise<boolean> {
  const stored = current?.trim();
  if (!stored) return false;
  const corrected = (await deps.readCorrectedPlanText(ctx.projectRoot, ctx.executionId))?.trim();
  return corrected === stored && digestOfPlanText(corrected) === launchDigest(approvedUnits as ExecutionWorkUnitInput[]);
}

/**
 * Persist an approved corrected plan back into the recurring schedule. No-op for
 * non-scheduled executions; throws (so approval is rejected) when the execution
 * is gone, the schedule cannot safely take the correction, the schedule prompt
 * was edited since launch, or the artifact no longer matches the approved units.
 */
export async function updateScheduledPromptFromCorrection(
  deps: ScheduledPromptDeps,
  ctx: CoordinatorHandoffContext,
  approvedUnits: readonly ExecutionWorkUnitInput[]
): Promise<void> {
  const execution = await deps.getExecution(ctx.projectId, ctx.executionId);
  if (!execution) throw new InboxActionOperatorError('execution not found; cannot update the scheduled Squad');
  const goalId = parseGoalLaunchRequestId(execution.launchRequestId);
  if (goalId) return updateGoalStatementFromCorrection(deps, ctx, approvedUnits, execution, goalId);
  const scheduleId = parseScheduledLaunchRequestId(execution.launchRequestId);
  if (!scheduleId) return;
  const schedule = deps.getSchedule(scheduleId);
  if (schedule.projectId !== ctx.projectId || schedule.kind !== 'team') throw new InboxActionOperatorError('scheduled Squad no longer matches this correction');
  // The run was launched with the (trimmed) schedule prompt as its objective. A
  // different prompt now means the user edited the schedule during review; do
  // not overwrite their edit.
  const launched = execution.request?.objective?.trim();
  if (!launched || schedule.prompt?.trim() !== launched) {
    if (await alreadyApplied(deps, ctx, approvedUnits, schedule.prompt)) return;
    throw new InboxActionOperatorError(SCHEDULE_EDITED);
  }
  const prompt = await deps.readCorrectedPlanText(ctx.projectRoot, ctx.executionId);
  if (!prompt?.trim()) throw new InboxActionOperatorError('corrected plan artifact is unavailable');
  // The service verified the digest of the units the operator approved; the
  // text persisted here must parse to exactly those units.
  if (digestOfPlanText(prompt) !== launchDigest(approvedUnits as ExecutionWorkUnitInput[])) {
    throw new InboxActionOperatorError('corrected plan changed after approval; renewed approval is required');
  }
  // The fence above is advisory (it read a snapshot); the scheduler re-checks
  // `expectedPrompt` against the owner's record inside its serialized write.
  await guardedWrite(() => deps.updateSchedule(scheduleId, { prompt, expectedPrompt: launched }), SCHEDULE_EDITED);
}

async function updateGoalStatementFromCorrection(
  deps: ScheduledPromptDeps,
  ctx: CoordinatorHandoffContext,
  approvedUnits: readonly ExecutionWorkUnitInput[],
  execution: { request?: { objective?: string } },
  goalId: string
): Promise<void> {
  if (!deps.getGoal || !deps.updateGoal) throw new InboxActionOperatorError('goal updates are unavailable; cannot update the goal Squad');
  const goal = deps.getGoal(goalId);
  if (goal.projectId !== ctx.projectId || goal.assignment?.kind !== 'team' || goal.planSource !== 'provided') {
    throw new InboxActionOperatorError('goal Squad no longer matches this correction');
  }
  // A provided-plan goal launches with its raw statement as the objective; a
  // different statement now means the user edited the goal during review.
  const launched = execution.request?.objective?.trim();
  if (!launched || goal.statement?.trim() !== launched) {
    if (await alreadyApplied(deps, ctx, approvedUnits, goal.statement)) return;
    throw new InboxActionOperatorError(GOAL_EDITED);
  }
  const plan = await deps.readCorrectedPlanText(ctx.projectRoot, ctx.executionId);
  if (!plan?.trim()) throw new InboxActionOperatorError('corrected plan artifact is unavailable');
  if (digestOfPlanText(plan) !== launchDigest(approvedUnits as ExecutionWorkUnitInput[])) {
    throw new InboxActionOperatorError('corrected plan changed after approval; renewed approval is required');
  }
  const updateGoal = deps.updateGoal;
  await guardedWrite(() => updateGoal(goalId, { statement: plan, expectedStatement: launched }), GOAL_EDITED);
}

/**
 * Start a triggered Squad execution; on any failure forget the plan-correction
 * launch binding begun for it so it cannot leak or bind a later execution.
 */
export async function startTriggeredSquadExecution(
  launchRequestId: string,
  start: () => Promise<{ ok: true; value: { id: string } } | { ok: false; message: string; code?: string }>,
  binding: { forgetLaunch(launchRequestId: string): void }
): Promise<{ executionId: string }> {
  let result: Awaited<ReturnType<typeof start>>;
  try {
    result = await start();
  } catch (error) {
    binding.forgetLaunch(launchRequestId);
    throw error;
  }
  if (!result.ok) {
    binding.forgetLaunch(launchRequestId);
    // Shown verbatim in the schedule run list and the goal escalation.
    throw new Error(result.code === 'REQUIREMENT_UNAVAILABLE'
      ? `Squad requirements are unavailable, so no workers started: ${result.message}. Configure the project or edit the plan, then run again.`
      : result.message);
  }
  return { executionId: result.value.id };
}

export interface TriggeredSquadPlanDeps {
  beginLaunch(launchRequestId: string, reason: string): void;
}

/**
 * Initial task text per slot for a triggered Squad. An invalid supplied plan
 * parks the run: begins the correction binding and holds every slot.
 */
export function triggeredSquadSlotTasks(
  input: { launchRequestId: string; objective: string },
  slots: ReadonlyArray<{ role: 'orchestrator' | 'worker' }>,
  planError: string | undefined,
  hold: (role: 'orchestrator' | 'worker') => string,
  deps: TriggeredSquadPlanDeps
): Array<{ initialTask: string }> {
  if (planError) deps.beginLaunch(input.launchRequestId, planError);
  return slots.map(slot => ({ initialTask: planError
    ? hold(slot.role)
    : slot.role === 'orchestrator'
      ? `${input.objective}\n\nCoordinate workers and report durable execution completion.`
      : `${input.objective}\n\nFollow orchestrator assignments and report progress.` }));
}
