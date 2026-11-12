import { marketplaceCatalogFreshness, type MarketplaceCatalogRow } from '@zana-ai/zcc-domain';

export function catalogKindLabel(kind: MarketplaceCatalogRow['sourceKind']): string {
  if (kind === 'git') return 'git';
  if (kind === 'path') return 'path';
  return 'https';
}

export function catalogCountLabel(row: MarketplaceCatalogRow): string {
  const n = row.entryCount;
  return n === 1 ? '1 plugin' : `${n} plugins`;
}

export function catalogErrorText(row: MarketplaceCatalogRow): string | null {
  const error = row.lastError?.trim();
  return error ? error : null;
}

export function catalogAgeLabel(at: number | null, now: number): string {
  if (at == null) return 'never';
  const diff = Math.max(0, now - at);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

export type CatalogFreshnessSummary = { total: number; stale: number; failed: number };

export function summarizeCatalogFreshness(rows: MarketplaceCatalogRow[], now: number): CatalogFreshnessSummary {
  let stale = 0, failed = 0;
  for (const row of rows) {
    const state = marketplaceCatalogFreshness(row, now);
    if (state === 'stale') stale++;
    else if (state === 'failed') failed++;
  }
  return { total: rows.length, stale, failed };
}

/** Problems first (failed, then stale), oldest successful refresh first within each group. */
export function sortCatalogsByFreshness(rows: MarketplaceCatalogRow[], now: number): MarketplaceCatalogRow[] {
  const rank = { failed: 0, stale: 1, fresh: 2 } as const;
  return [...rows].sort((a, b) =>
    rank[marketplaceCatalogFreshness(a, now)] - rank[marketplaceCatalogFreshness(b, now)]
    || (a.lastRefreshAt ?? 0) - (b.lastRefreshAt ?? 0));
}

export function catalogFreshnessDetail(row: MarketplaceCatalogRow, now: number): string {
  const state = marketplaceCatalogFreshness(row, now);
  if (state === 'failed') return `Refresh failed ${catalogAgeLabel(row.lastAttemptAt, now)} · ${catalogErrorText(row)}`;
  if (state === 'stale') return row.lastRefreshAt == null ? 'Never refreshed' : `Out of date · ${catalogAgeLabel(row.lastRefreshAt, now)}`;
  return `Updated ${catalogAgeLabel(row.lastRefreshAt, now)}`;
}
