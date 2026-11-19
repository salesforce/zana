import { useCallback, useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { clearFindHighlights, findTextRanges, paintFindHighlights, scrollRangeIntoView } from './dom-find.js';
import { OWN_FIND_ATTRIBUTE } from './thread-find.js';
import { shortcutForCommand } from './keyboard-shortcut-settings.js';

/**
 * Ctrl+F for a read-only rendered surface. Spread `hostProps` on the surface's
 * root (it carries `data-own-find`, so thread find stays out) and render
 * `FindBar` while `open`. `contentRef` is the element whose text is searched
 * (not the bar); `contentKey` changes when that content is re-rendered.
 */
export function useDomFind(contentRef: RefObject<Element | null>, hostRef: RefObject<HTMLElement | null>, contentKey: string) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [ranges, setRanges] = useState<Range[]>([]);
  // After commit, so the ranges point at the nodes that are on screen.
  useLayoutEffect(() => {
    const root = contentRef.current;
    setRanges(open && query && root ? findTextRanges(root, query) : []);
  }, [open, query, contentKey, contentRef]);
  const current = ranges.length === 0 ? -1 : Math.min(index, ranges.length - 1);

  useEffect(() => {
    paintFindHighlights(ranges, current);
    const range = ranges[current];
    if (range) scrollRangeIntoView(range);
  }, [ranges, current]);
  useEffect(() => clearFindHighlights, []);
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

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const native = event.nativeEvent;
    if (shortcutForCommand('thread.find', native)) {
      event.preventDefault();
      setOpen(true);
      setFocusRequest((value) => value + 1);
    } else if (open && event.key === 'F3') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return {
    open,
    query,
    setQuery,
    matchIndex: current,
    matchCount: ranges.length,
    focusRequest,
    step,
    close,
    hostProps: { [OWN_FIND_ATTRIBUTE]: '', tabIndex: -1, onKeyDown }
  };
}
