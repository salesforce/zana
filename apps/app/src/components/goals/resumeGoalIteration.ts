import type { Goal, GoalIteration } from '@zana-ai/zcc-domain/product';
import { resumableRun } from '@zana-ai/zcc-domain/schedule-health';
import { product } from '../../lib/product-client.js';
import { getAgentSessionRoutePath } from '../../lib/route-paths.js';
import { useUi } from '../../store.js';

/**
 * Whether a goal iteration may be offered for reopening: the goal is not a Squad goal
 * and the iteration passes the rule main applies (`resumableRun`). Callers add their
 * own "has it finished" check.
 */
export function canResumeIteration(goal: Pick<Goal, 'assignment'>, iteration: GoalIteration): boolean {
  if (goal.assignment?.kind === 'team') return false;
  return resumableRun(iteration);
}

/** Goals with a resume call in flight; a second click on the same one is ignored. */
const inFlight = new Set<string>();

/**
 * Reopen a finished goal iteration's conversation in a new tab (main decides
 * everything; this only shows the outcome). `iterationId` omitted means the newest
 * resumable iteration.
 */
export async function resumeGoalIteration(
  goal: Goal,
  iterationId: string | undefined,
  navigate: (to: string) => void
): Promise<void> {
  if (inFlight.has(goal.id)) return;
  inFlight.add(goal.id);
  const { pushToast } = useUi.getState();
  try {
    const result = await product.goals.resumeIteration(iterationId === undefined ? { goalId: goal.id } : { goalId: goal.id, iterationId });
    if (!result.ok) {
      pushToast(result.message, 'error');
      return;
    }
    const { session, reused } = result.value;
    useUi.getState().enterProjectFocus(session.projectId);
    navigate(getAgentSessionRoutePath(session.id, session.projectId));
    pushToast(reused ? `Switched to "${goal.title}"` : `Reopened the latest "${goal.title}" run`, 'info');
  } catch (error) {
    // A rejected IPC call must still tell the user, in plain words; the raw text is for the log.
    console.warn('[goals] resumeIteration failed', error);
    pushToast("Couldn't reopen this run. Try again.", 'error');
  } finally {
    inFlight.delete(goal.id);
  }
}
