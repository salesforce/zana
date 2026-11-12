import { describe, expect, it } from 'vitest';
import type { MarketplaceCatalogRow } from '@zana-ai/zcc-domain';
import {
  catalogAgeLabel,
  catalogCountLabel,
  catalogErrorText,
  catalogFreshnessDetail,
  catalogKindLabel,
  sortCatalogsByFreshness,
  summarizeCatalogFreshness
} from './marketplace-catalogs.js';

function row(overrides: Partial<MarketplaceCatalogRow> = {}): MarketplaceCatalogRow {
  return {
    source: 'https://example.test/mp.json',
    sourceKind: 'https',
    name: 'official',
    displayName: 'Official',
    addedAt: 1,
    entryCount: 3,
    lastRefreshAt: 2,
    lastAttemptAt: 2,
    lastError: null,
    official: false,
    ...overrides
  };
}

describe('marketplace catalog labels', () => {
  it('labels source kinds and plugin counts', () => {
    expect(catalogKindLabel('https')).toBe('https');
    expect(catalogKindLabel('git')).toBe('git');
    expect(catalogKindLabel('path')).toBe('path');
    expect(catalogCountLabel(row({ entryCount: 1 }))).toBe('1 plugin');
    expect(catalogCountLabel(row())).toBe('3 plugins');
  });

  it('surfaces the last refresh error when present', () => {
    expect(catalogErrorText(row())).toBeNull();
    expect(catalogErrorText(row({ lastError: '  timed out  ' }))).toBe('timed out');
  });
});

describe('marketplace catalog freshness labels', () => {
  const HOUR = 3_600_000, NOW = 100 * 24 * HOUR;
  it('formats ages from minutes to days', () => {
    expect(catalogAgeLabel(null, NOW)).toBe('never');
    expect(catalogAgeLabel(NOW - 1000, NOW)).toBe('just now');
    expect(catalogAgeLabel(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(catalogAgeLabel(NOW - 3 * HOUR, NOW)).toBe('3h ago');
    expect(catalogAgeLabel(NOW - 50 * HOUR, NOW)).toBe('2d ago');
    expect(catalogAgeLabel(NOW + 1000, NOW)).toBe('just now');
  });
  it('summarizes, sorts problems first, and describes each source', () => {
    const fresh = row({ displayName: 'Fresh', lastRefreshAt: NOW - HOUR });
    const stale = row({ displayName: 'Stale', lastRefreshAt: NOW - 30 * HOUR });
    const never = row({ displayName: 'Never', lastRefreshAt: null });
    const failed = row({ displayName: 'Failed', lastRefreshAt: NOW - HOUR, lastAttemptAt: NOW - 2 * HOUR, lastError: 'HTTP 429' });
    expect(summarizeCatalogFreshness([fresh, stale, never, failed], NOW)).toEqual({ total: 4, stale: 2, failed: 1 });
    expect(sortCatalogsByFreshness([fresh, stale, failed, never], NOW).map((r) => r.displayName)).toEqual(['Failed', 'Never', 'Stale', 'Fresh']);
    expect(catalogFreshnessDetail(fresh, NOW)).toBe('Updated 1h ago');
    expect(catalogFreshnessDetail(stale, NOW)).toBe('Out of date · 1d ago');
    expect(catalogFreshnessDetail(never, NOW)).toBe('Never refreshed');
    expect(catalogFreshnessDetail(failed, NOW)).toBe('Refresh failed 2h ago · HTTP 429');
  });
});
