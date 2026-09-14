import { describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { catalogRowAction, PluginCatalogCard } from './PluginCatalogCard.js';

function entry(over: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'tasks',
    version: '1.0.0',
    title: 'Tasks',
    author: 'Ada',
    installed: false,
    hasUpdate: false,
    compatible: true,
    source: 'bundled',
    ...over
  };
}

describe('catalogRowAction', () => {
  it('labels install, installed, update, and incompatible states', () => {
    expect(catalogRowAction(entry()).label).toBe('Install');
    expect(catalogRowAction(entry({ installed: true })).label).toBe('Installed');
    expect(catalogRowAction(entry({ installed: true, hasUpdate: true })).label).toBe('Update');
    expect(catalogRowAction(entry({ compatible: false })).label).toBe('Incompatible');
    expect(catalogRowAction(entry(), 'Installing…').disabled).toBe(true);
  });
});

describe('PluginCatalogCard', () => {
  it('keeps Install on the action control and opens detail from the card body', () => {
    const onOpen = vi.fn();
    const onInstall = vi.fn();
    const html = renderToStaticMarkup(
      h(PluginCatalogCard, {
        entry: entry(),
        onOpen,
        onInstall,
        onOpenAuthor: () => {}
      })
    );
    expect(html).toContain('aria-label="Tasks plugin details"');
    expect(html).toContain('Install');
    expect(html).toContain('ext-browse-author-link');
    expect(html).toContain('>Ada</button>');
    expect(html).not.toContain('role="link"');
  });

  it('shows a green Installed pill instead of a disabled button', () => {
    const html = renderToStaticMarkup(
      h(PluginCatalogCard, {
        entry: entry({ installed: true }),
        onOpen: () => {},
        onInstall: () => {}
      })
    );
    expect(html).toContain('ext-browse-installed-pill');
    expect(html).not.toContain('settings-btn');
  });
});
