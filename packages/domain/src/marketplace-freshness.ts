import type { MarketplaceCatalogRow } from './plugin-marketplace.js';

/** A catalog not refreshed successfully within this window is out of date. */
export const MARKETPLACE_CATALOG_STALE_MS = 24 * 60 * 60 * 1000;
/** Automatic refreshes leave a source alone this long after any attempt, so failing or rate-limited sources back off. */
export const MARKETPLACE_CATALOG_RETRY_BACKOFF_MS = 60 * 60 * 1000;

export type MarketplaceCatalogFreshness = 'fresh' | 'stale' | 'failed';

type FreshnessFields = Pick<MarketplaceCatalogRow, 'lastRefreshAt' | 'lastAttemptAt' | 'lastError'>;

export function marketplaceCatalogFreshness(row: FreshnessFields, now: number): MarketplaceCatalogFreshness {
  if (row.lastError?.trim()) return 'failed';
  if (row.lastRefreshAt == null || now - row.lastRefreshAt >= MARKETPLACE_CATALOG_STALE_MS) return 'stale';
  return 'fresh';
}

/** Whether a background or on-open refresh should touch this source. Manual refresh is always allowed. */
export function marketplaceCatalogNeedsAutoRefresh(row: FreshnessFields, now: number): boolean {
  if (marketplaceCatalogFreshness(row, now) === 'fresh') return false;
  return row.lastAttemptAt == null || now - row.lastAttemptAt >= MARKETPLACE_CATALOG_RETRY_BACKOFF_MS;
}
