// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
const api = vi.hoisted(() => ({ list: vi.fn(), catalogs: vi.fn(), install: vi.fn(), add: vi.fn(), refresh: vi.fn(), remove: vi.fn(), toast: vi.fn(), off: vi.fn() }));
vi.mock('@/lib/app-surface', () => ({ hasDesktopBridge: () => true }));
vi.mock('@/lib/product-client', () => ({ product: {
  extensions: { marketplaceList: api.list, onChanged: () => api.off, install: api.install },
  marketplaces: { list: api.catalogs, add: api.add, refresh: api.refresh, remove: api.remove },
  pluginApps: { onChanged: () => api.off }
} }));
vi.mock('@/components/plugin/browse-hero/BrowseHeroCarousel', () => ({ BrowseHeroCarousel: () => <p>Create your plugin</p>, BrowseArchetypeCards: () => null }));
vi.mock('@/components/InstallFromGitDialog', () => ({ InstallFromGitDialog: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Close repository install</button> }));
import { useUi } from '@/store';
import { MarketplaceView } from './MarketplaceView.js';
const entry = (id: string, over: Partial<MarketplaceEntry> = {}): MarketplaceEntry => ({ id, title: id, version: '1.0', compatible: true, installed: false, hasUpdate: false, source: 'bundled', category: 'Workflow management', ...over });
const data = [entry('Available', { description: 'Useful tool', skillNames: ['test'] }), ...Array.from({ length: 7 }, (_, i) => entry(`Installed ${i}`, { installed: true, source: 'marketplace', category: 'Development' }))];
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
const setup = () => render(<MemoryRouter><MarketplaceView /><Location /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); api.list.mockResolvedValue({ ok: true, value: data }); api.catalogs.mockResolvedValue([]); api.install.mockResolvedValue({ ok: true }); useUi.setState({ pushToast: api.toast }); });
afterEach(cleanup);
it('treats a malformed catalogue list as empty and keeps plugin discovery usable', async () => {
  api.catalogs.mockResolvedValue({ catalogs: [] });
  setup();
  await screen.findByText('Useful tool');
  fireEvent.click(screen.getByRole('button', { name: 'Catalog sources' }));
  const dialog = await screen.findByRole('dialog', { name: 'Manage marketplaces' });
  expect(within(dialog).queryByRole('list')).toBeNull();
  expect(within(dialog).getByLabelText('Marketplace catalog source')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close', exact: true }));
  expect(screen.getByTestId('plugin-card-Available')).toBeTruthy();
});

it('puts available plugins first, caps installed previews, and routes Manage to installed details', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Available to install 1' });
  expect(screen.getAllByTestId(/^plugin-card-/)).toHaveLength(7);
  expect(screen.getByText('Skills')).toBeTruthy();
  expect(screen.queryByText('Create your plugin')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show all 7' }));
  expect(screen.getAllByTestId(/^plugin-card-/)).toHaveLength(8);
  fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
  fireEvent.click(within(screen.getByTestId('plugin-card-Installed 0')).getByRole('button', { name: 'Manage' }));
  expect(screen.getByTestId('location').textContent).toContain('Installed%200');
});
it('combines availability, marketplace, category and search filters', async () => {
  setup(); await screen.findByText('Useful tool');
  fireEvent.change(screen.getByLabelText('Filter by availability'), { target: { value: 'installed' } });
  expect(screen.queryByText('Useful tool')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter by marketplace'), { target: { value: 'official' } });
  expect(screen.getByText('No plugins match these filters.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filter by availability'), { target: { value: 'all' } });
  fireEvent.click(screen.getByRole('button', { name: 'Workflow management', exact: true }));
  expect(screen.getByTestId('plugin-card-Available')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search plugins'), { target: { value: 'absent' } });
  expect(screen.getByText('No plugins match “absent”.')).toBeTruthy();
});
it('keeps install failures on the card and allows a successful retry after trust confirmation', async () => {
  api.install.mockResolvedValueOnce({ ok: false, message: 'Source unavailable' });
  setup(); await screen.findByText('Useful tool');
  fireEvent.click(screen.getByRole('button', { name: 'Install', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  expect(api.install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Install', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Install with full trust' }));
  await screen.findByText('Source unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Install', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Install with full trust' }));
  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('Available'));
  expect(api.install).toHaveBeenCalledWith({ kind: 'bundled', id: 'Available' });
});
it('manages real marketplace sources in a dialog, with errors and official removal protection', async () => {
  api.catalogs.mockResolvedValue([{ source: 'https://example.test/catalog', displayName: 'Example catalog', sourceKind: 'https', entryCount: 2, official: true }]);
  api.add.mockRejectedValueOnce(new Error('Invalid catalog'));
  setup(); await screen.findByText('Useful tool');
  fireEvent.click(screen.getByRole('button', { name: 'Catalog sources' }));
  expect(await screen.findByText('Example catalog')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Remove', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Marketplace catalog source'), { target: { value: 'https://new.test/catalog' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add catalog' }));
  await screen.findByText('Invalid catalog');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
  await waitFor(() => expect(api.refresh).toHaveBeenCalledWith('https://example.test/catalog'));
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('shows catalogue errors and keeps creation reachable from Add plugin', async () => {
  api.list.mockResolvedValue({ ok: false, message: 'Offline' });
  const view = setup(); await screen.findByText('Offline');
  fireEvent.click(screen.getByRole('button', { name: 'Add plugin', exact: true }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Create a plugin' }));
  expect(screen.getByText('Create your plugin')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Browse' }));
  expect(screen.queryByText('Create your plugin')).toBeNull();
  view.unmount(); expect(api.off).toHaveBeenCalledTimes(2);
});

it('preserves folder, archive, repository and npm installation flows with actionable errors', async () => {
  setup(); await screen.findByText('Useful tool');
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Add plugin', exact: true }));
  api.install.mockResolvedValueOnce({ ok: false, message: 'Folder denied' });
  open(); fireEvent.click(screen.getByRole('menuitem', { name: /^Folder/ }));
  await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Folder denied', 'error'));
  expect(api.install).toHaveBeenCalledWith({ kind: 'localDir' });
  api.install.mockRejectedValueOnce(new Error('Archive failed'));
  open(); fireEvent.click(screen.getByRole('menuitem', { name: /^Archive/ }));
  await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Archive failed', 'error'));
  expect(api.install).toHaveBeenCalledWith({ kind: 'localArchive' });
  open(); fireEvent.click(screen.getByRole('menuitem', { name: /^Repository/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Close repository install' }));
  open(); fireEvent.click(screen.getByRole('menuitem', { name: /^npm package/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Package', exact: true }), { target: { value: 'example-plugin' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install', exact: true }));
  await waitFor(() => expect(api.install).toHaveBeenCalledWith({ kind: 'npm', spec: 'example-plugin' }));
  open(); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull();
  open(); fireEvent.mouseDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
});
it('sorts names in both directions and reloads discovery from the toolbar', async () => {
  const view = setup(); await screen.findByText('Useful tool');
  fireEvent.click(screen.getByRole('button', { name: 'Show all 7' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sort by name descending' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sort by name descending' }));
  expect(within(screen.getByRole('region', { name: 'Already in your app' })).getAllByTestId(/^plugin-card-/)[0]?.getAttribute('data-testid')).toBe('plugin-card-Installed 6');
  fireEvent.click(screen.getByRole('button', { name: 'Reload the catalog' }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  view.unmount();
});
