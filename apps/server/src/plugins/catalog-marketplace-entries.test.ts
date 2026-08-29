import { describe, expect, it } from 'vitest';
import {
  projectCatalogMarketplaceEntries,
  resolveCatalogInstallSpec,
  mergeShippedWithCatalogs
} from './catalog-marketplace-entries.js';
import type { MarketplaceCatalogRow } from './marketplace-store.js';
import type { MarketplaceIndex } from './marketplace.js';

function catalog(
  over: Partial<MarketplaceCatalogRow> & { cachedIndex: MarketplaceIndex }
): MarketplaceCatalogRow {
  return {
    source: 'https://example.test/mp.json',
    sourceKind: 'https',
    name: 'community',
    displayName: 'Community',
    addedAt: 1,
    entryCount: over.cachedIndex.plugins.length,
    lastRefreshAt: 1,
    lastAttemptAt: 1,
    lastError: null,
    official: false,
    ...over
  };
}

const NOTES: MarketplaceIndex = {
  schemaVersion: 1,
  name: 'zana-community',
  displayName: 'Zana Community',
  plugins: [
    {
      id: 'notes',
      displayName: 'Notes',
      description: 'A notes panel',
      author: { name: 'Ada' },
      icon: { lucide: 'StickyNote' },
      source: { npm: { package: '@zana/notes', range: '1.2.0' } }
    }
  ]
};

describe('projectCatalogMarketplaceEntries', () => {
  it('does not invent rows when no catalogs are configured', () => {
    expect(projectCatalogMarketplaceEntries([], new Set(['docs']))).toEqual([]);
  });

  it('projects cached catalog plugins, not bundled plugin ids', () => {
    const rows = projectCatalogMarketplaceEntries(
      [catalog({ cachedIndex: NOTES })],
      new Set(['docs', 'notes']),
      new Map([['notes', '1.0.0']])
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'notes',
      title: 'Notes',
      author: 'Ada',
      icon: 'StickyNote',
      source: 'marketplace',
      tags: ['community'],
      installed: true,
      installedVersion: '1.0.0',
      version: '1.2.0'
    });
    expect(rows.map((row) => row.id)).not.toContain('docs');
  });

  it('badges an official catalog and prefers it over a community twin', () => {
    const community = catalog({
      source: 'https://example.test/community.json',
      cachedIndex: NOTES
    });
    const official = catalog({
      source: 'https://example.test/official.json',
      name: 'official',
      displayName: 'Official',
      official: true,
      cachedIndex: {
        ...NOTES,
        plugins: [
          {
            ...NOTES.plugins[0]!,
            displayName: 'Notes Official',
            source: { npm: { package: '@zana/notes', range: '2.0.0' } }
          }
        ]
      }
    });
    const rows = projectCatalogMarketplaceEntries([community, official], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Notes Official');
    expect(rows[0]?.tags).toEqual(['official']);
  });
});

describe('resolveCatalogInstallSpec', () => {
  it('returns the npm spec main owns for a listed id', () => {
    expect(resolveCatalogInstallSpec([catalog({ cachedIndex: NOTES })], 'notes')).toBe(
      'npm:@zana/notes@1.2.0'
    );
  });

  it('returns null for an id no catalog lists', () => {
    expect(resolveCatalogInstallSpec([catalog({ cachedIndex: NOTES })], 'docs')).toBeNull();
    expect(resolveCatalogInstallSpec([], 'notes')).toBeNull();
  });
});

describe('mergeShippedWithCatalogs', () => {
  function row(
    id: string,
    over: Partial<ReturnType<typeof projectCatalogMarketplaceEntries>[number]> = {}
  ) {
    return {
      id,
      version: '1.0.0',
      title: id,
      installed: true,
      hasUpdate: false,
      compatible: true,
      source: 'bundled' as const,
      tags: ['official'],
      ...over
    };
  }

  it('keeps shipped plugins and appends catalog-only ids', () => {
    const merged = mergeShippedWithCatalogs(
      [row('docs')],
      [row('notes', { source: 'marketplace', tags: ['community'], installed: false })]
    );
    expect(merged.map((entry) => entry.id)).toEqual(['docs', 'notes']);
  });

  it('does not let a catalog replace a shipped plugin of the same id', () => {
    const merged = mergeShippedWithCatalogs(
      [row('docs', { title: 'Docs' })],
      [row('docs', { title: 'Docs from BB', source: 'marketplace', tags: ['community'] })]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('Docs');
    expect(merged[0]?.source).toBe('bundled');
  });
});
