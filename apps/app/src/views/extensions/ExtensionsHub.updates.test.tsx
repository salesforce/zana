// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ list: vi.fn(), checkUpdates: vi.fn(), applyAllUpdates: vi.fn(), toast: vi.fn() }));
vi.mock('@/modules', () => ({ useMergedModules: () => [] }));
vi.mock('@/modules/ModulePanelHost', () => ({ getHost: vi.fn() }));
vi.mock('@/hooks/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('./InstalledPluginCollection.js', () => ({ InstalledPluginCollection: ({ headerActions }: any) => <div>{headerActions}</div> }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  extensions: { list: async () => [], onChanged: () => () => {}, marketplaceList: async () => ({ ok: true, value: [] }) },
  pluginApps: { list: api.list, onChanged: () => () => {}, checkUpdates: api.checkUpdates, applyAllUpdates: api.applyAllUpdates }
} }));
import { useUi } from '@/store';
import { ExtensionsHub } from './ExtensionsHub.js';

beforeEach(() => { vi.resetAllMocks(); api.list.mockResolvedValue([]); api.checkUpdates.mockResolvedValue([]); useUi.setState({ settingsExtensionId: null, pushToast: api.toast }); });
afterEach(cleanup);
async function action(name: string) {
  render(<MemoryRouter><ExtensionsHub /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'More', exact: true }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}
it.each([
  [{ updated: ['sample'], failed: [] }, '1 plugin updated', undefined],
  [{ updated: ['one', 'two'], failed: [{ id: 'other', message: 'offline' }] }, '2 plugins updated; 1 failed', 'error']
])('applies bulk updates and reports successes and failures', async (value, message, tone) => {
  api.applyAllUpdates.mockResolvedValue({ ok: true, value }); await action('Update all independent plugins');
  await waitFor(() => expect(api.toast).toHaveBeenCalledWith(message, tone)); expect(api.applyAllUpdates).toHaveBeenCalledTimes(1);
});
it('reports rejected bulk updates and failed host calls', async () => {
  api.applyAllUpdates.mockResolvedValue({ ok: false, message: 'Host unavailable' }); await action('Update all independent plugins');
  await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Host unavailable', 'error'));
  cleanup(); api.applyAllUpdates.mockRejectedValue('offline'); await action('Update all independent plugins');
  await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Plugin updates failed', 'error'));
});
it('reports a successful check and distinguishes offline sources from current ones', async () => {
  await action('Check for updates'); await waitFor(() => expect(api.toast).toHaveBeenCalled());
  cleanup(); api.toast.mockClear(); api.list.mockResolvedValue([{ id: 'offline', name: 'Offline', description: 'Offline source', icon: 'Puzzle', enabled: true, status: 'running', provenance: 'direct', appUrl: null, updateCheck: { outcome: 'unavailable', checkedAt: 1 } }]);
  await action('Check for updates');
  await waitFor(() => expect(api.toast).toHaveBeenCalledWith('0 updates available; 1 source check failed', 'error'));
});
it('reports check failures', async () => {
  api.checkUpdates.mockRejectedValue(new Error('Host unavailable')); await action('Check for updates');
  await waitFor(() => expect(api.toast).toHaveBeenCalledWith('Could not check for plugin updates', 'error'));
});
