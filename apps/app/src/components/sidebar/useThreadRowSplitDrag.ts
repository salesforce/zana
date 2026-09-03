import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsCompactViewport } from '../../hooks/useIsCompactViewport.js';
import {
  beginSplitDrag,
  decideThreadDrop,
  shouldEngageSidebarSplitDrag,
  type SplitDragFallbackTarget
} from '../../lib/split-drag/index.js';
import {
  countPanes,
  findPaneByContent,
  listPanes,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type PaneContent,
  type SplitLayout
} from '../../lib/split-layout/index.js';
import { openRoutedPaneInSplit } from '../../lib/split-layout/openThreadInSplit.js';
import { focusedPaneRoute, paneContentRoute } from '../../lib/split-layout/splitThreadNavigation.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';

const SIDEBAR_SELECTOR = '.sidebar, .project-scoped-nav, [data-sidebar="sidebar"]';
const MAIN_CONTENT_SELECTOR = '.split-workspace, main.shell-main';

export function usePaneContentSplitDrag({
  content,
  title
}: {
  content: PaneContent;
  title: string;
}): {
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  openInSplit: () => void;
} {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isCompact = useIsCompactViewport();
  const contentKey = paneContentRoute(content);
  const contentRef = useRef(content);
  contentRef.current = content;

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const rowEl = event.currentTarget;
      const sidebarEl = rowEl.closest(SIDEBAR_SELECTOR);
      const sidebarRightEdge = (sidebarEl ?? rowEl).getBoundingClientRect().right;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLayout = useSplitWorkspace.getState().layout;
      const fallback = singlePaneFallback(startLayout);
      const paneContent = contentRef.current;

      beginSplitDrag({
        ghostLabel: title,
        sourceEl: rowEl,
        fallback,
        cancelSidebarReorderOnEngage: true,
        shouldEngage: (x, y) =>
          shouldEngageSidebarSplitDrag({
            startX,
            startY,
            x,
            y,
            sidebarRightEdge
          }),
        decide: (_paneId, zone) => {
          const layout = useSplitWorkspace.getState().layout ?? startLayout;
          if (layout === null) {
            return decideThreadDrop({ zone, threadAlreadyOpen: false, atMaxPanes: false });
          }
          const alreadyOpen = findPaneByContent(layout.root, paneContent) !== null;
          return decideThreadDrop({
            zone,
            threadAlreadyOpen: alreadyOpen,
            atMaxPanes: countPanes(layout.root) >= MAX_PANES
          });
        },
        onDrop: (target) => {
          const layout = useSplitWorkspace.getState().layout ?? startLayout;
          if (layout === null) {
            openRoutedPaneInSplit({
              navigate,
              content: paneContent,
              isCompact: false,
              currentPathname: pathname
            });
            return;
          }
          const existing = findPaneByContent(layout.root, paneContent);
          if (existing !== null) {
            const next = setFocus(layout, existing.paneId);
            if (next !== layout) useSplitWorkspace.getState().setLayout(next);
            const route = focusedPaneRoute(next);
            if (route) navigate(route, { replace: true });
            return;
          }
          const next =
            target.zone === 'center'
              ? replacePaneContent(layout, target.paneId, paneContent)
              : splitPane(layout, target.paneId, target.zone, paneContent);
          if (next !== layout) useSplitWorkspace.getState().setLayout(next);
          const route = focusedPaneRoute(next);
          if (route) navigate(route);
        }
      });
    },
    [contentKey, navigate, pathname, title]
  );

  const openInSplit = useCallback(() => {
    openRoutedPaneInSplit({
      navigate,
      content: contentRef.current,
      isCompact,
      currentPathname: pathname
    });
  }, [contentKey, isCompact, navigate, pathname]);

  if (isCompact) {
    return { onPointerDown: undefined, openInSplit };
  }
  return { onPointerDown, openInSplit };
}

export function useThreadRowSplitDrag({
  projectId,
  threadId,
  title
}: {
  projectId: string | null;
  threadId: string;
  title: string;
}): {
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  openInSplit: () => void;
} {
  return usePaneContentSplitDrag({
    content: { kind: 'thread', projectId, threadId },
    title
  });
}

function singlePaneFallback(layout: SplitLayout | null): SplitDragFallbackTarget | undefined {
  if (layout !== null && listPanes(layout.root).length !== 1) return undefined;
  const paneId = layout?.focusedPaneId ?? 'pane-1';
  return {
    paneId,
    container: document.querySelector<HTMLElement>(MAIN_CONTENT_SELECTOR)
  };
}
