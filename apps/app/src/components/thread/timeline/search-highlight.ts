import { useLayoutEffect, useRef, type RefObject } from 'react';
import { threadSearchPattern, threadSearchRanges } from '@zana-ai/zcc-thread-view';

/** `::highlight()` names styled in global.css. */
export const THREAD_SEARCH_MATCH_HIGHLIGHT = 'thread-search-match';
export const THREAD_SEARCH_CURRENT_HIGHLIGHT = 'thread-search-current';
/** Row fallback when the browser lacks the Highlight API or the match is not in rendered text. */
export const THREAD_SEARCH_CURRENT_ROW_CLASS = 'thread-timeline-search-current';
/** Highlighted ranges per timeline, so a huge tool output cannot stall painting. */
export const THREAD_SEARCH_MAX_RANGES = 5000;
/** Repaints coalesce while rows stream in. */
export const THREAD_SEARCH_REPAINT_MS = 120;

export interface ThreadSearchHighlightTarget {
  query: string;
  rowId: string | null;
  /** The match's index among the row's own matches; -1 when there is none. */
  occurrence: number;
  /** Bumped on each navigation: the next paint scrolls the current match into view. */
  navigation: number;
}

interface HighlightRegistry {
  set(name: string, value: unknown): void;
  delete(name: string): boolean;
}

type HighlightConstructor = new (...ranges: Range[]) => unknown;

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightConstructor } | null {
  const registry = typeof CSS === 'undefined' ? undefined : (CSS as { highlights?: HighlightRegistry }).highlights;
  const Highlight = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

// Several timelines can be mounted (split panes, the thread modal); the
// document-wide highlights are the union of what each one paints.
const painted = new Map<symbol, { all: Range[]; current: Range | null }>();

function publish() {
  const api = highlightApi();
  if (!api) return;
  const all: Range[] = [];
  const current: Range[] = [];
  for (const entry of painted.values()) {
    all.push(...entry.all);
    if (entry.current) current.push(entry.current);
  }
  if (all.length === 0) {
    api.registry.delete(THREAD_SEARCH_MATCH_HIGHLIGHT);
    api.registry.delete(THREAD_SEARCH_CURRENT_HIGHLIGHT);
    return;
  }
  api.registry.set(THREAD_SEARCH_MATCH_HIGHLIGHT, new api.Highlight(...all));
  api.registry.set(THREAD_SEARCH_CURRENT_HIGHLIGHT, new api.Highlight(...current));
}

function rowElement(pane: HTMLElement, rowId: string | null): HTMLElement | null {
  if (!rowId) return null;
  const element = pane.querySelector(`[data-row-id="${CSS.escape(rowId)}"]`);
  return element instanceof HTMLElement ? element : null;
}

/**
 * Finds every match in the pane's rendered text, as ranges. The current match
 * is the `occurrence`-th range whose nearest row is the target row (ranges in
 * nested child rows belong to those rows).
 */
export function findThreadSearchRanges(
  pane: HTMLElement,
  target: ThreadSearchHighlightTarget
): { all: Range[]; current: Range | null; row: HTMLElement | null } {
  const row = rowElement(pane, target.rowId);
  const pattern = threadSearchPattern(target.query);
  const all: Range[] = [];
  const inRow: Range[] = [];
  if (!pattern) return { all, current: null, row };
  const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && all.length < THREAD_SEARCH_MAX_RANGES; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    const parent = node.parentElement;
    if (!text.trim() || !parent || parent.closest('script, style, [aria-hidden="true"]')) continue;
    const owner = row && row.contains(parent) ? parent.closest('[data-row-id]') : null;
    for (const [start, end] of threadSearchRanges(text, pattern)) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      all.push(range);
      if (row && owner === row) inRow.push(range);
      if (all.length >= THREAD_SEARCH_MAX_RANGES) break;
    }
  }
  const current = target.occurrence < 0 || inRow.length === 0
    ? null
    : inRow[Math.min(target.occurrence, inRow.length - 1)] ?? null;
  return { all, current, row };
}

/**
 * Paints find-in-thread matches in a timeline pane with the CSS Custom
 * Highlight API (no DOM changes, so React keeps owning the rows), repaints as
 * rows stream in or expand, and scrolls the current match into view once per
 * navigation — waiting, if needed, until a collapsed or lazily loaded row
 * renders it.
 */
export function useThreadSearchHighlights(
  paneRef: RefObject<HTMLElement | null>,
  target: ThreadSearchHighlightTarget | undefined
): void {
  const key = useRef(Symbol('thread-search'));
  const scrolledFor = useRef<number | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || !target) return;
    const id = key.current;
    let markedRow: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const paint = () => {
      timer = null;
      const current = targetRef.current;
      if (!current) return;
      const found = findThreadSearchRanges(pane, current);
      painted.set(id, { all: found.all, current: found.current });
      publish();
      // Without the Highlight API, or when the match is not in rendered text
      // (collapsed tool output, a title), mark the whole row instead.
      const fallback = !highlightApi() || !found.current ? found.row : null;
      if (markedRow !== fallback) {
        markedRow?.classList.remove(THREAD_SEARCH_CURRENT_ROW_CLASS);
        fallback?.classList.add(THREAD_SEARCH_CURRENT_ROW_CLASS);
        markedRow = fallback;
      }
      if (scrolledFor.current === current.navigation || current.occurrence < 0 || !found.row) return;
      scrolledFor.current = current.navigation;
      const anchor = found.current?.startContainer.parentElement ?? found.row;
      anchor.scrollIntoView({ block: 'center' });
    };

    paint();
    const observer = new MutationObserver(() => {
      if (timer === null) timer = setTimeout(paint, THREAD_SEARCH_REPAINT_MS);
    });
    observer.observe(pane, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      markedRow?.classList.remove(THREAD_SEARCH_CURRENT_ROW_CLASS);
      painted.delete(id);
      publish();
    };
  }, [paneRef, target?.query, target?.rowId, target?.occurrence, target?.navigation]);
}
