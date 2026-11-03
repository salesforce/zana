/**
 * Reopen a finished Goal iteration's agent conversation in a new tab (#553).
 *
 * Same launch as a scheduled run's Resume (`scheduler-resume-run.ts`): the shared
 * core checks the folder and harness and reuses an open tab, and nothing is sent
 * and no new iteration is recorded. Main owns every decision (Rules 1 and 2): the
 * renderer sends only a goal id and an optional iteration id. Only a conversation
 * the iteration recorded itself is used; goal files are editable, so the id is
 * validated again here by `resumableRun`.
 */
import type { Goal, Result } from '@zana-ai/zcc-domain/product';
import { finishedIteration, latestResumableRun, resumableRun } from '@zana-ai/zcc-domain/schedule-health';
import { fail, NO_CONVERSATION, resumeConversation, type ResumeCoreDeps, type ResumeRunValue } from './scheduler-resume-run.js';

export interface ResumeGoalInput { goalId: string; iterationId?: string }
export type ResumeGoalValue = ResumeRunValue;

export interface ResumeGoalDeps extends ResumeCoreDeps {
  getGoal: (goalId: string) => Goal | undefined;
}

export async function resumeGoalIteration(input: ResumeGoalInput, deps: ResumeGoalDeps): Promise<Result<ResumeGoalValue>> {
  const goal = deps.getGoal(input.goalId);
  if (!goal) return fail('NOT_FOUND', 'This goal is no longer available');

  const iterations = goal.history?.iterations ?? [];
  const iteration = input.iterationId === undefined
    ? latestResumableRun(iterations.filter(finishedIteration))
    : iterations.find((candidate) => candidate.id === input.iterationId);
  if (input.iterationId !== undefined && !iteration) return fail('RUN_NOT_FOUND', "This run is no longer in the goal's history");
  // The worker of an unfinished iteration is still writing its conversation (and owns the open tab): never offered.
  if (iteration && !finishedIteration(iteration)) return fail('RUN_NOT_FINISHED', 'This run is still going');
  // One rule for "latest" and an explicit iteration: launched, not a Squad run, valid recorded id.
  if (!iteration || !resumableRun(iteration)) return fail('NO_CONVERSATION', NO_CONVERSATION);

  const project = deps.listProjects().find((candidate) => candidate.id === goal.projectId);
  if (!project) return fail('PROJECT_MISSING', 'The project for this goal is no longer registered');
  return resumeConversation({
    project, title: `↺ Goal: ${goal.title}`, subject: 'goal', runForTab: iteration, conversation: iteration.conversation!
  }, deps);
}
