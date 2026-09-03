import { useUi } from '../../store.js';
import { useThreads } from '../../thread-store.js';
import { isCompactViewport } from '../../hooks/useIsCompactViewport.js';
import { openAgentSessionInSplit, openThreadInSplit } from '../../lib/split-layout/openThreadInSplit.js';

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

/** Open a live scheduled run as a split pane beside the current page. */
export function openScheduledLiveInSplit(
  projectId: string,
  sessionId: string,
  navigate: (route: string, options?: { replace?: boolean }) => void,
  currentPathname?: string
): void {
  const isCompact = isCompactViewport();
  if (useThreads.getState().threads.some((row) => row.id === sessionId)) {
    openThreadInSplit({
      navigate,
      projectId,
      threadId: sessionId,
      isCompact,
      currentPathname
    });
    return;
  }
  openAgentSessionInSplit({
    navigate,
    projectId,
    sessionId,
    isCompact,
    currentPathname
  });
}
