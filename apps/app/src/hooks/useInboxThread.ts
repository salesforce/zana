import { useEffect, useState } from 'react';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { resolveInboxThread, type InboxThread } from '../lib/inbox-thread.js';

/** Tiny insertion-ordered LRU for last-known-good Inbox results, so a remounted pane paints instantly.
 * An optional weight bounds total retained size (Rule 5); a value heavier than `maxEntryWeight` is never kept. */
export function createResultCache<V>(max = 20, budget?: { weigh: (value: V) => number; maxWeight: number; maxEntryWeight: number }) {
  const map = new Map<string, { value: V; weight: number }>();
  let total = 0;
  const remove = (key: string) => {
    const entry = map.get(key);
    if (entry) { total -= entry.weight; map.delete(key); }
  };
  return {
    get(key: string): V | undefined {
      const entry = map.get(key);
      if (entry) { map.delete(key); map.set(key, entry); }
      return entry?.value;
    },
    set(key: string, value: V) {
      remove(key);
      const weight = budget ? budget.weigh(value) : 0;
      if (budget && weight > budget.maxEntryWeight) return;
      map.set(key, { value, weight }); total += weight;
      while (map.size > max || (budget && total > budget.maxWeight)) remove(map.keys().next().value as string);
    },
    delete(key: string) { remove(key); },
    clear() { map.clear(); total = 0; }
  };
}

export const inboxThreadCache = createResultCache<InboxThread>(20);

export function useInboxThread(entry: InboxEntry, hasTerminal: boolean) {
  const threadId = entry.origin?.threadId;
  const sessionId = entry.sessionId;
  const projectId = entry.projectId;
  const shouldResolve = !!threadId || (!!sessionId && !hasTerminal);
  const cacheKey = `${entry.id}:${threadId ?? sessionId ?? ''}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ loading: boolean; thread: InboxThread | null; error: string | null }>(() => {
    const cached = shouldResolve ? inboxThreadCache.get(cacheKey) : undefined;
    return { loading: shouldResolve && !cached, thread: cached ?? null, error: null };
  });
  useEffect(() => {
    let cancelled = false;
    if (!shouldResolve) {
      setState({ loading: false, thread: null, error: null });
      return;
    }
    // Show the last good result immediately and revalidate in the background.
    const cached = inboxThreadCache.get(cacheKey);
    setState(cached ? { loading: false, thread: cached, error: null } : { loading: true, thread: null, error: null });
    void resolveInboxThread({ projectId, sessionId, origin: { threadId } }).then(
      (thread) => {
        // A thread that no longer resolves must not keep flashing its old copy.
        if (thread) inboxThreadCache.set(cacheKey, thread);
        else inboxThreadCache.delete(cacheKey);
        if (!cancelled) setState({ loading: false, thread, error: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        // A failed revalidation keeps the cached view; failures are never cached.
        if (cached) { setState({ loading: false, thread: cached, error: null }); return; }
        setState({ loading: false, thread: null, error: error instanceof Error ? error.message : 'Could not load the original conversation.' });
      }
    );
    return () => { cancelled = true; };
  }, [projectId, sessionId, threadId, shouldResolve, attempt, cacheKey]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
