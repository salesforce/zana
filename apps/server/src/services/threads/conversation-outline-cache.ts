import type { ZccDatabase } from '@zana-ai/zcc-db';

export interface ConversationOutlineResult {
  items: Array<{
    id: string;
    role: 'user' | 'assistant';
    preview: string;
    attachmentSummary: { imageCount: number; fileCount: number } | null;
  }>;
  maxSeq: number;
}

export const OUTLINE_CACHE_ENTRIES = 32;
export const OUTLINE_CACHE_BYTES = 4 * 1024 * 1024;
interface Entry {
  revision: string;
  context: string;
  result: unknown;
  bytes: number;
}
interface Cache { entries: Map<string, Entry>; bytes: number }
const caches = new WeakMap<ZccDatabase, Cache>();

/**
 * Cache only an unchanged database snapshot, including writes by other connections.
 * `key` is the thread id, or a thread-scoped key for a sibling projection (the
 * find-in-thread texts); every entry shares the entry and byte caps.
 */
export function cachedConversationOutline<T = ConversationOutlineResult>(
  db: ZccDatabase,
  key: string,
  context: string,
  project: () => T
): T {
  const changes = (db.sqlite.prepare('SELECT total_changes() AS changes').get() as { changes: number }).changes;
  const revision = `${changes}:${db.sqlite.pragma('data_version', { simple: true })}`;
  let cache = caches.get(db);
  if (!cache) { cache = { entries: new Map(), bytes: 0 }; caches.set(db, cache); }
  const previous = cache.entries.get(key);
  if (previous?.revision === revision && previous.context === context) {
    cache.entries.delete(key);
    cache.entries.set(key, previous);
    return structuredClone(previous.result as T);
  }
  // A failed projection propagates; it never turns into a stale successful answer.
  const result = project();
  const bytes = Buffer.byteLength(JSON.stringify(result));
  cache.bytes -= previous?.bytes ?? 0;
  cache.entries.delete(key);
  if (bytes <= OUTLINE_CACHE_BYTES) {
    cache.entries.set(key, { revision, context, result: structuredClone(result), bytes });
    cache.bytes += bytes;
    while (cache.entries.size > OUTLINE_CACHE_ENTRIES || cache.bytes > OUTLINE_CACHE_BYTES) {
      const oldest = cache.entries.keys().next().value!;
      cache.bytes -= cache.entries.get(oldest)!.bytes;
      cache.entries.delete(oldest);
    }
  }
  return result;
}
