import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
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
  findPane,
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
import {
  createSinglePaneLayout,
  focusedPaneRoute,
  paneContentForPathname,
  paneContentRoute
} from '../../lib/split-layout/splitThreadNavigation.js';
import { POST_DRAG_CLICK_SUPPRESS_MS } from '../../lib/suppress-post-drag-click.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';

const SIDEBAR_SELECTOR = '.sidebar, .project-scoped-nav, [data-sidebar="sidebar"]';
/** The live workspace box — never the shell landmark (display:contents, empty rect). */
const MAIN_CONTENT_SELECTOR = '.split-workspace';

export function usePaneContentSplitDrag({
  content,
  title
}: {
  content: PaneContent;
  title: string;
}): {
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  openInSplit: () => void;
  consumeClick: () => boolean;
} {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isCompact = useIsCompactViewport();
  const contentKey = paneContentRoute(content);
  const contentRef = useRef(content);
  contentRef.current = content;
  const suppressClickRef = useRef(false);
  const suppressClickUntil = useRef(0);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelDrag.current?.(), [pathname, isCompact]);
  const consumeClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return Date.now() < suppressClickUntil.current;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const interactiveChild = event.target instanceof Element
        ? event.target.closest('button, input, textarea, select, [role="button"]')
        : null;
      if (interactiveChild && interactiveChild !== event.currentTarget) return;
      suppressClickRef.current = false;
      const startScope = useSplitWorkspace.getState().scopeKey;
      const rowEl = event.currentTarget;
      const sidebarEl = rowEl.closest(SIDEBAR_SELECTOR);
      const sidebarRightEdge = (sidebarEl ?? rowEl).getBoundingClientRect().right;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLayout = useSplitWorkspace.getState().layout;
      const fallback = singlePaneFallback(startLayout);
      const paneContent = contentRef.current;

      cancelDrag.current = beginSplitDrag({
        pointerId: event.pointerId,
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
        decide: (paneId, zone) => {
          if (useSplitWorkspace.getState().scopeKey !== startScope) return null;
          const layout = useSplitWorkspace.getState().layout ?? startLayout;
          if (layout === null) {
            return decideThreadDrop({ zone, threadAlreadyOpen: false, atMaxPanes: false });
          }
          const alreadyOpen = findPaneByContent(layout.root, paneContent) !== null;
          const target = findPane(layout.root, paneId);
          return decideThreadDrop({
            zone,
            threadAlreadyOpen: alreadyOpen,
            atMaxPanes: countPanes(layout.root) >= MAX_PANES,
            emptyTarget: target?.content.kind === 'empty'
          });
        },
        onDrop: (target) => {
          if (useSplitWorkspace.getState().scopeKey !== startScope) return;
          const stored = useSplitWorkspace.getState().layout ?? startLayout;
          const keep = stored === null ? paneContentForPathname(pathname) : null;
          const layout = stored ?? (keep === null ? null : createSinglePaneLayout(keep));
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
          const paneId =
            findPane(layout.root, target.paneId) !== null ? target.paneId : layout.focusedPaneId;
          const next =
            target.zone === 'center'
              ? replacePaneContent(layout, paneId, paneContent)
              : splitPane(layout, paneId, target.zone, paneContent);
          if (next !== layout) useSplitWorkspace.getState().setLayout(next);
          const route = focusedPaneRoute(next);
          if (route) navigate(route);
        },
        onEnd: () => {
          suppressClickRef.current = true;
          suppressClickUntil.current = Date.now() + POST_DRAG_CLICK_SUPPRESS_MS;
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
    return { onPointerDown: undefined, openInSplit, consumeClick };
  }
  return { onPointerDown, openInSplit, consumeClick };
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
  consumeClick: () => boolean;
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
