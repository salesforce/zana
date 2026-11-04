import type { ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';
import { resumableRun } from '@zana-ai/zcc-domain/schedule-health';
import { product } from '../../lib/product-client.js';
import { getAgentSessionRoutePath } from '../../lib/route-paths.js';
import { useUi } from '../../store.js';
import { formatRelative } from './schedulerUtils.js';

/**
 * Whether a run's conversation may be offered for reopening: the schedule is a plain agent
 * schedule (never a Squad or a Claude /loop row) and the run passes the same rule main
 * applies (`resumableRun`). Callers add their own "is it still open" check.
 */
export function canResumeRun(task: Pick<ScheduledTask, 'kind' | 'external'>, run: ScheduleRun): boolean {
  if (task.external || task.kind === 'team') return false;
  return resumableRun(run);
}

/** Schedules with a resume call in flight; a second click on the same one is ignored. */
const inFlight = new Set<string>();

/**
 * Reopen a finished run's conversation in a new tab (main decides everything;
 * this only shows the outcome). `runId` omitted means the newest resumable run.
 */
export async function resumeScheduledRun(
  task: ScheduledTask,
  runId: string | undefined,
  navigate: (to: string) => void
): Promise<void> {
  if (inFlight.has(task.id)) return;
  inFlight.add(task.id);
  const { pushToast } = useUi.getState();
  try {
    const result = await product.scheduler.resumeRun(runId === undefined ? { scheduleId: task.id } : { scheduleId: task.id, runId });
    if (!result.ok) {
      pushToast(result.message, 'error');
      return;
    }
    const { session, reused } = result.value;
    useUi.getState().enterProjectFocus(session.projectId);
    navigate(getAgentSessionRoutePath(session.id, session.projectId));
    if (reused) {
      pushToast(`Switched to "${task.name}"`, 'info');
      return;
    }
    const run = runId === undefined ? undefined : (task.status.runs ?? []).find((candidate) => candidate.id === runId);
    pushToast(
      run
        ? `Reopened the "${task.name}" run from ${formatRelative(new Date(run.at))}`
        : `Reopened the latest "${task.name}" run`,
      'info'
    );
  } catch (error) {
    // A rejected IPC call must still tell the user, in plain words; the raw text is for the log.
    console.warn('[scheduler] resumeRun failed', error);
    pushToast("Couldn't reopen this run. Try again.", 'error');
  } finally {
    inFlight.delete(task.id);
  }
}
