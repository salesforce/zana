import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { filterMarketplaceEntries, marketplaceTags } from './marketplace-filter.js';

const sampleEntries: MarketplaceEntry[] = [
  {
    id: 'hello-sample',
    version: '1.0.0',
    title: 'Hello Sample',
    description: 'A minimal test plugin',
    author: 'Test Author',
    icon: 'Sparkles',
    installed: false,
    compatible: true,
    hasUpdate: false,
    source: 'bundled',
    tags: ['official'],
    skillNames: ['hello']
  },
  {
    id: 'gus',
    version: '2.0.0',
    title: 'GUS Tickets',
    description: 'Work item tracking integration',
    author: 'Core Team',
    installed: true,
    installedVersion: '1.5.0',
    compatible: true,
    hasUpdate: true,
    source: 'marketplace',
    tags: ['community']
  }
];

describe('filterMarketplaceEntries', () => {
  it('returns all entries when search is empty', () => {
    expect(filterMarketplaceEntries(sampleEntries, '')).toHaveLength(2);
  });

  it('filters by title case-insensitively', () => {
    expect(filterMarketplaceEntries(sampleEntries, 'hello').map((e) => e.id)).toEqual(['hello-sample']);
  });

  it('filters by official tag', () => {
    expect(filterMarketplaceEntries(sampleEntries, '', 'official').map((e) => e.id)).toEqual(['hello-sample']);
  });

  it('filters updates', () => {
    expect(filterMarketplaceEntries(sampleEntries, '', 'update').map((e) => e.id)).toEqual(['gus']);
  });
});

describe('marketplaceTags', () => {
  it('marks bundled rows official and updates as update', () => {
    expect(marketplaceTags(sampleEntries[0]!)).toEqual(['official']);
    expect(marketplaceTags(sampleEntries[1]!)).toEqual(['community', 'update']);
  });
});

describe('MarketplaceView presentation', () => {
  const source = readFileSync(new URL('./MarketplaceView.tsx', import.meta.url), 'utf8');

  it('uses a compact trust note, pill filters, and a single provenance chip', () => {
    expect(source).toContain('ext-market-note');
    expect(source).toContain('ext-market-tag');
    expect(source).toContain('ext-market-item-icon-wrap');
    expect(source).toContain("provenance === 'official' ? 'Official' : 'Community'");
    expect(source).not.toContain('marketplaceTags(entry)');
    expect(source).not.toContain("? 'Bundled' : 'Marketplace'");
  });
});
