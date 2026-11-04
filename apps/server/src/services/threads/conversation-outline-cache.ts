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
/**
 * Find-in-thread texts hold every message in full, so they live in their own
 * bucket: a few threads at most, never evicting outlines. Hits share the
 * stored value rather than cloning megabytes per query; callers only read it.
 */
export const SEARCH_TEXT_CACHE_ENTRIES = 4;
export const SEARCH_TEXT_CACHE_BYTES = 16 * 1024 * 1024;

export type OutlineCacheBucket = 'outline' | 'search-text';
const LIMITS: Record<OutlineCacheBucket, { entries: number; bytes: number; clone: boolean }> = {
  outline: { entries: OUTLINE_CACHE_ENTRIES, bytes: OUTLINE_CACHE_BYTES, clone: true },
  'search-text': { entries: SEARCH_TEXT_CACHE_ENTRIES, bytes: SEARCH_TEXT_CACHE_BYTES, clone: false }
};

interface Entry {
  revision: string;
  context: string;
  result: unknown;
  bytes: number;
}
interface Cache { entries: Map<string, Entry>; bytes: number }
const caches = new WeakMap<ZccDatabase, Map<OutlineCacheBucket, Cache>>();

/**
 * Cache only an unchanged database snapshot, including writes by other connections.
 * Each bucket has its own entry and byte caps; a result over the byte cap is
 * returned without being cached.
 */
export function cachedConversationOutline<T = ConversationOutlineResult>(
  db: ZccDatabase,
  key: string,
  context: string,
  project: () => T,
  bucket: OutlineCacheBucket = 'outline'
): T {
  const limits = LIMITS[bucket];
  const changes = (db.sqlite.prepare('SELECT total_changes() AS changes').get() as { changes: number }).changes;
  const revision = `${changes}:${db.sqlite.pragma('data_version', { simple: true })}`;
  let buckets = caches.get(db);
  if (!buckets) { buckets = new Map(); caches.set(db, buckets); }
  let cache = buckets.get(bucket);
  if (!cache) { cache = { entries: new Map(), bytes: 0 }; buckets.set(bucket, cache); }
  const previous = cache.entries.get(key);
  if (previous?.revision === revision && previous.context === context) {
    cache.entries.delete(key);
    cache.entries.set(key, previous);
    return limits.clone ? structuredClone(previous.result as T) : previous.result as T;
  }
  // A failed projection propagates; it never turns into a stale successful answer.
  const result = project();
  const bytes = Buffer.byteLength(JSON.stringify(result));
  cache.bytes -= previous?.bytes ?? 0;
  cache.entries.delete(key);
  if (bytes <= limits.bytes) {
    cache.entries.set(key, { revision, context, result: limits.clone ? structuredClone(result) : result, bytes });
    cache.bytes += bytes;
    while (cache.entries.size > limits.entries || cache.bytes > limits.bytes) {
      const oldest = cache.entries.keys().next().value!;
      cache.bytes -= cache.entries.get(oldest)!.bytes;
      cache.entries.delete(oldest);
    }
  }
  return result;
}
