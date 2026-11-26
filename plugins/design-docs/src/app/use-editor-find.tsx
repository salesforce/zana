import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { DomFindBar } from '../../../../apps/app/src/components/DomFindBar.js';
import { shortcutForCommand } from '../../../../apps/app/src/lib/keyboard-shortcut-settings.js';
import { OWN_FIND_ATTRIBUTE } from '../../../../apps/app/src/lib/thread-find.js';
import { findMatchOffsets, highlightSegments, nearestIndex, revealMatch, stepIndex } from './editor-find.js';

const MAX_SEEDED_QUERY = 200;

/** A short, single-line selection seeds the query, as in most editors. */
function selectionSeed(textarea: HTMLTextAreaElement | null): string | null {
  if (!textarea) return null;
  const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  return selected && selected.length <= MAX_SEEDED_QUERY && !selected.includes('\n') ? selected : null;
}

interface FindKeys {
  open: boolean;
  onOpen: () => void;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}

/** Ctrl+F opens (or refocuses) the bar; while it is open F3 steps and Esc closes. */
function findKeyHandler({ open, onOpen, onStep, onClose }: FindKeys) {
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
 * Selects and scrolls to the current match, but only when the user searches or
 * steps (`revealKey` changes), never when the text changes under a caret.
 */
function useRevealOnSearch(textareaRef: RefObject<HTMLTextAreaElement | null>, revealKey: number, target: { offset: number | undefined; length: number }) {
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    const { offset, length } = latest.current;
    const textarea = textareaRef.current;
    if (revealKey > 0 && textarea && offset !== undefined) revealMatch(textarea, offset, length);
  }, [revealKey, textareaRef]);
}

/**
 * The textarea's own selection is not drawn while focus is in the bar, so the
 * matches are painted on a backdrop behind the (transparent) textarea, which
 * is scrolled in step with it.
 */
function useFindBackdrop(textareaRef: RefObject<HTMLTextAreaElement | null>, active: boolean, text: string, offsets: number[], length: number, current: number) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const syncScroll = useCallback(() => {
    if (backdropRef.current && textareaRef.current) backdropRef.current.scrollTop = textareaRef.current.scrollTop;
  }, [textareaRef]);
  useLayoutEffect(syncScroll, [syncScroll, active, offsets, current]);
  const backdrop: ReactNode = active ? (
    <div ref={backdropRef} className="dd-editor-backdrop" aria-hidden>
      {highlightSegments(text, offsets, length, current).map((segment, position) =>
        segment.hit ? <mark key={position} className={segment.hit === 'current' ? 'dd-find-hit dd-find-current' : 'dd-find-hit'}>{segment.text}</mark> : segment.text
      )}
    </div>
  ) : null;
  return { backdrop, syncScroll };
}

/**
 * Ctrl+F for the text editor. The search runs on the draft text; the current
 * match is selected in the textarea, painted on a backdrop and scrolled into
 * view, and the search starts at the match nearest the caret. Spread
 * `rootProps` on the editor root: it claims Ctrl+F (so neither thread search
 * nor a surrounding doc handler sees the key) and carries `data-own-find`.
 */
export function useEditorFind(textareaRef: RefObject<HTMLTextAreaElement | null>, text: string) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // `null`: nothing stepped yet, so the match nearest the caret when find opened is current.
  const [stepped, setStepped] = useState<number | null>(null);
  const [anchor, setAnchor] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [revealKey, setRevealKey] = useState(0);
  const offsets = useMemo(() => (open ? findMatchOffsets(text, query) : []), [open, text, query]);
  const current = stepped === null ? nearestIndex(offsets, anchor) : Math.min(stepped, offsets.length - 1);
  useRevealOnSearch(textareaRef, revealKey, { offset: offsets[current], length: query.length });
  const { backdrop, syncScroll } = useFindBackdrop(textareaRef, open, text, offsets, query.length, current);

  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    setStepped(null);
    setRevealKey((key) => key + 1);
  }, []);
  const step = useCallback((direction: 1 | -1) => {
    setStepped(stepIndex(current, direction, offsets.length));
    setRevealKey((key) => key + 1);
  }, [current, offsets.length]);
  const openBar = useCallback(() => {
    // Only a closed bar starts a search: a second Ctrl+F must not rewrite the query from the match find selected.
    if (!open) {
      const textarea = textareaRef.current;
      setAnchor(textarea?.selectionStart ?? 0);
      const seed = selectionSeed(textarea);
      if (seed !== null) changeQuery(seed);
      setOpen(true);
    }
    setFocusRequest((value) => value + 1);
  }, [changeQuery, open, textareaRef]);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setStepped(null);
    textareaRef.current?.focus();
  }, [textareaRef]);

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

  return { bar, backdrop, active: open, onScroll: syncScroll, rootProps: { [OWN_FIND_ATTRIBUTE]: '', onKeyDown: findKeyHandler({ open, onOpen: openBar, onStep: step, onClose: close }) } };
}
