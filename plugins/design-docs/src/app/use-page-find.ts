import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { shortcutForCommand } from '../../../../apps/app/src/lib/keyboard-shortcut-settings.js';
import { OWN_FIND_ATTRIBUTE } from '../../../../apps/app/src/lib/thread-find.js';
import { MAX_FIND_QUERY_CHARS, type FindKey, type ToPage } from '../shared/frame-protocol.js';

/**
 * Ctrl+F for a design doc page. The page lives in a sandboxed frame, so the
 * search itself runs in the page runtime (`runtime/page-find.ts`); this hook
 * owns the find bar's state and talks to it over the page port. `hostRef` is
 * the element that takes focus back when the bar closes.
 */
export function usePageFind(send: (message: ToPage) => void, hostRef: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ index: -1, count: 0 });
  const [focusRequest, setFocusRequest] = useState(0);
  const sendRef = useRef(send);
  sendRef.current = send;

  // The page learns about every change to the bar; closing sends `null`.
  useEffect(() => {
    sendRef.current({ type: 'find', query: open ? query.slice(0, MAX_FIND_QUERY_CHARS) : null, step: 0 });
    if (!open || !query) setResult({ index: -1, count: 0 });
  }, [open, query]);

  const step = useCallback((direction: 1 | -1) => {
    sendRef.current({ type: 'find', query: query.slice(0, MAX_FIND_QUERY_CHARS), step: direction });
  }, [query]);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    hostRef.current?.focus();
  }, [hostRef]);
  const openBar = useCallback(() => {
    setOpen(true);
    setFocusRequest((value) => value + 1);
  }, []);

  /** A key the page runtime saw while focus was inside the frame. */
  const onPageKey = useCallback((key: FindKey) => {
    if (key === 'open') openBar();
    else if (key === 'close') close();
    else step(key === 'next' ? 1 : -1);
  }, [openBar, close, step]);

  /** A new page load starts with no find; give it the open bar's query again. */
  const onPageReady = useCallback(() => {
    if (open) sendRef.current({ type: 'find', query: query.slice(0, MAX_FIND_QUERY_CHARS), step: 0 });
  }, [open, query]);

  return {
    open,
    query,
    setQuery,
    matchIndex: result.index,
    matchCount: result.count,
    focusRequest,
    step,
    close,
    onResult: setResult,
    onPageKey,
    onPageReady,
    hostProps: {
      [OWN_FIND_ATTRIBUTE]: '',
      tabIndex: -1,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (shortcutForCommand('thread.find', event.nativeEvent)) {
          event.preventDefault();
          openBar();
        } else if (open && event.key === 'F3') {
          event.preventDefault();
          step(event.shiftKey ? -1 : 1);
        } else if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }
    }
  };
}
