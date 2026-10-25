// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { CatalogPluginDetail } from './CatalogPluginDetail.js';

afterEach(cleanup);
const entry: MarketplaceEntry = {
  id: 'example', title: 'Example', author: 'Ada', version: '1.0.0',
  description: 'A useful plugin', source: 'bundled', installed: false, hasUpdate: false, compatible: true
};

it('supports tab clicks and keyboard navigation with one focused tab and visible panel', () => {
  render(<CatalogPluginDetail entry={entry} catalog={[]} onInstall={vi.fn()} onOpenPlugin={vi.fn()} />);
  const overview = screen.getByRole('tab', { name: 'Overview' });
  const source = screen.getByRole('tab', { name: 'Source' });
  const selected = (tab: HTMLElement, name: string) => {
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.tabIndex).toBe(0);
    expect(screen.getByRole('tabpanel', { name })).toBeTruthy();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  };
  selected(overview, 'Overview');
  fireEvent.click(source);
  selected(source, 'Source');
  expect(overview.tabIndex).toBe(-1);
  expect(screen.getByText('Updates with Zana releases')).toBeTruthy();
  fireEvent.keyDown(source, { key: 'Home' });
  selected(overview, 'Overview');
  expect(document.activeElement).toBe(overview);
  fireEvent.keyDown(overview, { key: 'End' });
  selected(source, 'Source');
  expect(document.activeElement).toBe(source);
  fireEvent.keyDown(source, { key: 'ArrowRight' });
  selected(overview, 'Overview');
  fireEvent.keyDown(overview, { key: 'ArrowLeft' });
  selected(source, 'Source');
  fireEvent.keyDown(source, { key: 'Escape' });
  selected(source, 'Source');
});

it('manages installed plugins and keeps standalone installed details non-actionable', () => {
  const onManage = vi.fn(), onInstall = vi.fn();
  const installed = { ...entry, installed: true };
  const { rerender } = render(<CatalogPluginDetail entry={installed} catalog={[]} onInstall={onInstall} onOpenPlugin={vi.fn()} onManage={onManage} />);
  fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
  expect(onManage).toHaveBeenCalledOnce();
  expect(onInstall).not.toHaveBeenCalled();
  rerender(<CatalogPluginDetail entry={installed} catalog={[]} onInstall={onInstall} onOpenPlugin={vi.fn()} />);
  expect(screen.getByText('Installed')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Installed' })).toBeNull();
});

it('installs available plugins and opens the author collection', () => {
  const onInstall = vi.fn(), onOpenAuthor = vi.fn();
  render(<CatalogPluginDetail entry={entry} catalog={[]} onInstall={onInstall} onOpenPlugin={vi.fn()} onOpenAuthor={onOpenAuthor} />);
  fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  expect(onInstall).toHaveBeenCalledWith(entry);
  fireEvent.click(screen.getByRole('button', { name: 'By Ada' }));
  expect(onOpenAuthor).toHaveBeenCalledWith('Ada');
});
