import { useThreads } from '../../thread-store.js';
import { getAgentSessionRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { useUi } from '../../store.js';
import type { ScheduledTask, TerminalSession } from '@zana-ai/zcc-domain/product';
import { liveSessionIdForTask } from './schedulerUtils.js';

/**
 * First-class page for a live scheduled run. Conversation threads open
 * ThreadDetail; pty sessions open AgentSessionPage.
 */
export function scheduledLivePath(projectId: string, sessionId: string): string {
  if (useThreads.getState().threads.some((row) => row.id === sessionId)) {
    return getThreadRoutePath(sessionId, projectId);
  }
  return getAgentSessionRoutePath(sessionId, projectId);
}

/** Open a live scheduled run as a normal agent/thread page. */
export function openScheduledLive(
  projectId: string,
  sessionId: string,
  navigate: (to: string) => void
): void {
  navigate(scheduledLivePath(projectId, sessionId));
}

/**
 * Agent View: a running job opens its live page; an armed job with no live
 * session opens the schedule editor.
 */
export function openScheduleFromAgents(
  task: ScheduledTask,
  terminals: Record<string, TerminalSession[] | undefined>,
  navigate: (to: string) => void
): void {
  const sessionId = liveSessionIdForTask(task, terminals);
  if (sessionId) {
    openScheduledLive(task.projectId, sessionId, navigate);
    return;
  }
  useUi.getState().revealSchedule(task.id);
}
