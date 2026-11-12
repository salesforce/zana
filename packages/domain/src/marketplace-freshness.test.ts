import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_CATALOG_RETRY_BACKOFF_MS,
  MARKETPLACE_CATALOG_STALE_MS,
  marketplaceCatalogFreshness,
  marketplaceCatalogNeedsAutoRefresh
} from './marketplace-freshness.js';

const NOW = 10 * MARKETPLACE_CATALOG_STALE_MS;
const row = (over: Partial<{ lastRefreshAt: number | null; lastAttemptAt: number | null; lastError: string | null }> = {}) => ({
  lastRefreshAt: NOW - 1000, lastAttemptAt: NOW - 1000, lastError: null, ...over
});

describe('marketplaceCatalogFreshness', () => {
  it('is fresh inside the window, stale at or past it, and stale when never refreshed', () => {
    expect(marketplaceCatalogFreshness(row(), NOW)).toBe('fresh');
    expect(marketplaceCatalogFreshness(row({ lastRefreshAt: NOW - MARKETPLACE_CATALOG_STALE_MS }), NOW)).toBe('stale');
    expect(marketplaceCatalogFreshness(row({ lastRefreshAt: null }), NOW)).toBe('stale');
  });
  it('reports a recorded error as failed, ignoring blank errors', () => {
    expect(marketplaceCatalogFreshness(row({ lastError: 'HTTP 429' }), NOW)).toBe('failed');
    expect(marketplaceCatalogFreshness(row({ lastError: '  ' }), NOW)).toBe('fresh');
  });
});

describe('marketplaceCatalogNeedsAutoRefresh', () => {
  it('skips fresh sources', () => {
    expect(marketplaceCatalogNeedsAutoRefresh(row(), NOW)).toBe(false);
  });
  it('refreshes stale sources once the backoff since the last attempt has passed', () => {
    const stale = { lastRefreshAt: NOW - 2 * MARKETPLACE_CATALOG_STALE_MS };
    expect(marketplaceCatalogNeedsAutoRefresh(row({ ...stale, lastAttemptAt: stale.lastRefreshAt }), NOW)).toBe(true);
    expect(marketplaceCatalogNeedsAutoRefresh(row({ ...stale, lastAttemptAt: null }), NOW)).toBe(true);
    expect(marketplaceCatalogNeedsAutoRefresh(row({ ...stale, lastAttemptAt: NOW - 1000 }), NOW)).toBe(false);
  });
  it('backs off failed sources until the retry window passes', () => {
    expect(marketplaceCatalogNeedsAutoRefresh(row({ lastError: 'HTTP 429', lastAttemptAt: NOW - 1000 }), NOW)).toBe(false);
    expect(marketplaceCatalogNeedsAutoRefresh(row({ lastError: 'HTTP 429', lastAttemptAt: NOW - MARKETPLACE_CATALOG_RETRY_BACKOFF_MS }), NOW)).toBe(true);
  });
});
