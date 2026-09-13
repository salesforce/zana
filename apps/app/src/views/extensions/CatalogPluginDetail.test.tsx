import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { CatalogPluginDetail, PluginMoreFromAuthor } from './CatalogPluginDetail.js';

function entry(over: Partial<MarketplaceEntry> & Pick<MarketplaceEntry, 'id'>): MarketplaceEntry {
  return {
    version: '1.0.0',
    title: over.title ?? over.id,
    author: 'Ada',
    installed: false,
    hasUpdate: false,
    compatible: true,
    source: 'bundled',
    ...over
  };
}

describe('CatalogPluginDetail', () => {
  it('shows Install, Includes, and more from the same author', () => {
    const html = renderToStaticMarkup(
      h(CatalogPluginDetail, {
        entry: entry({
          id: 'tasks',
          title: 'Tasks',
          description: 'Plan work',
          category: 'Workflow management',
          skillNames: ['tasks']
        }),
        catalog: [
          entry({ id: 'tasks', title: 'Tasks', skillNames: ['tasks'] }),
          entry({ id: 'notes', title: 'Notes' })
        ],
        onInstall: () => {},
        onOpenPlugin: () => {}
      })
    );
    expect(html).toContain('catalog-plugin-detail');
    expect(html).toContain('Install');
    expect(html).toContain('Includes');
    expect(html).toContain('Workflow management');
    expect(html).toContain('plugin-more-from-author');
    expect(html).toContain('Notes');
  });
});

describe('PluginMoreFromAuthor', () => {
  it('omits the current plugin and authors without siblings', () => {
    const empty = renderToStaticMarkup(
      h(PluginMoreFromAuthor, {
        entry: entry({ id: 'solo', author: 'Bea' }),
        catalog: [entry({ id: 'solo', author: 'Bea' })],
        onOpen: () => {},
        onInstall: () => {}
      })
    );
    expect(empty).toBe('');
  });
});
