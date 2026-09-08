import { listPanes } from './ops.js';
import type { PaneContent, SplitLayout } from './types.js';

export function agentSessionAnchorId(sessionId: string): string {
  return `cc-terminal-anchor-agent-session-${sessionId}`;
}

export function projectTerminalsAnchorId(paneId: string): string {
  return `cc-terminal-anchor-project-view-${paneId}`;
}

function isProjectTerminals(content: PaneContent): content is Extract<PaneContent, { kind: 'project-view' }> {
  return content.kind === 'project-view' && content.mode === 'terminals';
}

/**
 * Which CLI-agent pane should receive the live xterm grid. Prefers the focused
 * agent-session pane when several are open; otherwise the first agent-session
 * pane so a thread-focused split still shows the live PTY in the other pane.
 */
export function pickAgentSessionPortalTarget(
  layout: SplitLayout | null,
  routeContent: PaneContent | null
): { sessionId: string; projectId: string | null } | null {
  if (layout !== null) {
    const panes = listPanes(layout.root).filter((pane) => pane.content.kind === 'agent-session');
    if (panes.length > 0) {
      const focused = panes.find((pane) => pane.paneId === layout.focusedPaneId) ?? panes[0];
      const content = focused.content;
      if (content.kind === 'agent-session') {
        return { sessionId: content.sessionId, projectId: content.projectId };
      }
    }
  }
  if (routeContent?.kind === 'agent-session') {
    return { sessionId: routeContent.sessionId, projectId: routeContent.projectId };
  }
  return null;
}

/**
 * Which project Terminals pane should receive the live xterm grid. Prefers the
 * focused terminals pane; otherwise the first so an Explorer-focused split
 * still shows the PTY in the other pane.
 */
export function pickProjectTerminalsPortalTarget(
  layout: SplitLayout | null,
  routeContent: PaneContent | null
): { paneId: string; projectId: string } | null {
  if (layout !== null) {
    const panes = listPanes(layout.root).filter((pane) => isProjectTerminals(pane.content));
    if (panes.length > 0) {
      const focused = panes.find((pane) => pane.paneId === layout.focusedPaneId) ?? panes[0];
      const content = focused.content;
      if (isProjectTerminals(content)) {
        return { paneId: focused.paneId, projectId: content.projectId };
      }
    }
  }
  if (routeContent && isProjectTerminals(routeContent)) {
    return { paneId: 'pane-1', projectId: routeContent.projectId };
  }
  return null;
}
