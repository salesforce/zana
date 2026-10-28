// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { catalogRowAction, marketplaceProvenance, PluginCatalogCard, PluginCatalogGrid } from './PluginCatalogCard.js';

afterEach(cleanup);

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

  it('offers Manage for installed plugins', () => {
    const html = renderToStaticMarkup(
      h(PluginCatalogCard, {
        entry: entry({ installed: true }),
        onOpen: () => {},
        onInstall: () => {}
      })
    );
    expect(html).toContain('Manage');
    expect(html).not.toContain('disabled=');
  });

  it('puts the category under the title, the description across the body, and actions with author and source in the footer', () => {
    const onOpen = vi.fn(), onInstall = vi.fn(), onOpenAuthor = vi.fn();
    const view = render(<PluginCatalogCard entry={entry({ description: 'Plan your work.', category: 'Workflow management', skillNames: ['planning'] })}
      showCategory onOpen={onOpen} onInstall={onInstall} onOpenAuthor={onOpenAuthor} />);
    const body = view.container.querySelector('.ext-browse-card-open')!;
    expect(within(body as HTMLElement).getByText('Workflow management').parentElement?.className).toBe('ext-browse-card-body');
    expect(within(body as HTMLElement).getByText('Plan your work.').parentElement).toBe(body);
    expect(within(body as HTMLElement).queryByText('Official')).toBeNull();
    expect(screen.getByText('Skills').closest('.ext-browse-card-main')).toBeTruthy();
    const footer = view.container.querySelector('footer')!;
    const install = within(footer).getByRole('button', { name: 'Install' });
    expect(install.classList.contains('primary')).toBe(false);
    expect(within(footer).getByText('Official')).toBeTruthy();
    fireEvent.click(install);
    expect(onInstall).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(within(footer).getByRole('button', { name: 'Ada' }));
    expect(onOpenAuthor).toHaveBeenCalledWith('Ada');
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks plugin details' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('retains update emphasis and surfaces failures outside the details button', () => {
    const onInstall = vi.fn();
    const view = render(<PluginCatalogCard entry={entry({ hasUpdate: true, installed: true, author: undefined })}
      onOpen={vi.fn()} onInstall={onInstall} error="Download interrupted" />);
    const update = screen.getByRole('button', { name: 'Update' });
    expect(update.classList.contains('primary')).toBe(true);
    fireEvent.click(update);
    expect(onInstall).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toBe('Download interrupted');
    expect(screen.getByRole('alert').closest('button')).toBeNull();
    expect(view.container.querySelector('.ext-browse-card-byline')).toBeNull();
    expect(view.container.querySelector('.ext-plugin-capabilities')).toBeNull();
    expect(view.container.querySelector('.ext-market-item-desc')).toBeNull();
  });

  it('keeps busy and incompatible actions disabled and routes Manage to details', () => {
    const onOpen = vi.fn(), onInstall = vi.fn();
    const view = render(<PluginCatalogCard entry={entry()} busy="Installing…" onOpen={onOpen} onInstall={onInstall} />);
    const busy = screen.getByRole('button', { name: 'Installing…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    view.rerender(<PluginCatalogCard entry={entry({ compatible: false })} onOpen={onOpen} onInstall={onInstall} />);
    const incompatible = screen.getByRole('button', { name: 'Incompatible' }) as HTMLButtonElement;
    expect(incompatible.disabled).toBe(true);
    fireEvent.click(incompatible);
    expect(onInstall).not.toHaveBeenCalled();
    view.rerender(<PluginCatalogCard entry={entry({ installed: true })} onOpen={onOpen} onInstall={onInstall} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows community provenance and handles missing metadata and authors without links', () => {
    const view = render(<PluginCatalogCard entry={entry({ source: 'marketplace', category: 'Interface', author: ' Ada ', mcpServers: [{ name: 'tools' }] })}
      onOpen={vi.fn()} onInstall={vi.fn()} />);
    expect(screen.getByText('Community').getAttribute('data-provenance')).toBe('community');
    expect(screen.getByText('MCP')).toBeTruthy();
    expect(view.container.querySelector('.ext-browse-card-category')).toBeNull();
    expect(view.container.querySelector('.ext-browse-author-link')).toBeNull();
    expect(screen.getByText('By Ada')).toBeTruthy();
    view.rerender(<PluginCatalogCard entry={entry({ author: ' ', category: undefined })} showCategory onOpen={vi.fn()} onInstall={vi.fn()} />);
    expect(view.container.querySelector('.ext-browse-card-category')).toBeNull();
    expect(view.container.querySelector('.ext-browse-card-byline')).toBeNull();
    expect(marketplaceProvenance(entry({ source: 'marketplace', tags: ['official'] }))).toBe('official');
  });
});

describe('PluginCatalogGrid', () => {
  it('renders an empty state and forwards card actions and per-plugin progress and errors', () => {
    const onOpen = vi.fn(), onInstall = vi.fn(), onOpenAuthor = vi.fn();
    const props = { busy: {}, errors: {}, onOpen, onInstall, onOpenAuthor };
    const view = render(<PluginCatalogGrid entries={[]} {...props} empty={<p>No matching plugins</p>} />);
    expect(screen.getByText('No matching plugins')).toBeTruthy();
    const plugin = entry();
    view.rerender(<PluginCatalogGrid entries={[plugin]} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tasks plugin details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ada' }));
    expect(onOpen).toHaveBeenCalledWith(plugin);
    expect(onInstall).toHaveBeenCalledWith(plugin);
    expect(onOpenAuthor).toHaveBeenCalledWith('Ada');
    view.rerender(<PluginCatalogGrid entries={[plugin]} {...props} busy={{ tasks: 'Updating…' }} errors={{ tasks: 'Try again' }} />);
    expect((screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Try again');
  });
});
