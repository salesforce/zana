import { decideThreadDrop } from '../split-drag/zones.js';
import { countPanes, findPaneByContent, MAX_PANES, replacePaneContent, setFocus, splitPane } from './ops.js';
import { createSinglePaneLayout, paneContentForPathname, paneContentRoute } from './splitThreadNavigation.js';
import { useSplitWorkspace } from './store.js';
import type { PaneContent } from './types.js';

interface OpenThreadInSplitArgs {
  navigate: (route: string, options?: { replace?: boolean }) => void;
  projectId: string | null;
  threadId: string;
  isCompact: boolean;
  currentPathname?: string;
}

interface OpenRoutedPaneInSplitArgs {
  navigate: (route: string, options?: { replace?: boolean }) => void;
  content: PaneContent;
  isCompact: boolean;
  currentPathname?: string;
}

function paneToKeepBeside(pathname: string | undefined, content: PaneContent): PaneContent | null {
  if (!pathname) return null;
  const keep = paneContentForPathname(pathname);
  if (keep === null) return null;
  if (findPaneByContent({ type: 'pane', paneId: 'keep', content: keep }, content) !== null) {
    return null;
  }
  return keep;
}

/**
 * Open routed pane content in the split area with the same placement rules a
 * drag uses: a right split by default, focus the pane when it is already open,
 * keep the current splittable page beside when seeding from a single pane, and
 * coerce to a replace at the pane cap.
 */
export function openRoutedPaneInSplit({
  navigate,
  content,
  isCompact,
  currentPathname
}: OpenRoutedPaneInSplitArgs): void {
  const route = paneContentRoute(content);
  const layout = useSplitWorkspace.getState().layout;
  if (isCompact) {
    navigate(route);
    return;
  }
  if (layout === null) {
    const keep = paneToKeepBeside(currentPathname, content);
    if (keep === null) {
      navigate(route);
      return;
    }
    const seeded = createSinglePaneLayout(keep);
    const next = splitPane(seeded, seeded.focusedPaneId, 'right', content);
    useSplitWorkspace.getState().setLayout(next);
    navigate(route);
    return;
  }
  const existing = findPaneByContent(layout.root, content);
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
  const next =
    decision.zone === 'center'
      ? replacePaneContent(layout, layout.focusedPaneId, content)
      : splitPane(layout, layout.focusedPaneId, 'right', content);
  if (next !== layout) useSplitWorkspace.getState().setLayout(next);
  navigate(route);
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
  isCompact,
  currentPathname
}: OpenThreadInSplitArgs): void {
  openRoutedPaneInSplit({
    navigate,
    content: { kind: 'thread', projectId, threadId },
    isCompact,
    currentPathname
  });
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

export function openAgentSessionInSplit({
  navigate,
  projectId,
  sessionId,
  isCompact,
  currentPathname
}: {
  navigate: (route: string, options?: { replace?: boolean }) => void;
  projectId: string | null;
  sessionId: string;
  isCompact: boolean;
  currentPathname?: string;
}): void {
  openRoutedPaneInSplit({
    navigate,
    content: { kind: 'agent-session', projectId, sessionId },
    isCompact,
    currentPathname
  });
}

export function openScheduleInSplit({
  navigate,
  projectId,
  scheduleId,
  isCompact,
  currentPathname
}: {
  navigate: (route: string, options?: { replace?: boolean }) => void;
  projectId: string | null;
  scheduleId: string;
  isCompact: boolean;
  currentPathname?: string;
}): void {
  openRoutedPaneInSplit({
    navigate,
    content: { kind: 'schedule', projectId, scheduleId },
    isCompact,
    currentPathname
  });
}
