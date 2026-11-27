// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
const api = vi.hoisted(() => ({ apps: [] as PluginAppEntry[], modules: [] as Array<{ id: string; title: string; icon: string; loadError?: string }>, settings: vi.fn(), save: vi.fn(), reload: vi.fn(), reloadApp: vi.fn(), remove: vi.fn(), toggle: vi.fn(), toast: vi.fn() }));
vi.mock('@/modules', () => ({ useMergedModules: () => api.modules }));
vi.mock('@/modules/ModulePanelHost', () => ({ getHost: vi.fn() }));
vi.mock('@/lib/app-surface', () => ({ hasDesktopBridge: () => true }));
vi.mock('@/hooks/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('@/plugins/plugin-app-loader', () => ({ reconcilePluginApps: vi.fn(), reloadPluginApp: api.reloadApp }));
vi.mock('@/plugins/PluginSettingsSections', () => ({ PluginSettingsSections: () => <input aria-label="Plugin connection filter" /> }));
vi.mock('@/lib/product-client', () => ({ product: {
  threads: { providers: async () => ({ providers: [] }) },
  extensions: { list: async () => [], onChanged: () => () => {}, marketplaceList: async () => ({ ok: true, value: [] }) },
  threads: { providers: async () => ({ providers: [] }) },
  pluginApps: { list: async () => api.apps, onChanged: () => () => {}, getSettings: api.settings, setSettings: api.save, reload: api.reload, remove: api.remove, setEnabled: api.toggle }
} }));
import { useUi } from '@/store';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { clearPluginSlots, interpretPluginApp } from '@/plugins/plugin-slots';
import { clearInstalledCollectionMemory } from './InstalledPluginCollection.js';
import { InstalledView } from './ExtensionsHub.js';
const plugin = (over: Partial<PluginAppEntry> = {}): PluginAppEntry => ({ id: 'example', name: 'Example', description: 'Useful description', icon: 'Box', enabled: true, status: 'running', hasSettings: true, provenance: 'direct', sourceKind: 'path', appUrl: null, ...over });
function Location() { const at = useLocation(); return <p data-testid="location">{at.pathname}{at.search}</p>; }
const setup = (url = '/extensions/plugins/example?view=installed') => render(<MemoryRouter initialEntries={[url]}><InstalledView /><Location /></MemoryRouter>);
const inspector = () => within(screen.getByRole('region', { name: 'Installed plugin' }));
beforeEach(() => {
  clearInstalledCollectionMemory();
  vi.clearAllMocks(); api.apps = [plugin()]; api.modules = [];
  api.settings.mockResolvedValue({ descriptors: { name: { type: 'string', label: 'Name' } }, values: { name: 'Before' } });
  api.save.mockImplementation(async (_id, values) => ({ descriptors: { name: { type: 'string', label: 'Name' } }, values }));
  api.reload.mockResolvedValue({ ok: true }); api.remove.mockResolvedValue({ ok: true }); api.toggle.mockResolvedValue({ ok: true });
  api.reloadApp.mockResolvedValue(undefined);
  useUi.setState({ settingsExtensionId: 'example', selectedProjectId: null, pushToast: api.toast,
    setExtensionsTab: () => useUi.setState({ settingsExtensionId: null }) });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); clearPluginSlots('example'); clearPluginSlots('other'); });
