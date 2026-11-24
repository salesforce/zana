import { decideThreadDrop } from './zones.js';
import type { SplitDragConfig } from './splitDragSession.js';
import {
  countPanes, findPane, findPaneByContent, MAX_PANES, replacePaneContent, setFocus, splitPane,
  type PaneContent
} from '../split-layout/index.js';
import { openRoutedPaneInSplit } from '../split-layout/openThreadInSplit.js';
import {
  createSinglePaneLayout, focusedPaneRoute, paneContentForPathname
} from '../split-layout/splitThreadNavigation.js';
import { useSplitWorkspace } from '../split-layout/store.js';

/** Shared by item-list pointer drags and native title-bar tab drags. */
export function routedPaneDrop(
  content: PaneContent,
  pathname: string,
  navigate: (route: string, options?: { replace?: boolean }) => void
): Pick<SplitDragConfig, 'decide' | 'onDrop'> {
  const { layout: startLayout, scopeKey: startScope } = useSplitWorkspace.getState();
  return {
    decide: (paneId, zone) => {
      if (useSplitWorkspace.getState().scopeKey !== startScope) return null;
      const layout = useSplitWorkspace.getState().layout ?? startLayout;
      if (layout === null) {
        return decideThreadDrop({ zone, threadAlreadyOpen: false, atMaxPanes: false });
      }
      const alreadyOpen = findPaneByContent(layout.root, content) !== null;
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
          content,
          isCompact: false,
          currentPathname: pathname
        });
        return;
      }
      const existing = findPaneByContent(layout.root, content);
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
          ? replacePaneContent(layout, paneId, content)
          : splitPane(layout, paneId, target.zone, content);
      const workspace = useSplitWorkspace.getState();
      if (next !== layout) {
        workspace.setLayout(next);
        if (target.zone !== 'center' && workspace.maximizedPaneId !== null) {
          workspace.setMaximizedPaneId(null);
        }
      }
      const route = focusedPaneRoute(next);
      if (route) navigate(route);
    }
  };
}
