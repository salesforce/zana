import { getAgentSessionRoutePath, getThreadRoutePath } from './route-paths.js';
import { keepsProjectFocusRail } from './shellLayout.js';
import { getScopedProjectId } from './windowScope.js';
import { useData, useUi } from '../store.js';
import { isCompactViewport } from '../hooks/useIsCompactViewport.js';

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
 * Open a conversation thread in the main view for desktop tabs or Classic
 * session view; use the inspector otherwise.
 */
export function inspectThread(
  threadId: string,
  projectId: string | null | undefined,
  navigate: InspectNavigate
): void {
  const { classicSessionViewEnabled, threadTabsEnabled } = useData.getState();
  if (classicSessionViewEnabled || (threadTabsEnabled && !isCompactViewport())) {
    navigate(getThreadRoutePath(threadId, inspectRouteProjectId(projectId)));
    return;
  }
  useUi.getState().openThreadModal(threadId);
}

/**
 * Listener for main's `thread-open` push (menu bar, notifications). File and
 * terminal opens are handled by the thread's own panels. The thread replaces any
 * existing inspector instead of opening underneath it, where the overlay would
 * keep the thread's native browser hidden.
 */
export function threadOpenListener(navigate: { current: InspectNavigate }): (payload: unknown) => void {
  return (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const event = payload as { type?: unknown; threadId?: unknown; projectId?: unknown; file?: unknown; terminal?: unknown };
    if (event.type !== 'thread-open' || event.file || event.terminal) return;
    if (typeof event.threadId !== 'string' || typeof event.projectId !== 'string') return;
    useUi.getState().enterProjectFocus(event.projectId);
    inspectThread(event.threadId, event.projectId, navigate.current);
  };
}
