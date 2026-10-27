// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
const api = vi.hoisted(() => ({ apps: [] as PluginAppEntry[], modules: [] as Array<{ id: string; title: string; icon: string; loadError?: string }>, settings: vi.fn(), save: vi.fn(), reload: vi.fn(), remove: vi.fn(), toggle: vi.fn(), toast: vi.fn() }));
vi.mock('@/modules', () => ({ useMergedModules: () => api.modules }));
vi.mock('@/modules/ModulePanelHost', () => ({ getHost: vi.fn() }));
vi.mock('@/lib/app-surface', () => ({ hasDesktopBridge: () => true }));
vi.mock('@/hooks/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('@/plugins/plugin-app-loader', () => ({ reconcilePluginApps: vi.fn() }));
vi.mock('@/plugins/PluginSettingsSections', () => ({ PluginSettingsSections: () => <input aria-label="Plugin connection filter" /> }));
vi.mock('@/lib/product-client', () => ({ product: {
  extensions: { list: async () => [], onChanged: () => () => {}, marketplaceList: async () => ({ ok: true, value: [] }) },
  pluginApps: { list: async () => api.apps, onChanged: () => () => {}, getSettings: api.settings, setSettings: api.save, reload: api.reload, remove: api.remove, setEnabled: api.toggle }
} }));
import { useUi } from '@/store';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { clearPluginSlots, interpretPluginApp } from '@/plugins/plugin-slots';
import { InstalledView } from './ExtensionsHub.js';
const plugin = (over: Partial<PluginAppEntry> = {}): PluginAppEntry => ({ id: 'example', name: 'Example', description: 'Useful description', icon: 'Box', enabled: true, status: 'running', provenance: 'direct', sourceKind: 'path', appUrl: null, ...over });
const setup = (url = '/extensions/plugins/example?view=installed') => render(<MemoryRouter initialEntries={[url]}><InstalledView /></MemoryRouter>);
const inspector = () => within(screen.getByRole('region', { name: 'Installed plugin' }));
beforeEach(() => {
  vi.clearAllMocks(); api.apps = [plugin()]; api.modules = [];
  api.settings.mockResolvedValue({ descriptors: { name: { type: 'string', label: 'Name' } }, values: { name: 'Before' } });
  api.save.mockImplementation(async (_id, values) => ({ descriptors: { name: { type: 'string', label: 'Name' } }, values }));
  api.reload.mockResolvedValue({ ok: true }); api.remove.mockResolvedValue({ ok: true }); api.toggle.mockResolvedValue({ ok: true });
  useUi.setState({ settingsExtensionId: 'example', selectedProjectId: null, pushToast: api.toast,
    setExtensionsTab: () => useUi.setState({ settingsExtensionId: null }) });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); clearPluginSlots('example'); });
