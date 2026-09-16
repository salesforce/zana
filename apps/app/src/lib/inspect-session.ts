import { getAgentSessionRoutePath, getThreadRoutePath } from './route-paths.js';
import { keepsProjectFocusRail } from './shellLayout.js';
import { getScopedProjectId } from './windowScope.js';
import { useData, useUi } from '../store.js';

export type InspectNavigate = (to: string) => void;

/**
 * Project id to stamp on a classic-session inspect URL.
 *
 * Unscoped (`null`) produces `/sessions/:id` / `/threads/:id` so a kanban /
 * favorites / launch inspect cannot drill into `/projects/:id`.
 * Project-scoped session pages are only used while the project rail is already
 * showing (main-window focus, Inbox/Settings sticky focus, or a dedicated
 * project window) — the same predicate as {@link keepsProjectFocusRail}.
 */
export function inspectRouteProjectId(projectId: string | null | undefined): string | null {
  const scoped = getScopedProjectId();
  if (scoped) return projectId ?? scoped;
  const ui = useUi.getState();
  if (keepsProjectFocusRail(ui.nav, ui.focusedProjectId)) {
    return projectId ?? ui.focusedProjectId;
  }
  return null;
}

/**
 * Open a CLI agent: first-class session page when Classic session view is on;
 * inspector overlay otherwise.
 */
export function inspectAgentSession(
  sessionId: string,
  projectId: string,
  navigate: InspectNavigate
): void {
  if (useData.getState().classicSessionViewEnabled) {
    navigate(getAgentSessionRoutePath(sessionId, inspectRouteProjectId(projectId)));
    return;
  }
  useUi.getState().openAgentModal(sessionId, projectId);
}

/**
 * Open a conversation thread: first-class thread page when Classic session view
 * is on; inspector overlay otherwise.
 */
export function inspectThread(
  threadId: string,
  projectId: string | null | undefined,
  navigate: InspectNavigate
): void {
  if (useData.getState().classicSessionViewEnabled) {
    navigate(getThreadRoutePath(threadId, inspectRouteProjectId(projectId)));
    return;
  }
  useUi.getState().openThreadModal(threadId);
}
