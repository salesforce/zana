import { getThreadRoutePath } from '../route-paths.js';
import { decideThreadDrop } from '../split-drag/zones.js';
import { countPanes, findPaneByContent, findPaneByThread, MAX_PANES, replacePaneContent, setFocus, splitPane } from './ops.js';
import { useSplitWorkspace } from './store.js';
import type { PaneContent } from './types.js';

interface OpenThreadInSplitArgs {
  navigate: (route: string, options?: { replace?: boolean }) => void;
  projectId: string | null;
  threadId: string;
  isCompact: boolean;
}

/**
 * Open a thread in the split area with the same placement rules a drag uses:
 * a right split by default, focus the pane when the thread is already open,
 * and coerce to a replace at the pane cap.
 */
export function openThreadInSplit({
  navigate,
  projectId,
  threadId,
  isCompact
}: OpenThreadInSplitArgs): void {
  const route = getThreadRoutePath(threadId, projectId);
  const layout = useSplitWorkspace.getState().layout;
  if (isCompact || layout === null) {
    navigate(route);
    return;
  }
  const existing = findPaneByThread(layout.root, projectId, threadId);
  if (existing !== null) {
    const next = setFocus(layout, existing.paneId);
    if (next !== layout) useSplitWorkspace.getState().setLayout(next);
    navigate(route, { replace: true });
    return;
  }
  const decision = decideThreadDrop({
    zone: 'right',
    threadAlreadyOpen: false,
    atMaxPanes: countPanes(layout.root) >= MAX_PANES
  });
  const content: PaneContent = { kind: 'thread', projectId, threadId };
  const next =
    decision.zone === 'center'
      ? replacePaneContent(layout, layout.focusedPaneId, content)
      : splitPane(layout, layout.focusedPaneId, 'right', content);
  if (next !== layout) useSplitWorkspace.getState().setLayout(next);
  navigate(route);
}

interface OpenPaneContentInSplitArgs {
  navigate: (route: string, options?: { replace?: boolean }) => void | Promise<void>;
  content: PaneContent;
  route: string;
  enabled: boolean;
}

export function openPaneContentInSplit({
  navigate,
  content,
  route,
  enabled
}: OpenPaneContentInSplitArgs): void {
  const layout = useSplitWorkspace.getState().layout;
  if (!enabled || layout === null) {
    void navigate(route);
    return;
  }
  const existing = findPaneByContent(layout.root, content);
  const next =
    existing !== null
      ? setFocus(layout, existing.paneId)
      : countPanes(layout.root) >= MAX_PANES
        ? replacePaneContent(layout, layout.focusedPaneId, content)
        : splitPane(layout, layout.focusedPaneId, 'right', content);
  if (next !== layout) useSplitWorkspace.getState().setLayout(next);
  void navigate(route, existing !== null ? { replace: true } : undefined);
}
