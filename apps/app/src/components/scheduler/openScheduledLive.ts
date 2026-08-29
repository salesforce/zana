import { useUi } from '../../store.js';
import { useThreads } from '../../thread-store.js';

/**
 * Peek a live scheduled run in the inspector overlay — stay on Scheduler.
 * Conversation threads open ThreadModal; pty sessions open the agent modal.
 * Matches AgentsBoard.inspect and ScheduleRow.openLive.
 */
export function openScheduledLive(projectId: string, sessionId: string): void {
  if (useThreads.getState().threads.some((row) => row.id === sessionId)) {
    useUi.getState().openThreadModal(sessionId);
    return;
  }
  useUi.getState().openAgentModal(sessionId, projectId);
}
