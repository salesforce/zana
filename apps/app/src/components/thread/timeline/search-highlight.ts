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
 * Rendered parts the match model counts: a message's markdown and row content
 * marked `data-thread-search-content`. Other text (titles, buttons, file
 * names) is neither counted nor highlighted.
 */
export const THREAD_SEARCH_CONTENT_SELECTOR = '[data-thread-search-content], [data-thread-search-markdown] .inbox-md';

const SKIPPED = 'script, style, [aria-hidden="true"]';
const BLOCK_TAGS = /^(?:BLOCKQUOTE|BR|DD|DIV|DL|DT|FIGURE|H[1-6]|HR|IMG|LI|OL|P|PRE|TABLE|TD|TH|TR|UL)$/;

/**
 * A content root's text as one string, so a match may span inline markup
 * (`a **b**` reads as `a b`), with each text node's start offset. A block
 * boundary reads as a newline, as it does in the model's text.
 */
function contentText(root: Element): { text: string; nodes: Text[]; starts: number[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(SKIPPED)
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT
  });
  let text = '';
  const nodes: Text[] = [];
  const starts: number[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      nodes.push(node as Text);
      starts.push(text.length);
      text += (node as Text).data;
    } else if (BLOCK_TAGS.test((node as Element).tagName) && text && !text.endsWith('\n')) {
      text += '\n';
    }
  }
  return { text, nodes, starts };
}

/** Index of the last text node starting at or before `offset` (`before` excludes `offset` itself). */
function nodeAt(starts: number[], offset: number, from: number, before = false): number {
  let index = from;
  while (index + 1 < starts.length && (before ? starts[index + 1]! < offset : starts[index + 1]! <= offset)) index += 1;
  return index;
}

/**
 * Finds every match in the pane's searchable text, as ranges. The current
 * match is the `occurrence`-th range whose nearest row is the target row
 * (ranges in nested child rows belong to those rows). When the row renders
 * fewer matches than the model counted (a collapsed message, output not shown
 * yet), there is no current range and the caller marks the row.
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
  for (const root of pane.querySelectorAll(THREAD_SEARCH_CONTENT_SELECTOR)) {
    if (all.length >= THREAD_SEARCH_MAX_RANGES) break;
    if (root.parentElement?.closest(THREAD_SEARCH_CONTENT_SELECTOR) || root.closest(SKIPPED)) continue;
    const { text, nodes, starts } = contentText(root);
    const owned = row !== null && root.closest('[data-row-id]') === row;
    let index = 0;
    for (const [start, end] of threadSearchRanges(text, pattern)) {
      index = nodeAt(starts, start, index);
      const last = nodeAt(starts, end, index, true);
      const range = document.createRange();
      range.setStart(nodes[index]!, start - starts[index]!);
      range.setEnd(nodes[last]!, end - starts[last]!);
      all.push(range);
      if (owned) inRow.push(range);
      if (all.length >= THREAD_SEARCH_MAX_RANGES) break;
    }
  }
  const current = target.occurrence < 0 ? null : inRow[target.occurrence] ?? null;
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
    const painter = createSearchPainter(pane, key.current, scrolledFor);
    const stop = observeRepaints(pane, () => {
      if (targetRef.current) painter.paint(targetRef.current);
    });
    return () => {
      stop();
      painter.dispose();
    };
  }, [paneRef, target?.query, target?.rowId, target?.occurrence, target?.navigation]);
}

/** Runs `paint` now and again, coalesced, whenever the pane's DOM changes; returns the stop function. */
function observeRepaints(pane: HTMLElement, paint: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    paint();
  };
  run();
  const observer = new MutationObserver(() => {
    if (timer === null) timer = setTimeout(run, THREAD_SEARCH_REPAINT_MS);
  });
  observer.observe(pane, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

/** One timeline's painter: publishes its ranges, marks the fallback row and scrolls once per navigation. */
function createSearchPainter(pane: HTMLElement, id: symbol, scrolledFor: { current: number | null }) {
  let markedRow: HTMLElement | null = null;
  const markRow = (row: HTMLElement | null) => {
    if (markedRow === row) return;
    markedRow?.classList.remove(THREAD_SEARCH_CURRENT_ROW_CLASS);
    row?.classList.add(THREAD_SEARCH_CURRENT_ROW_CLASS);
    markedRow = row;
  };
  return {
    paint(target: ThreadSearchHighlightTarget) {
      const found = findThreadSearchRanges(pane, target);
      painted.set(id, { all: found.all, current: found.current });
      publish();
      // Without the Highlight API, or when the match is not in rendered text
      // (a collapsed message or output), mark the whole row instead.
      markRow(!highlightApi() || !found.current ? found.row : null);
      if (scrolledFor.current === target.navigation || target.occurrence < 0 || !found.row) return;
      scrolledFor.current = target.navigation;
      const anchor = found.current?.startContainer.parentElement ?? found.row;
      anchor.scrollIntoView({ block: 'center' });
    },
    dispose() {
      markRow(null);
      painted.delete(id);
      publish();
    }
  };
}
