import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createFindHighlighter, findTextRanges, scrollRangeIntoView, type FindHighlighter } from './dom-find.js';
import { OWN_FIND_ATTRIBUTE } from './thread-find.js';
import { shortcutForCommand } from './keyboard-shortcut-settings.js';

/** Ranges for `query`, recomputed after commit so they point at on-screen nodes. */
function useFindRanges(contentRef: RefObject<Element | null>, active: boolean, query: string, contentKey: string): Range[] {
  const [ranges, setRanges] = useState<Range[]>([]);
  useLayoutEffect(() => {
    const root = contentRef.current;
    setRanges(active && query && root ? findTextRanges(root, query) : []);
  }, [active, query, contentKey, contentRef]);
  return ranges;
}

/**
 * Paints and scrolls to the current match. The highlighter is this instance's
 * own, so other find surfaces' highlights are never touched; it is disposed
 * with the component.
 */
function useFindHighlights(ranges: Range[], current: number): void {
  const highlighter = useRef<FindHighlighter | null>(null);
  highlighter.current ??= createFindHighlighter();
  useEffect(() => {
    highlighter.current?.paint(ranges, current);
    const range = ranges[current];
    if (range) scrollRangeIntoView(range);
  }, [ranges, current]);
  useEffect(() => () => {
    highlighter.current?.dispose();
    highlighter.current = null;
  }, []);
}

interface FindKeyActions {
  open: boolean;
  onOpen: () => void;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}

function findKeyHandler({ open, onOpen, onStep, onClose }: FindKeyActions) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (shortcutForCommand('thread.find', event.nativeEvent)) {
      event.preventDefault();
      onOpen();
    } else if (open && event.key === 'F3') {
      event.preventDefault();
      onStep(event.shiftKey ? -1 : 1);
    } else if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
}

/**
 * Ctrl+F for a read-only rendered surface. Spread `hostProps` on the surface's
 * root (it carries `data-own-find`, so thread find stays out) and render
 * `DomFindBar` while `open`. `contentRef` is the element whose text is searched
 * (not the bar); `contentKey` changes when that content is re-rendered.
 */
export function useDomFind(contentRef: RefObject<Element | null>, hostRef: RefObject<HTMLElement | null>, contentKey: string) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const ranges = useFindRanges(contentRef, open, query, contentKey);
  const current = ranges.length === 0 ? -1 : Math.min(index, ranges.length - 1);
  useFindHighlights(ranges, current);
  useEffect(() => { setIndex(0); }, [query]);

  const step = useCallback((direction: 1 | -1) => {
    if (ranges.length === 0) return;
    setIndex((value) => (Math.min(value, ranges.length - 1) + direction + ranges.length) % ranges.length);
  }, [ranges.length]);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    hostRef.current?.focus();
  }, [hostRef]);
  const onOpen = useCallback(() => {
    setOpen(true);
    setFocusRequest((value) => value + 1);
  }, []);

  return {
    open,
    query,
    setQuery,
    matchIndex: current,
    matchCount: ranges.length,
    focusRequest,
    step,
    close,
    openBar: onOpen,
    hostProps: {
      [OWN_FIND_ATTRIBUTE]: '',
      tabIndex: -1,
      onKeyDown: findKeyHandler({ open, onOpen, onStep: step, onClose: close })
    }
  };
}
