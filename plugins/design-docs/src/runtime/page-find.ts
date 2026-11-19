/**
 * Find in the page. A design doc renders in a sandboxed frame the app cannot
 * read, so the search runs here: the app's find bar sends the query over the
 * page port, and this module counts the matches, paints them and scrolls to
 * the current one using the app's shared `dom-find` helpers. Keys pressed while
 * focus is inside the page are handed back, since the app never sees them.
 */
import { MAX_FIND_QUERY_CHARS, type FindKey, type FromPage, type ToPage } from '../shared/frame-protocol.js';
import { createFindHighlighter, findTextRanges, scrollRangeIntoView } from '../../../../apps/app/src/lib/dom-find.js';

export interface PageFind {
  /** Applies a `find` message from the app. */
  handle(message: Extract<ToPage, { type: 'find' }>): void;
}

/** The find key a keydown in the page stands for, given whether the bar is open. */
export function findKeyFor(event: KeyboardEvent, barOpen: boolean): FindKey | null {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') return 'open';
  if (!barOpen) return null;
  if (event.key === 'F3') return event.shiftKey ? 'prev' : 'next';
  return event.key === 'Escape' ? 'close' : null;
}

export function createPageFind(doc: Document, post: (message: FromPage) => void): PageFind {
  const highlighter = createFindHighlighter();
  let query: string | null = null;
  let index = 0;
  let ranges: Range[] = [];

  const root = () => doc.body ?? doc.documentElement;
  const run = (step: 0 | 1 | -1) => {
    ranges = query ? findTextRanges(root(), query) : [];
    index = ranges.length === 0 ? 0 : (Math.min(index, ranges.length - 1) + step + ranges.length) % ranges.length;
    highlighter.paint(ranges, index);
    const current = ranges[index];
    if (current) scrollRangeIntoView(current, { scrollWindow: true });
    post({ type: 'find-result', index: current ? index : -1, count: ranges.length });
  };

  doc.addEventListener('keydown', (event) => {
    const key = findKeyFor(event, query !== null);
    if (!key) return;
    event.preventDefault();
    post({ type: 'find-key', key });
  }, true);

  return {
    handle(message) {
      const next = message.query === null ? null : message.query.slice(0, MAX_FIND_QUERY_CHARS);
      if (next !== query) index = 0;
      query = next;
      run(message.step);
    }
  };
}
