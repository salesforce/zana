import { getAgentSessionRoutePath, getThreadRoutePath } from './route-paths.js';
import { useData, useUi } from '../store.js';

export type InspectNavigate = (to: string) => void;

/**
 * Open a CLI agent: inspector overlay by default, or the first-class session
 * page when Classic session view is on.
 */
export function inspectAgentSession(
  sessionId: string,
  projectId: string,
  navigate: InspectNavigate
): void {
  if (useData.getState().classicSessionViewEnabled) {
    navigate(getAgentSessionRoutePath(sessionId, projectId));
    return;
  }
  useUi.getState().openAgentModal(sessionId, projectId);
}

/**
 * Open a conversation thread: inspector overlay by default, or the first-class
 * thread page when Classic session view is on.
 */
export function inspectThread(
  threadId: string,
  projectId: string | null | undefined,
  navigate: InspectNavigate
): void {
  if (useData.getState().classicSessionViewEnabled) {
    navigate(getThreadRoutePath(threadId, projectId));
    return;
  }
  useUi.getState().openThreadModal(threadId);
}
