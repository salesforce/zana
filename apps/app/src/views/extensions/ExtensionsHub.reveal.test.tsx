// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/modules', () => ({ useMergedModules: () => [] }));
vi.mock('@/modules/ModulePanelHost', () => ({ getHost: vi.fn() }));
vi.mock('@/plugins/plugin-app-loader', () => ({ reconcilePluginApps: vi.fn() }));
vi.mock('@/plugins/PluginDefinedSettings', () => ({
  PluginSettingsForm: () => (
    <section>
      <div data-plugin-setting-key="relay"><input aria-label="Relay" /></div>
      <div data-plugin-setting-key="mode"><input aria-label="Mode" /></div>
    </section>
  )
}));
vi.mock('@/plugins/PluginSettingsSections', () => ({ PluginSettingsSections: () => null }));
vi.mock('./PluginHubIncludes.js', () => ({ PluginHubIncludes: () => null }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  extensions: { list: async () => [], onChanged: () => () => {}, marketplaceList: async () => ({ ok: true, value: [] }) },
  pluginApps: {
    getSettings: async () => ({ descriptors: { relay: { type: 'string', label: 'Relay' } }, values: {} }),
    list: async () => [{ id: 'test', title: 'Test Plugin', name: 'Test Plugin', status: 'running', enabled: true, provenance: 'direct', appUrl: null }],
    onChanged: () => () => {}
  }
} }));
import { useUi } from '@/store';
import { InstalledView } from './ExtensionsHub.js';
import { PluginSettingsView } from '../settings/PluginSettingsView';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useUi.setState({ settingsExtensionId: 'test', selectedProjectId: null });
});
afterEach(cleanup);

const open = (url: string) => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/extensions/plugins/:pluginId" element={<InstalledView />} /><Route path="/settings/plugins/:pluginId" element={<PluginSettingsView />} /></Routes></MemoryRouter>);

it('reveals the ?setting row when the plugin page opens on #plugin-configure', async () => {
  open('/extensions/plugins/test?setting=relay#plugin-configure');
  await screen.findByLabelText('Relay');
  const row = document.querySelector('[data-plugin-setting-key="relay"]')!;
  // The reveal runs in an effect after the row renders, so the label can be
  // found a beat before the flash is applied (seen on a loaded CI runner).
  await waitFor(() => expect(row.classList.contains('settings-search-flash')).toBe(true));
  expect(document.querySelector('[data-plugin-setting-key="mode"]')!.classList.contains('settings-search-flash')).toBe(false);
});

it('focuses configuration without scrolling the page tabs away', async () => {
  open('/extensions/plugins/test#plugin-configure');
  await screen.findByLabelText('Relay');
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  expect(document.activeElement?.id).toBe('plugin-configure');
  expect(document.querySelector('.settings-search-flash')).toBeNull();
});

it('leaves an ordinary installed detail URL in the management hub', async () => {
  open('/extensions/plugins/test?view=installed');
  await screen.findByRole('region', { name: 'Installed plugin' });
  expect(screen.queryByLabelText('Relay')).toBeNull();
});
