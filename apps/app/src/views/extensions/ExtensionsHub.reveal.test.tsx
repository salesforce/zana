// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/modules', () => ({ useMergedModules: () => [] }));
vi.mock('@/modules/ModulePanelHost', () => ({ getHost: vi.fn() }));
vi.mock('@/plugins/plugin-app-loader', () => ({ reconcilePluginApps: vi.fn() }));
vi.mock('@/plugins/PluginDefinedSettings', () => ({
  PluginDefinedSettings: () => (
    <section id="plugin-configure" tabIndex={-1}>
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
    list: async () => [{ id: 'test', title: 'Test Plugin', name: 'Test Plugin', status: 'running', enabled: true, provenance: 'direct', appUrl: null }],
    onChanged: () => () => {}
  }
} }));
import { useUi } from '@/store';
import { InstalledView } from './ExtensionsHub.js';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useUi.setState({ settingsExtensionId: 'test', selectedProjectId: null });
});
afterEach(cleanup);

const open = (url: string) => render(<MemoryRouter initialEntries={[url]}><InstalledView /></MemoryRouter>);

it('reveals the ?setting row when the plugin page opens on #plugin-configure', async () => {
  open('/extensions/plugins/test?setting=relay#plugin-configure');
  await screen.findByLabelText('Relay');
  const row = document.querySelector('[data-plugin-setting-key="relay"]')!;
  expect(row.classList.contains('settings-search-flash')).toBe(true);
  expect(document.querySelector('[data-plugin-setting-key="mode"]')!.classList.contains('settings-search-flash')).toBe(false);
});

it('scrolls to the configure section but reveals no row without a ?setting key', async () => {
  open('/extensions/plugins/test#plugin-configure');
  await screen.findByLabelText('Relay');
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  expect(document.querySelector('.settings-search-flash')).toBeNull();
});

it('does nothing without the #plugin-configure hash', async () => {
  open('/extensions/plugins/test?setting=relay');
  await screen.findByLabelText('Relay');
  expect(document.querySelector('.settings-search-flash')).toBeNull();
});
