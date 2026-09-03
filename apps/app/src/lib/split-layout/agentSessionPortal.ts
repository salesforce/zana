import { listPanes } from './ops.js';
import type { PaneContent, SplitLayout } from './types.js';

export function agentSessionAnchorId(sessionId: string): string {
  return `cc-terminal-anchor-agent-session-${sessionId}`;
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
