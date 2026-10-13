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
  updateSchedule(scheduleId: string, patch: { prompt: string }): Promise<unknown>;
}

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
  const scheduleId = parseScheduledLaunchRequestId(execution.launchRequestId);
  if (!scheduleId) return;
  const schedule = deps.getSchedule(scheduleId);
  if (schedule.projectId !== ctx.projectId || schedule.kind !== 'team') throw new InboxActionOperatorError('scheduled Squad no longer matches this correction');
  // The run was launched with the (trimmed) schedule prompt as its objective. A
  // different prompt now means the user edited the schedule during review; do
  // not overwrite their edit.
  const launched = execution.request?.objective?.trim();
  if (!launched || schedule.prompt?.trim() !== launched) {
    throw new InboxActionOperatorError('the schedule prompt was edited since this run launched; review the schedule before approving the correction');
  }
  const prompt = await deps.readCorrectedPlanText(ctx.projectRoot, ctx.executionId);
  if (!prompt?.trim()) throw new InboxActionOperatorError('corrected plan artifact is unavailable');
  // The service verified the digest of the units the operator approved; the
  // text persisted here must parse to exactly those units.
  if (digestOfPlanText(prompt) !== launchDigest(approvedUnits as ExecutionWorkUnitInput[])) {
    throw new InboxActionOperatorError('corrected plan changed after approval; renewed approval is required');
  }
  await deps.updateSchedule(scheduleId, { prompt });
}

/**
 * Start a triggered Squad execution; on any failure forget the plan-correction
 * launch binding begun for it so it cannot leak or bind a later execution.
 */
export async function startTriggeredSquadExecution(
  launchRequestId: string,
  start: () => Promise<{ ok: true; value: { id: string } } | { ok: false; message: string }>,
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
    throw new Error(result.message);
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
