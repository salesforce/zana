// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
const api = vi.hoisted(() => ({ list: vi.fn(), install: vi.fn(), navigate: vi.fn(), off: vi.fn(), changed: null as null | (() => void) }));
vi.mock('@/lib/product-client', () => ({ product: { extensions: { marketplaceList: api.list, install: api.install, onChanged: (cb: () => void) => { api.changed = cb; return api.off; } } } }));
vi.mock('@/lib/app-navigate', () => ({ appNavigate: api.navigate }));
vi.mock('./MarketplaceView.js', () => ({ Marketplace: () => <input aria-label="Collection search" />, PluginInstallConfirm: ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => <div role="dialog"><button onClick={onConfirm}>Trust and install</button><button onClick={onCancel}>Cancel</button></div> }));
import { PluginBrowseSplit } from './PluginBrowseSplit.js';
const entry = (id: string, over: Partial<MarketplaceEntry> = {}): MarketplaceEntry => ({ id, title: id, author: 'Ada', version: '1.0', source: 'bundled', installed: false, hasUpdate: false, compatible: true, ...over });
const renderSplit = (pluginId: string | null) => <MemoryRouter><PluginBrowseSplit pluginId={pluginId} /></MemoryRouter>;
beforeEach(() => { vi.clearAllMocks(); api.list.mockResolvedValue({ ok: true, value: [entry('Alpha'), entry('Beta', { source: 'marketplace' })] }); api.install.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
it('keeps the collection mounted while opening and closing the inspector, with real deep links', async () => {
  const view = render(renderSplit(null));
  fireEvent.change(screen.getByLabelText('Collection search'), { target: { value: 'kept' } });
  view.rerender(renderSplit('Alpha'));
  await screen.findByRole('heading', { name: 'Alpha' });
  expect((screen.getByLabelText('Collection search') as HTMLInputElement).value).toBe('kept');
  fireEvent.click(screen.getByRole('button', { name: 'By Ada' }));
  expect(api.navigate).toHaveBeenLastCalledWith(expect.stringContaining('author=Ada'));
  fireEvent.click(screen.getByRole('button', { name: 'Beta plugin details' }));
  expect(api.navigate).toHaveBeenLastCalledWith(expect.stringContaining('Beta'));
  fireEvent.click(screen.getByRole('button', { name: 'Close plugin details' }));
  expect(api.navigate).toHaveBeenLastCalledWith('/extensions/plugins/browse');
  view.unmount(); expect(api.off).toHaveBeenCalledOnce();
});
it('requires trust, preserves failed install details, and retries the recorded source', async () => {
  api.install.mockResolvedValueOnce({ ok: false, message: 'Unavailable' });
  const view = render(renderSplit('Beta')); await screen.findByRole('heading', { name: 'Beta' });
  fireEvent.click(screen.getByRole('button', { name: 'Install', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(api.install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Install', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Trust and install' })); await screen.findByText('Unavailable');
  view.rerender(renderSplit('Alpha')); await screen.findByRole('heading', { name: 'Alpha' });
  expect(screen.queryByText('Unavailable')).toBeNull();
  view.rerender(renderSplit('Beta')); await screen.findByText('Unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Install', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Trust and install' }));
  await waitFor(() => expect(api.navigate).toHaveBeenCalledWith(expect.stringContaining('view=installed')));
  expect(api.install).toHaveBeenCalledWith({ kind: 'marketplace', id: 'Beta' });
});
it('reports thrown install errors and supports bundled installs', async () => {
  api.install.mockRejectedValueOnce(new Error('Network failed'));
  render(renderSplit('Alpha')); await screen.findByRole('heading', { name: 'Alpha' });
  fireEvent.click(screen.getByRole('button', { name: 'Install', exact: true })); fireEvent.click(screen.getByRole('button', { name: 'Trust and install' }));
  await screen.findByText('Network failed'); expect(api.install).toHaveBeenCalledWith({ kind: 'bundled', id: 'Alpha' });
});
it('distinguishes loading, missing entries and failed catalogue reads', async () => {
  let resolve!: (value: unknown) => void; api.list.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(renderSplit('missing'));
  expect(screen.getByRole('status').textContent).toBe('Loading plugin details…');
  resolve({ ok: true, value: [] }); await screen.findByText('Plugin not found.'); view.unmount();
  api.list.mockResolvedValueOnce({ ok: false, message: 'Catalog unavailable' });
  const second = render(renderSplit('missing')); await screen.findByRole('alert'); second.unmount();
  api.list.mockRejectedValueOnce('offline'); render(renderSplit('missing'));
  expect((await screen.findByRole('alert')).textContent).toBe('Could not load plugin details');
});
it('updates installed catalog state and offers Manage, with keyboard access to Source', async () => {
  api.list.mockResolvedValue({ ok: true, value: [entry('Alpha', { installed: true })] });
  render(renderSplit('Alpha')); await screen.findByRole('button', { name: 'Manage' });
  const tabs = within(screen.getByRole('tablist', { name: 'Marketplace detail sections' }));
  fireEvent.keyDown(tabs.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });
  expect(tabs.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
  expect(api.navigate).toHaveBeenLastCalledWith(expect.stringContaining('view=installed'));
  api.changed?.(); await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
});
