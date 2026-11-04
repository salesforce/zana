import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTimelineViewRows } from '@zana-ai/zcc-thread-view';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { product } from '../../lib/product-client.js';
import {
  collectTimelineSearchMatches,
  type TimelineSearchMatch,
  type TimelineSearchOutlineMatch
} from '../../components/thread/timeline/thread-search.js';

export type ThreadSearchDirection = 'next' | 'previous';

/** Earlier-history pages one search may load to reach a match (as message links do). */
export const THREAD_SEARCH_MAX_OLDER_LOADS = 100;

interface Position {
  id: string;
  occurrence: number;
  index: number;
}

export interface ThreadSearchState {
  /** The submitted query; '' when search is cleared. */
  query: string;
  /** True while the outline counts for a new query are in flight. */
  pending: boolean;
  /** The outline search failed, so only loaded messages were counted. */
  partial: boolean;
  matches: readonly TimelineSearchMatch[];
  /** Index of the current match in `matches`, or -1. */
  index: number;
  current: TimelineSearchMatch | null;
  /** Bumped on every navigation, so the timeline scrolls even to the same match. */
  navigation: number;
  /** Enter / Shift+Enter: a new query starts over; the same query steps and wraps. */
  submit(query: string, direction?: ThreadSearchDirection): void;
}

interface OutlineSearch {
  threadId: string;
  query: string;
  outline: readonly TimelineSearchOutlineMatch[];
  pending: boolean;
  partial: boolean;
}

const idleSearch = (threadId: string): OutlineSearch => ({ threadId, query: '', outline: [], pending: false, partial: false });

/**
 * The submitted query and the server's counts for it. State belongs to one
 * thread: switching threads reads as a cleared search, and a response for an
 * earlier query or thread is dropped.
 */
function useOutlineSearch(threadId: string) {
  const [state, setState] = useState(() => idleSearch(threadId));
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [threadId]);
  const search = useCallback((query: string) => {
    const run = ++generation.current;
    if (!query) { setState(idleSearch(threadId)); return; }
    setState({ threadId, query, outline: [], pending: true, partial: false });
    const settle = (patch: Partial<OutlineSearch>) => {
      if (run === generation.current) setState((previous) => ({ ...previous, ...patch, pending: false }));
    };
    void product.threads.conversationOutline(threadId, query).then((body) => settle({ outline: body.matches ?? [] }), (error: unknown) => {
      // Loaded rows still search; the counter says the rest went uncounted.
      console.warn('[thread-search] outline search failed', { threadId, error });
      settle({ partial: true });
    });
  }, [threadId]);
  return { ...(state.threadId === threadId ? state : idleSearch(threadId)), search };
}

/** The current match by identity, falling back to the same index when it went away. */
function matchIndex(matches: readonly TimelineSearchMatch[], position: Position | null): number {
  if (!position || matches.length === 0) return -1;
  const found = matches.findIndex((match) => match.id === position.id && match.occurrence === position.occurrence);
  return found >= 0 ? found : Math.min(position.index, matches.length - 1);
}

/** Reaching a match in an older page loads pages until it is present, up to the cap. */
function useOlderPagesForMatch({ threadId, query, current, hasOlder, olderCursorKey, loadingOlder, loadOlder }: {
  threadId: string;
  query: string;
  current: TimelineSearchMatch | null;
  hasOlder: boolean;
  olderCursorKey: string | null;
  loadingOlder: boolean;
  loadOlder: () => void;
}) {
  const loads = useRef({ count: 0, cursor: null as string | null, warned: false });
  useEffect(() => { loads.current = { count: 0, cursor: null, warned: false }; }, [query, threadId]);
  useEffect(() => {
    if (!current?.unloaded || !hasOlder || loadingOlder) return;
    const state = loads.current;
    if (state.cursor === olderCursorKey) return;
    if (state.count >= THREAD_SEARCH_MAX_OLDER_LOADS) {
      if (!state.warned) console.warn('[thread-search] stopped loading older pages', { threadId, loads: state.count, matchId: current.id });
      state.warned = true;
      return;
    }
    state.count += 1;
    state.cursor = olderCursorKey;
    loadOlder();
  }, [current, hasOlder, loadOlder, loadingOlder, olderCursorKey, threadId]);
}

/**
 * Find-in-thread over the loaded rows plus the server outline, so matches in
 * collapsed rows and unloaded pages are counted and reachable. The current
 * match is kept by identity (row + occurrence) as rows stream in or older
 * pages load, so the counter follows it rather than a stale index.
 */
export function useThreadSearch({ threadId, rows, hasOlder, olderCursorKey, loadingOlder, loadOlder }: {
  threadId: string;
  rows: readonly TimelineRow[];
  hasOlder: boolean;
  /** Changes whenever a page loads, so each page is requested once. */
  olderCursorKey: string | null;
  loadingOlder: boolean;
  loadOlder: () => void;
}): ThreadSearchState {
  const { query, outline, pending, partial, search } = useOutlineSearch(threadId);
  const [start, setStart] = useState<{ threadId: string; direction: ThreadSearchDirection } | null>(null);
  const [position, setPosition] = useState<Position & { threadId: string } | null>(null);
  const [navigation, setNavigation] = useState(0);

  const viewRows = useMemo(() => (query ? buildTimelineViewRows(rows as TimelineRow[]) : []), [query, rows]);
  const matches = useMemo(
    () => collectTimelineSearchMatches(viewRows, query, { outlineMatches: outline, hasOlder }),
    [hasOlder, outline, query, viewRows]
  );
  const index = matchIndex(matches, position?.threadId === threadId ? position : null);
  const current = index >= 0 ? matches[index] ?? null : null;

  const goTo = useCallback((next: number) => {
    const match = matches[next];
    setPosition(match ? { threadId, id: match.id, occurrence: match.occurrence, index: next } : null);
    setNavigation((value) => value + 1);
  }, [matches, threadId]);

  // A new query lands on its first (or, with Shift+Enter, last) match once counted.
  useEffect(() => {
    if (!start || pending) return;
    setStart(null);
    if (start.threadId !== threadId) return;
    goTo(matches.length === 0 ? -1 : start.direction === 'next' ? 0 : matches.length - 1);
  }, [goTo, matches.length, pending, start, threadId]);

  const submit = useCallback((raw: string, direction: ThreadSearchDirection = 'next') => {
    const needle = raw.trim();
    if (needle && needle === query && !pending) {
      if (matches.length === 0) return;
      const from = index < 0 ? (direction === 'next' ? -1 : 0) : index;
      goTo((from + (direction === 'next' ? 1 : -1) + matches.length) % matches.length);
      return;
    }
    search(needle);
    setPosition(null);
    setStart(needle ? { threadId, direction } : null);
  }, [goTo, index, matches.length, pending, query, search, threadId]);

  useOlderPagesForMatch({ threadId, query, current, hasOlder, olderCursorKey, loadingOlder, loadOlder });

  return { query, pending, partial, matches, index, current, navigation, submit };
}
