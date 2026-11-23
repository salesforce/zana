import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { DomFindBar } from '../../../../apps/app/src/components/DomFindBar.js';
import { shortcutForCommand } from '../../../../apps/app/src/lib/keyboard-shortcut-settings.js';
import { OWN_FIND_ATTRIBUTE } from '../../../../apps/app/src/lib/thread-find.js';
import { findMatchOffsets, highlightSegments, revealMatch, stepIndex } from './editor-find.js';

const MAX_SEEDED_QUERY = 200;

/** A short, single-line selection seeds the query, as in most editors. */
function selectionSeed(textarea: HTMLTextAreaElement | null): string | null {
  if (!textarea) return null;
  const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  return selected && selected.length <= MAX_SEEDED_QUERY && !selected.includes('\n') ? selected : null;
}

/**
 * Ctrl+F for the text editor. The search runs on the draft text; the current
 * match is selected in the textarea (focus stays in the bar) and scrolled into
 * view. Spread `rootProps` on the editor root: it claims Ctrl+F (so neither
 * thread search nor a surrounding doc handler sees the key) and carries
 * `data-own-find`. `bar` is the find bar to render while open.
 */
export function useEditorFind(textareaRef: RefObject<HTMLTextAreaElement | null>, text: string) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [revealKey, setRevealKey] = useState(0);
  const offsets = useMemo(() => (open ? findMatchOffsets(text, query) : []), [open, text, query]);
  const current = offsets.length === 0 ? -1 : Math.min(index, offsets.length - 1);
  const latest = useRef({ offsets, current, length: query.length });
  latest.current = { offsets, current, length: query.length };

  // Select and scroll only when the user searches or steps, never when the text changes under a caret.
  useEffect(() => {
    const { offsets, current, length } = latest.current;
    const textarea = textareaRef.current;
    if (revealKey > 0 && textarea && current >= 0) revealMatch(textarea, offsets[current], length);
  }, [revealKey, textareaRef]);

  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    setIndex(0);
    setRevealKey((key) => key + 1);
  }, []);
  const step = useCallback((direction: 1 | -1) => {
    setIndex(stepIndex(current, direction, offsets.length));
    setRevealKey((key) => key + 1);
  }, [current, offsets.length]);
  const openBar = useCallback(() => {
    const seed = selectionSeed(textareaRef.current);
    if (seed !== null && seed !== query) changeQuery(seed);
    setOpen(true);
    setFocusRequest((value) => value + 1);
  }, [changeQuery, query, textareaRef]);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    textareaRef.current?.focus();
  }, [textareaRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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
  };

  // The textarea's own selection is not drawn while focus is in the bar, so the matches are painted on a
  // backdrop behind the (transparent) textarea, scrolled in step with it.
  const backdropRef = useRef<HTMLDivElement>(null);
  const syncScroll = useCallback(() => {
    if (backdropRef.current && textareaRef.current) backdropRef.current.scrollTop = textareaRef.current.scrollTop;
  }, [textareaRef]);
  useLayoutEffect(syncScroll, [syncScroll, open, offsets, current]);
  const backdrop: ReactNode = open ? (
    <div ref={backdropRef} className="dd-editor-backdrop" aria-hidden>
      {highlightSegments(text, offsets, query.length, current).map((segment, position) =>
        segment.hit ? <mark key={position} className={segment.hit === 'current' ? 'dd-find-hit dd-find-current' : 'dd-find-hit'}>{segment.text}</mark> : segment.text
      )}
    </div>
  ) : null;

  const bar: ReactNode = open ? (
    <div className="dd-editor-find">
      <DomFindBar
        value={query}
        onChange={changeQuery}
        onStep={step}
        onClose={close}
        matchIndex={current}
        matchCount={offsets.length}
        focusRequest={focusRequest}
        label="Find in editor"
      />
    </div>
  ) : null;

  return { bar, backdrop, active: open, onScroll: syncScroll, rootProps: { [OWN_FIND_ATTRIBUTE]: '', onKeyDown } };
}
