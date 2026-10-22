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
  matches: readonly TimelineSearchMatch[];
  /** Index of the current match in `matches`, or -1. */
  index: number;
  current: TimelineSearchMatch | null;
  /** Bumped on every navigation, so the timeline scrolls even to the same match. */
  navigation: number;
  /** Enter / Shift+Enter: a new query starts over; the same query steps and wraps. */
  submit(query: string, direction?: ThreadSearchDirection): void;
}

/**
 * Find-in-thread over the loaded rows plus the server outline, so matches in
 * collapsed rows and unloaded pages are counted and reachable. The current
 * match is kept by identity (row + occurrence) as rows stream in or older
 * pages load, so the counter follows it rather than a stale index.
 */
export function useThreadSearch({
  threadId,
  rows,
  hasOlder,
  olderCursorKey,
  loadingOlder,
  loadOlder
}: {
  threadId: string;
  rows: readonly TimelineRow[];
  hasOlder: boolean;
  /** Changes whenever a page loads, so each page is requested once. */
  olderCursorKey: string | null;
  loadingOlder: boolean;
  loadOlder: () => void;
}): ThreadSearchState {
  const [query, setQuery] = useState('');
  const [outline, setOutline] = useState<readonly TimelineSearchOutlineMatch[]>([]);
  const [pending, setPending] = useState(false);
  const [start, setStart] = useState<ThreadSearchDirection | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [navigation, setNavigation] = useState(0);
  const generation = useRef(0);
  const olderLoads = useRef({ count: 0, cursor: null as string | null, warned: false });

  const viewRows = useMemo(() => (query ? buildTimelineViewRows(rows as TimelineRow[]) : []), [query, rows]);
  const matches = useMemo(
    () => collectTimelineSearchMatches(viewRows, query, { outlineMatches: outline, hasOlder }),
    [hasOlder, outline, query, viewRows]
  );
  const index = useMemo(() => {
    if (!position || matches.length === 0) return -1;
    const found = matches.findIndex((match) => match.id === position.id && match.occurrence === position.occurrence);
    return found >= 0 ? found : Math.min(position.index, matches.length - 1);
  }, [matches, position]);
  const current = index >= 0 ? matches[index] ?? null : null;

  const goTo = useCallback((next: number) => {
    const match = matches[next];
    setPosition(match ? { id: match.id, occurrence: match.occurrence, index: next } : null);
    setNavigation((value) => value + 1);
  }, [matches]);

  // A new query lands on its first (or, with Shift+Enter, last) match once counted.
  useEffect(() => {
    if (!start || pending) return;
    setStart(null);
    goTo(matches.length === 0 ? -1 : start === 'next' ? 0 : matches.length - 1);
  }, [goTo, matches.length, pending, start]);

  const submit = useCallback((raw: string, direction: ThreadSearchDirection = 'next') => {
    const needle = raw.trim();
    if (needle && needle === query && !pending) {
      if (matches.length === 0) return;
      const from = index < 0 ? (direction === 'next' ? -1 : 0) : index;
      goTo((from + (direction === 'next' ? 1 : -1) + matches.length) % matches.length);
      return;
    }
    const run = ++generation.current;
    olderLoads.current = { count: 0, cursor: null, warned: false };
    setQuery(needle);
    setOutline([]);
    setPosition(null);
    if (!needle) {
      setPending(false);
      setStart(null);
      return;
    }
    setPending(true);
    setStart(direction);
    void product.threads.conversationOutline(threadId, needle).then((body) => {
      if (run === generation.current) setOutline(body.matches ?? []);
    }).catch((error: unknown) => {
      // Loaded rows still search; only matches in unloaded pages go uncounted.
      console.warn('[thread-search] outline search failed', { threadId, error });
    }).finally(() => {
      if (run === generation.current) setPending(false);
    });
  }, [goTo, index, matches.length, pending, query, threadId]);

  // Reaching a match in an older page loads pages until it is present.
  useEffect(() => {
    if (!current?.unloaded || !hasOlder || loadingOlder) return;
    const loads = olderLoads.current;
    if (loads.cursor === olderCursorKey) return;
    if (loads.count >= THREAD_SEARCH_MAX_OLDER_LOADS) {
      if (!loads.warned) console.warn('[thread-search] stopped loading older pages', { threadId, loads: loads.count, matchId: current.id });
      loads.warned = true;
      return;
    }
    loads.count += 1;
    loads.cursor = olderCursorKey;
    loadOlder();
  }, [current, hasOlder, loadOlder, loadingOlder, olderCursorKey, threadId]);

  return { query, pending, matches, index, current, navigation, submit };
}
