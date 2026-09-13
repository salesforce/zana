import { describe, expect, it } from 'vitest';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import {
  SHELF_ENTRY_LIMIT,
  UNCATEGORIZED_PLUGIN_CATEGORY_ID,
  authorDisplayName,
  authorKey,
  entriesByAuthor,
  pluginBrowseShelves,
  pluginCategoryFilterId,
  pluginCategoryFilterOptions,
  shelfPreviewEntries,
  sortPluginEntries
} from './plugin-browse-discovery.js';

function entry(over: Partial<MarketplaceEntry> & Pick<MarketplaceEntry, 'id'>): MarketplaceEntry {
  return {
    version: '1.0.0',
    title: over.title ?? over.id,
    installed: false,
    hasUpdate: false,
    compatible: true,
    source: 'bundled',
    ...over
  };
}

describe('pluginBrowseShelves', () => {
  it('orders shelves by the curated catalog and parks unknown rows last', () => {
    const shelves = pluginBrowseShelves([
      entry({ id: 'mystery' }),
      entry({ id: 'docs', category: 'Context & knowledge' }),
      entry({ id: 'tasks', category: 'Workflow management' }),
      entry({ id: 'pi', category: 'Agent interaction' })
    ]);
    expect(shelves.map((shelf) => shelf.label)).toEqual([
      'Workflow management',
      'Agent interaction',
      'Context & knowledge',
      'More plugins'
    ]);
    expect(shelves[0]?.description).toBe('Boards, automations, and structured work.');
    expect(shelves.at(-1)?.key).toBe(`category:${UNCATEGORIZED_PLUGIN_CATEGORY_ID}`);
    expect(shelves.at(-1)?.entries.map((row) => row.id)).toEqual(['mystery']);
  });

  it('omits empty curated categories', () => {
    const shelves = pluginBrowseShelves([entry({ id: 'docs', category: 'Context & knowledge' })]);
    expect(shelves).toHaveLength(1);
    expect(shelves[0]?.category).toBe('Context & knowledge');
  });
});

describe('plugin category filters', () => {
  it('uses uncategorized for rows without a store category', () => {
    expect(pluginCategoryFilterId(entry({ id: 'x' }))).toBe(UNCATEGORIZED_PLUGIN_CATEGORY_ID);
    expect(pluginCategoryFilterId(entry({ id: 'docs', category: 'Context & knowledge' }))).toBe(
      'Context & knowledge'
    );
  });

  it('lists populated categories and keeps a selected empty one visible', () => {
    const options = pluginCategoryFilterOptions(
      [
        entry({ id: 'docs', category: 'Context & knowledge' }),
        entry({ id: 'memory', category: 'Context & knowledge' }),
        entry({ id: 'other' })
      ],
      ['Host access']
    );
    expect(options.map((option) => option.id)).toEqual([
      'Context & knowledge',
      UNCATEGORIZED_PLUGIN_CATEGORY_ID,
      'Host access'
    ]);
    expect(options[0]?.count).toBe(2);
    expect(options.at(-1)?.count).toBe(0);
  });
});

describe('sortPluginEntries', () => {
  it('sorts by title', () => {
    const rows = [
      entry({ id: 'b', title: 'Beta' }),
      entry({ id: 'a', title: 'Alpha' })
    ];
    expect(sortPluginEntries(rows, 'name', 'asc').map((row) => row.id)).toEqual(['a', 'b']);
    expect(sortPluginEntries(rows, 'name', 'desc').map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('author grouping', () => {
  it('matches authors case-insensitively', () => {
    const rows = [
      entry({ id: 'docs', author: 'ZCC', category: 'Context & knowledge' }),
      entry({ id: 'tasks', author: 'zcc' }),
      entry({ id: 'notes', author: 'Ada' })
    ];
    expect(authorKey(' ZCC ')).toBe('zcc');
    expect(entriesByAuthor(rows, 'zcc').map((row) => row.id)).toEqual(['docs', 'tasks']);
    expect(authorDisplayName(rows, 'zcc')).toBe('ZCC');
  });
});

describe('shelf card cap', () => {
  it('caps a collapsed shelf at six cards', () => {
    const rows = Array.from({ length: 8 }, (_, index) => entry({ id: `p${index}` }));
    expect(shelfPreviewEntries(rows, false)).toHaveLength(SHELF_ENTRY_LIMIT);
    expect(shelfPreviewEntries(rows, true)).toHaveLength(8);
  });
});
