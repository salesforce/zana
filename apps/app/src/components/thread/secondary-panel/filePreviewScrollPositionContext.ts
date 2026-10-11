import { createContext, useCallback, useContext, type RefCallback } from 'react';

/** Mutable on purpose: scroll events write here without re-rendering the panel. */
export interface FilePreviewScrollPosition {
  scrollTop: number;
}

export type FilePreviewScrollPositions = Map<string, FilePreviewScrollPosition>;

/** The active file tab's retained offset; null outside a file tab (pins, other tab kinds). */
export const FilePreviewScrollPositionContext = createContext<FilePreviewScrollPosition | null>(null);

export function filePreviewScrollPositionFor(
  positions: FilePreviewScrollPositions,
  tabId: string
): FilePreviewScrollPosition {
  let position = positions.get(tabId);
  if (!position) {
    position = { scrollTop: 0 };
    positions.set(tabId, position);
  }
  return position;
}

/** Bounds the cache to the open tabs: a closed tab's offset is gone for good. */
export function pruneFilePreviewScrollPositions(
  positions: FilePreviewScrollPositions,
  openTabIds: Iterable<string>
): void {
  const open = new Set(openTabIds);
  for (const tabId of positions.keys()) {
    if (!open.has(tabId)) positions.delete(tabId);
  }
}

/**
 * Ref for the scrolling element of a ready document. Attaching restores the retained
 * offset and tracks native scrolling; detaching only stops tracking, because the offset
 * a layout clamp reports while the element is leaving is not where the reader was.
 */
export function useRetainedFilePreviewScroll(): RefCallback<HTMLElement> {
  const position = useContext(FilePreviewScrollPositionContext);
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node || !position) return;
      node.scrollTop = position.scrollTop;
      const save = () => {
        position.scrollTop = node.scrollTop;
      };
      node.addEventListener('scroll', save, { passive: true });
      return () => node.removeEventListener('scroll', save);
    },
    [position]
  );
}