it('shows real settings on a full page, saves through the existing API, and returns to the list', async () => {
  setup();
  await screen.findByRole('tab', { name: 'Settings', exact: true });
  expect(screen.getByTestId('plugin-row-example').closest('[hidden]')).toBeTruthy();
  expect(screen.queryByRole('searchbox', { name: 'Search installed plugins' })).toBeNull();
  const body = screen.getByRole('region', { name: 'Installed plugin' }).querySelector('.ext-plugin-detail-page-body')!;
  body.scrollTop = 500;
  fireEvent.click(inspector().getByRole('tab', { name: 'Settings', exact: true }));
  expect(body.scrollTop).toBe(0);
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  fireEvent.change(inspector().getByRole('textbox', { name: 'Name' }), { target: { value: 'After' } });
  fireEvent.blur(inspector().getByRole('textbox', { name: 'Name' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith('example', { name: 'After' }));
  fireEvent.keyDown(inspector().getByRole('tab', { name: 'Settings', exact: true }), { key: 'ArrowRight' });
  expect(inspector().getByRole('tab', { name: 'Installation' }).getAttribute('aria-selected')).toBe('true');
  expect(inspector().getByText('Local folder')).toBeTruthy();
  fireEvent.keyDown(inspector().getByRole('tab', { name: 'Installation' }), { key: 'Home' });
  expect(inspector().getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(inspector().getByRole('button', { name: 'Back to Plugins' }));
  expect(screen.queryByRole('region', { name: 'Installed plugin' })).toBeNull();
  expect(screen.getByTestId('plugin-row-example')).toBeTruthy();
});
it('keeps a failed setting editable and does not invent settings for plugins without descriptors', async () => {
  api.save.mockRejectedValue(new Error('Save denied'));
  const view = setup(); await screen.findByRole('tab', { name: 'Settings', exact: true });
  fireEvent.click(inspector().getByRole('tab', { name: 'Settings', exact: true }));
  const input = inspector().getByRole('textbox', { name: 'Name' }); fireEvent.change(input, { target: { value: 'After' } }); fireEvent.blur(input);
  expect((await screen.findByRole('alert')).textContent).toBe('Save denied');
  view.unmount(); api.settings.mockResolvedValue({ descriptors: {}, values: {} }); setup();
  await screen.findByRole('region', { name: 'Installed plugin' });
  expect(screen.queryByRole('tab', { name: 'Settings', exact: true })).toBeNull();
});
it('opens configuration from a runtime warning and reports reload failures', async () => {
  api.apps = [plugin({ status: 'needs-configuration', statusDetail: 'Connect an account' })]; api.reload.mockResolvedValueOnce({ ok: false, message: 'Reload denied' });
  setup(); await screen.findByTestId('plugin-health');
  fireEvent.click(inspector().getByRole('button', { name: 'Open configure' }));
  expect(inspector().getByRole('tab', { name: 'Settings', exact: true }).getAttribute('aria-selected')).toBe('true');
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

it('keeps renderer failures visible before selecting any detail section', async () => {
  api.modules = [{ id: 'example', title: 'Example', icon: 'Box', loadError: 'Renderer could not load' }];
  setup();
  expect((await screen.findByRole('alert')).textContent).toBe('Renderer could not load');
  expect(inspector().getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected')).toBe('true');
});

const registerSettings = (title?: string) => interpretPluginApp('example', definePluginApp(app => {
  app.slots.settingsSection({ id: 'controls', title, component: () => null });
}));
it('separates the registered plugin UI from configuration and preserves each area’s state', async () => {
  registerSettings('Connections & tools'); setup();
  await screen.findByRole('tab', { name: 'Settings', exact: true });
  fireEvent.click(inspector().getByRole('tab', { name: 'Settings', exact: true }));
  const areas = within(screen.getByRole('navigation', { name: 'Plugin settings areas' }));
  expect(areas.getByRole('button', { name: 'Connections & tools' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Plugin connection filter' }), { target: { value: 'kept' } });
  fireEvent.click(areas.getByRole('button', { name: 'Configuration' }));
  expect(screen.queryByRole('textbox', { name: 'Plugin connection filter' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
  fireEvent.click(areas.getByRole('button', { name: 'Connections & tools' }));
  expect((screen.getByRole('textbox', { name: 'Plugin connection filter' }) as HTMLInputElement).value).toBe('kept');
});
it('uses a generic area label when the plugin supplies no title, and opens deep links on Configuration', async () => {
  registerSettings(); setup('/extensions/plugins/example?view=installed#plugin-configure');
  await screen.findByRole('textbox', { name: 'Name' });
  const areas = within(screen.getByRole('navigation', { name: 'Plugin settings areas' }));
  expect(areas.getByRole('button', { name: 'Configuration' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(areas.getByRole('button', { name: 'Plugin settings' }));
  expect(screen.getByRole('textbox', { name: 'Plugin connection filter' })).toBeTruthy();
});
it('shows plugin-only settings directly without an empty Configuration area', async () => {
  registerSettings(); api.settings.mockResolvedValue({ descriptors: {}, values: {} });
  setup('/extensions/plugins/example#plugin-configure');
  await screen.findByRole('textbox', { name: 'Plugin connection filter' });
  expect(screen.queryByRole('navigation', { name: 'Plugin settings areas' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Configuration' })).toBeNull();
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
