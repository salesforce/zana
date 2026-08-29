import type { ScheduledTask, TerminalSession } from '@zana-ai/zcc-domain/product';

function isLiveSession(session: Pick<TerminalSession, 'status'>): boolean {
  return session.status === 'running' || session.status === 'starting';
}

/**
 * Scheduled tasks that currently have a live pty. Matches SchedulerOverview's
 * "Running now" rule: a task counts once when any run-history session is still
 * `running`/`starting`. Session ids are unique, so a project-id mismatch on
 * the task still counts the live session.
 */
export function runningSchedulerCount(
  tasks: readonly Pick<ScheduledTask, 'projectId' | 'status'>[],
  terminals: Record<string, TerminalSession[] | undefined>
): number {
  const live = new Set<string>();
  for (const [projectId, list] of Object.entries(terminals)) {
    for (const session of list ?? []) {
      if (!isLiveSession(session)) continue;
      live.add(`${projectId}:${session.id}`);
      live.add(session.id);
    }
  }
  let n = 0;
  for (const task of tasks) {
    for (const run of task.status?.runs ?? []) {
      if (!run.sessionId) continue;
      if (live.has(`${task.projectId}:${run.sessionId}`) || live.has(run.sessionId)) {
        n += 1;
        break;
      }
    }
  }
  return n;
}