it('opens Settings from management without reading settings values and returns to the list', async () => {
  setup();
  const link = await screen.findByRole('link', { name: 'Settings →' });
  expect(link.getAttribute('href')).toBe('/settings/plugins/example');
  expect(api.settings).not.toHaveBeenCalled();
  expect(screen.queryByRole('tab', { name: 'Settings', exact: true })).toBeNull();
  fireEvent.click(inspector().getByRole('tab', { name: 'Installation' }));
  expect(inspector().getByText('Local folder')).toBeTruthy();
  fireEvent.keyDown(inspector().getByRole('tab', { name: 'Installation' }), { key: 'Home' });
  expect(inspector().getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(inspector().getByRole('button', { name: 'Back to Plugins' }));
  expect(screen.queryByRole('region', { name: 'Installed plugin' })).toBeNull();
  expect(screen.getByTestId('plugin-row-example')).toBeTruthy();
});
it('opens configuration from a runtime warning and reports reload failures', async () => {
  api.apps = [plugin({ status: 'needs-configuration', statusDetail: 'Connect an account' })]; api.reload.mockResolvedValueOnce({ ok: false, message: 'Reload denied' });
  setup(); await screen.findByTestId('plugin-health');
  fireEvent.click(inspector().getByRole('button', { name: 'Open configure' }));
  expect(screen.getByTestId('location').textContent).toBe('/settings/plugins/example');
  fireEvent.click(inspector().getByRole('button', { name: 'Reload', exact: true }));
  await screen.findByText('Reload denied');
  api.reload.mockRejectedValueOnce(new Error('Reload failed'));
  fireEvent.click(inspector().getByRole('button', { name: 'Reload', exact: true })); await screen.findByText('Reload failed');
});
it('requires confirmation to uninstall, reports failures, and lets Escape dismiss the action menu', async () => {
  api.remove.mockResolvedValueOnce({ ok: false, message: 'Remove denied' });
  setup(); await screen.findByRole('button', { name: 'More plugin actions' });
  fireEvent.click(inspector().getByRole('button', { name: 'More plugin actions' }));
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Uninstall' }), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull(); expect(screen.getByRole('region', { name: 'Installed plugin' })).toBeTruthy();
  fireEvent.click(inspector().getByRole('button', { name: 'More plugin actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Uninstall' }));
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.click(inspector().getByRole('button', { name: 'Cancel', exact: true }));
  fireEvent.click(inspector().getByRole('button', { name: 'Uninstall', exact: true }));
  fireEvent.click(inspector().getByRole('button', { name: 'Confirm remove' }));
  await screen.findByText('Remove denied'); expect(api.remove).toHaveBeenCalledWith('example');
});

it('keeps an always-enabled plugin accessible without disable or uninstall actions', async () => {
  api.apps = [plugin({ alwaysEnabled: true, provenance: 'builtin', sourceKind: 'builtin' })];
  setup();
  const installedRow = await screen.findByTestId('plugin-row-example');
  expect(within(installedRow).queryByRole('switch')).toBeNull();
  expect(inspector().getByRole('link', { name: 'Settings →' })).toBeTruthy();
  expect(inspector().queryByRole('switch')).toBeNull();
  expect(inspector().queryByRole('button', { name: 'More plugin actions' })).toBeNull();
  fireEvent.click(inspector().getByRole('tab', { name: 'Installation' }));
  expect(inspector().queryByRole('button', { name: /^(Disable|Uninstall)$/ })).toBeNull();
  expect(inspector().getByRole('button', { name: 'Reload', exact: true })).toBeTruthy();
});

it('offers renderer recovery before selecting any detail section', async () => {
  api.modules = [{ id: 'example', title: 'Example', icon: 'Box', loadError: 'Renderer could not load' }];
  setup();
  await screen.findByRole('heading', { name: 'Example couldn’t load' });
  fireEvent.click(inspector().getByText('Technical details', { exact: true }));
  expect(inspector().getByText('Renderer could not load')).toBeTruthy();
  fireEvent.click(inspector().getByRole('button', { name: 'Reload plugin', exact: true }));
  await waitFor(() => expect(api.reloadApp).toHaveBeenCalledExactlyOnceWith('example'));
  expect(inspector().getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected')).toBe('true');
});

it('restores the collection search and scroll position on Back', async () => {
  useUi.setState({ settingsExtensionId: null, selectSettingsExtension: (id: string) => useUi.setState({ settingsExtensionId: id }) });
  setup('/extensions/plugins');
  const search = screen.getByRole('searchbox', { name: 'Search installed plugins' });
  fireEvent.change(search, { target: { value: 'Example' } });
  const row = await screen.findByTestId('plugin-row-example');
  const scroller = row.closest('.ext-installed-scroller')!; scroller.scrollTop = 80;
  fireEvent.click(within(row).getByRole('button', { name: 'Example plugin details' }));
  await screen.findByRole('region', { name: 'Installed plugin' });
  fireEvent.click(inspector().getByRole('button', { name: 'Back to Plugins' }));
  expect(screen.getByRole('searchbox', { name: 'Search installed plugins' })).toBe(search);
  expect((search as HTMLInputElement).value).toBe('Example');
  expect(scroller.scrollTop).toBe(80);
});

it('offers source recovery instead of reloading a missing folder', async () => {
  api.apps = [plugin({ status: 'degraded', statusDetail: 'plugin directory missing', sourceRecovery: { canLocate: true, canSwitchOfficial: true } })];
  setup(); await screen.findByTestId('plugin-health');
  expect(inspector().getByText('Plugin source folder is unavailable')).toBeTruthy();
  expect(inspector().getByRole('button', { name: 'Locate moved plugin…' })).toBeTruthy();
  expect(inspector().getByRole('button', { name: 'Switch to official distribution…' })).toBeTruthy();
  expect(inspector().queryByRole('button', { name: 'Reload', exact: true })).toBeNull();
});
it('shows the tool policy timeout only for plugins that report one', async () => {
  api.apps = [plugin({ toolPolicyTimeoutMs: 7_500 })];
  const view = setup(); await screen.findByRole('region', { name: 'Installed plugin' });
  expect(screen.getByTestId('plugin-tool-policy-timeout').textContent).toContain('7.5 s');
  view.unmount(); api.apps = [plugin()]; setup(); await screen.findByRole('region', { name: 'Installed plugin' });
  expect(screen.queryByTestId('plugin-tool-policy-timeout')).toBeNull();
});

it('links a sound plugin to its Notifications controls and excludes other plugin providers', async () => {
  for (const id of ['example', 'other']) interpretPluginApp(id, definePluginApp(app => {
    app.slots.notificationSoundProvider({ id: 'alerts', title: `${id} sounds`, component: () => null, mount: () => () => {} });
  }));
  setup();
  const link = await screen.findByRole('link', { name: 'Configure sounds →' });
  expect(link.getAttribute('href')).toBe('/settings/notifications?provider=example%2Falerts#agent-sounds');
  expect(screen.getByText('example sounds is configured in Settings → Notifications.')).toBeTruthy();
  expect(screen.queryByText('other sounds is configured in Settings → Notifications.')).toBeNull();
  expect(screen.getByText('Notification sound providers (1)')).toBeTruthy();
});

it('restores collection filters after a Settings visit unmounts the management page', async () => {
  useUi.setState({ settingsExtensionId: null });
  const view = setup('/extensions/plugins');
  const search = await screen.findByRole('searchbox', { name: 'Search installed plugins' });
  fireEvent.change(search, { target: { value: 'Example' } });
  const scroller = screen.getByTestId('plugin-row-example').closest('.ext-installed-scroller')!;
  scroller.scrollTop = 80; fireEvent.scroll(scroller); view.unmount();
  setup('/extensions/plugins');
  await screen.findByTestId('plugin-row-example');
  expect((screen.getByRole('searchbox', { name: 'Search installed plugins' }) as HTMLInputElement).value).toBe('Example');
  expect(screen.getByTestId('plugin-row-example').closest('.ext-installed-scroller')!.scrollTop).toBe(80);
});
