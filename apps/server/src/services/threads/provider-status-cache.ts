import type { ProviderStatusResult } from '@zana-ai/zcc-contracts/host-rpc';

/** How long a usable `provider.status` result is reused for one host. */
export const PROVIDER_STATUS_CACHE_TTL_MS = 30_000;

export interface ProviderStatusCacheKey {
  hostId: string;
  /** Identity of the host connection (instance id and connect time). A reconnect changes it. */
  connectionKey: string;
  /** Identity of the saved app settings (a hash of the config file). Any settings change changes it. */
  settingsKey: string;
}

export interface ProviderStatusCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

export interface ProviderStatusCache {
  /**
   * Returns the host's provider status, calling `fetch` at most once for
   * concurrent callers and at most once per TTL while the result stays usable.
   *
   * `isUsable` judges the result for this caller's providers. A result that is
   * not usable is returned to the caller but never stored, and a stored result
   * that is not usable for the next caller is bypassed and refetched. A failed
   * fetch is never stored.
   */
  get(
    key: ProviderStatusCacheKey,
    fetch: () => Promise<ProviderStatusResult>,
    isUsable: (status: ProviderStatusResult) => boolean
  ): Promise<ProviderStatusResult>;
  invalidate(hostId?: string): void;
}

interface StoredEntry { connectionKey: string; settingsKey: string; value: ProviderStatusResult; expiresAt: number }
interface InFlightEntry { connectionKey: string; settingsKey: string; promise: Promise<ProviderStatusResult> }

function sameKeys(entry: { connectionKey: string; settingsKey: string }, key: ProviderStatusCacheKey): boolean {
  return entry.connectionKey === key.connectionKey && entry.settingsKey === key.settingsKey;
}

/** Entries are keyed by host id first, so one host's result is never served for another. */
export function createProviderStatusCache(options: ProviderStatusCacheOptions = {}): ProviderStatusCache {
  const ttlMs = options.ttlMs ?? PROVIDER_STATUS_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const stored = new Map<string, StoredEntry>();
  const inFlight = new Map<string, InFlightEntry>();
  return {
    get(key, fetch, isUsable) {
      const hit = stored.get(key.hostId);
      if (hit && sameKeys(hit, key) && hit.expiresAt > now() && isUsable(hit.value)) return Promise.resolve(hit.value);
      if (hit && (!sameKeys(hit, key) || hit.expiresAt <= now())) stored.delete(key.hostId);
      const pending = inFlight.get(key.hostId);
      if (pending && sameKeys(pending, key)) return pending.promise;
      const promise = fetch().then((value) => {
        if (isUsable(value)) stored.set(key.hostId, { connectionKey: key.connectionKey, settingsKey: key.settingsKey, value, expiresAt: now() + ttlMs });
        else stored.delete(key.hostId);
        return value;
      }).finally(() => {
        if (inFlight.get(key.hostId)?.promise === promise) inFlight.delete(key.hostId);
      });
      inFlight.set(key.hostId, { connectionKey: key.connectionKey, settingsKey: key.settingsKey, promise });
      return promise;
    },
    invalidate(hostId) {
      if (hostId === undefined) { stored.clear(); inFlight.clear(); return; }
      stored.delete(hostId);
      inFlight.delete(hostId);
    }
  };
}
