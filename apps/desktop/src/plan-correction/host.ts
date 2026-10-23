import { join } from 'node:path';
import type { InboxActionRegistry } from '../inbox-actions/registry.js';
import type { ExecutionDatabase } from '@zana-ai/zcc-db';
import { updateScheduledPromptFromCorrection, type ScheduledPromptDeps } from '../scheduled-plan-correction.js';
import { INFERRED_PLAN_NUDGE_BUDGET, createInferredPlanCorrection } from '../inferred-plan-correction.js';
import { correctedPlanRelPath, readAuthoredPlan, readCorrectedPlan, readHandoffArtifact, type CoordinatorHandoffContext } from '../team-plan-handoff.js';
import { PLAN_CORRECTION_ACTION, PlanCorrectionService, runPlanCorrectionHostAction, type PlanCorrectionDeps } from './service.js';
import { createExecutionRetiredCheck, createPlanCorrectionWarningLogger } from './wiring.js';
import { PlanCorrectionLaunchBinding } from './launch-binding.js';
import { createPlanCorrectionStore } from './store.js';

export interface PlanCorrectionHostDeps {
  userDataDir: string;
  database: ExecutionDatabase | undefined;
  inboxStore: { appendOnce: PlanCorrectionDeps['appendInbox'] };
  inboxActionRegistry: Pick<InboxActionRegistry, 'bind' | 'register'>;
  nudge: PlanCorrectionDeps['nudge'];
  wakeCoordinator: NonNullable<PlanCorrectionDeps['wakeCoordinator']>;
  stopExecution(executionId: string): Promise<void>;
  /** Resume the coordinator hand-off once a correction is approved. */
  resume: PlanCorrectionDeps['resume'];
  executionStore: {
    get(executionId: string): Promise<{ state: string; timeoutReason?: string; request?: { objective?: string } } | undefined>;
    getInProject: ScheduledPromptDeps['getExecution'];
  };
  scheduler: { get: ScheduledPromptDeps['getSchedule']; update: ScheduledPromptDeps['updateSchedule'] };
  goals: { list(): Array<{ id: string } & ReturnType<NonNullable<ScheduledPromptDeps['getGoal']>>>; update: NonNullable<ScheduledPromptDeps['updateGoal']> };
  logError(label: string, error: unknown): void;
  /** Bounded correlation log line for corrected-plan reads (body-free). */
  logInfo?(context: string, message: string): void;
}

/**
 * Host wiring for the plan-correction decision: one service, one launch binding
 * and one Inbox host action, created once at app init (Rule 3).
 */
export function createPlanCorrectionHost(deps: PlanCorrectionHostDeps) {
  const planCorrection = new PlanCorrectionService({
    // One durable correction offer maps to one Inbox decision, including after
    // a transient bind failure or process recovery.
    appendInbox: (input) => deps.inboxStore.appendOnce(input),
    bindInboxAction: (entry, action) => deps.inboxActionRegistry.bind(entry, action),
    nudge: (sessionId, text) => deps.nudge(sessionId, text),
    wakeCoordinator: (executionId, text, confirmation) => deps.wakeCoordinator(executionId, text, confirmation),
    readSourcePlan: async (executionId) => (await deps.executionStore.get(executionId))?.request?.objective,
    readCorrectedPlan,
    store: createPlanCorrectionStore({
      filePath: join(deps.userDataDir, 'plan-corrections.json'),
      database: deps.database,
      isExecutionRetired: createExecutionRetiredCheck((executionId) => deps.executionStore.get(executionId))
    }),
    logWarning: createPlanCorrectionWarningLogger(deps.logError),
    updateScheduledPrompt: (ctx: CoordinatorHandoffContext, units) => updateScheduledPromptFromCorrection({
      getExecution: (projectId, executionId) => deps.executionStore.getInProject(projectId, executionId),
      getSchedule: (scheduleId) => deps.scheduler.get(scheduleId),
      readCorrectedPlanText: (projectRoot, executionId) => readHandoffArtifact(projectRoot, correctedPlanRelPath(executionId)),
      updateSchedule: (scheduleId, patch) => deps.scheduler.update(scheduleId, patch),
      getGoal: (goalId) => {
        const goal = deps.goals.list().find((candidate) => candidate.id === goalId);
        if (!goal) throw new Error(`goal not found: ${goalId}`);
        return goal;
      },
      updateGoal: (goalId, patch) => deps.goals.update(goalId, patch)
    }, ctx, units),
    resume: (ctx) => deps.resume(ctx),
    stopExecution: (executionId) => deps.stopExecution(executionId),
    ...(deps.logInfo ? { trace: (event) => deps.logInfo!(`squad plan correction trace ${event.stage}`, JSON.stringify(event)) } : {})
  });
  const launchBinding = new PlanCorrectionLaunchBinding();
  deps.inboxActionRegistry.register(PLAN_CORRECTION_ACTION, ({ ref, input }) => runPlanCorrectionHostAction(planCorrection, ref, input?.optionId));
  return { planCorrection, launchBinding };
}

/**
 * Plan-correction hooks for the coordinator file hand-off: an approved correction
 * supersedes the authored file, corrected plans are reviewed before registering, and
 * an inferred plan that stays invalid opens the same Inbox decision a provided plan gets.
 */
export function createPlanCorrectionHandoff(planCorrection: PlanCorrectionService) {
  const inferredPlanCorrection = createInferredPlanCorrection(planCorrection);
  return {
    inferredPlanCorrection,
    hooks: {
      readAuthoredPlan: async (projectRoot: string, executionId: string) => await planCorrection.approvedPlan(executionId)
        ?? readAuthoredPlan(projectRoot, executionId),
      review: (ctx: CoordinatorHandoffContext, read: Parameters<PlanCorrectionService['review']>[1]) => planCorrection.review(ctx, read),
      reviewInvalid: (ctx: CoordinatorHandoffContext, reason: string) => inferredPlanCorrection.reviewInvalid(ctx, reason),
      maxNudges: INFERRED_PLAN_NUDGE_BUDGET
    }
  };
}
