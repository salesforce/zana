/**
 * Last answers of the Studio's read-only tabs (Lightning Types, components), keyed by plugin, project and ref. A tab that
 * remounts shows its last answer at once while it reads again, instead of a loading state. Bounded, oldest first out.
 */
const READ_CACHE_LIMIT = 32;
const cache = new Map<string, unknown>();

export const readCacheKey = (pluginId: string, projectId: string | undefined, kind: string, ref: string) => JSON.stringify([pluginId, projectId ?? '', kind, ref]);

export function cachedRead<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function rememberRead(key: string, value: unknown): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > READ_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/** Tests only. */
export function clearReadCache(): void {
  cache.clear();
}
