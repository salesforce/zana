import { describe, expect, it } from 'vitest';
import type { MarketplaceCatalogRow } from '@zana-ai/zcc-domain';
import { catalogCountLabel, catalogErrorText, catalogKindLabel } from './marketplace-catalogs.js';

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
