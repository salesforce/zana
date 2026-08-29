import { useMemo } from 'react';
import { useIsCompactViewport } from '../../hooks/useIsCompactViewport.js';
import {
  computePaneRects,
  countPanes,
  findPaneByContent,
  listPanes,
  type PaneContent,
  type PaneRect,
  type SplitLayout
} from '../../lib/split-layout/index.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';

export interface MiniMapSlot {
  paneId: string;
  rect: PaneRect;
  isMe: boolean;
  isFocused: boolean;
}

export interface PaneContentSplitIndicator {
  isOpenInSplit: boolean;
  miniMap: MiniMapSlot[] | null;
}

const NO_INDICATOR: PaneContentSplitIndicator = { isOpenInSplit: false, miniMap: null };

function buildSplitIndicator(
  layout: SplitLayout,
  matchingPaneIds: ReadonlySet<string>
): PaneContentSplitIndicator {
  if (matchingPaneIds.size === 0) return NO_INDICATOR;
  const rects = computePaneRects(layout.root);
  const miniMap: MiniMapSlot[] = listPanes(layout.root).flatMap((entry) => {
    const rect = rects.get(entry.paneId);
    return rect === undefined
      ? []
      : [
          {
            paneId: entry.paneId,
            rect,
            isMe: matchingPaneIds.has(entry.paneId),
            isFocused: entry.paneId === layout.focusedPaneId
          }
        ];
  });
  return { isOpenInSplit: true, miniMap };
}

export function usePaneContentSplitIndicator(
  content: PaneContent,
  enabled = true
): PaneContentSplitIndicator {
  const isCompact = useIsCompactViewport();
  const layout = useSplitWorkspace((s) => s.layout);
  return useMemo(() => {
    if (!enabled || layout === null || isCompact || countPanes(layout.root) < 2) {
      return NO_INDICATOR;
    }
    const pane = findPaneByContent(layout.root, content);
    if (pane === null) return NO_INDICATOR;
    return buildSplitIndicator(layout, new Set([pane.paneId]));
  }, [content, enabled, isCompact, layout]);
}
