import { useEffect, useState, type RefObject } from 'react';
import { useInboxReplyDrafts } from '../stores/inbox-reply-drafts.js';
import { readTrimmedSelection } from './thread/secondary-panel/SecondaryPanelSelectionActions.js';

const QUOTABLE = '.inbox-detail-comments, .inbox-detail-docs';
const DEBOUNCE_MS = 120;
const BUTTON_WIDTH = 120;
const BUTTON_HEIGHT = 24;
const MARGIN = 8;

interface Placement {
  text: string;
  left: number;
  top: number;
}

/** Tracks the current quotable selection inside `rootRef` and where its floating button belongs. */
function useQuoteSelection(entryId: string, rootRef: RefObject<HTMLElement | null>) {
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    setPlacement(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      setPlacement(null);
    };
    const inside = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement ?? null;
      return !!el && !!rootRef.current?.contains(el) && !!el.closest(QUOTABLE);
    };
    const evaluate = () => {
      timer = undefined;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0
        || !inside(selection.anchorNode) || !inside(selection.focusNode)) {
        setPlacement(null);
        return;
      }
      const text = readTrimmedSelection();
      if (!text) {
        setPlacement(null);
        return;
      }
      const rects = selection.getRangeAt(0).getClientRects();
      const rect = rects.length > 0 ? rects[rects.length - 1]! : selection.getRangeAt(0).getBoundingClientRect();
      const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, window.innerWidth - BUTTON_WIDTH - MARGIN));
      const top = Math.min(Math.max(MARGIN, rect.top - BUTTON_HEIGHT - 6), Math.max(MARGIN, window.innerHeight - BUTTON_HEIGHT - MARGIN));
      setPlacement({ text, left, top });
    };
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(evaluate, DEBOUNCE_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const scroller = rootRef.current?.closest('.inbox-view-detail') ?? null;
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keydown', onKey);
    scroller?.addEventListener('scroll', hide);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keydown', onKey);
      scroller?.removeEventListener('scroll', hide);
    };
  }, [entryId, rootRef]);

  return [placement, setPlacement] as const;
}

/** Floating "Quote in reply" button for a text selection inside the message body or its files. */
export function InboxQuoteSelection({ entryId, rootRef }: { entryId: string; rootRef: RefObject<HTMLElement | null> }) {
  const [placement, setPlacement] = useQuoteSelection(entryId, rootRef);
  if (!placement) return null;
  return (
    <button
      type="button"
      className="inbox-quote-selection"
      style={{ left: placement.left, top: placement.top }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        useInboxReplyDrafts.getState().appendQuote(entryId, placement.text);
        window.getSelection()?.removeAllRanges();
        setPlacement(null);
      }}
    >
      Quote in reply
    </button>
  );
}
