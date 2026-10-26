// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
const plugins = vi.hoisted(() => ({ entries: [] as any[], modules: [] as any[] }));
vi.mock('@/modules', () => ({ useMergedModules: () => plugins.modules }));
vi.mock('@/modules/ModulePanelHost', () => ({ getHost: vi.fn() }));
vi.mock('@/plugins/plugin-app-loader', () => ({ reconcilePluginApps: vi.fn() }));
vi.mock('@/plugins/PluginDefinedSettings', () => ({ PluginSettingsForm: () => null }));
vi.mock('@/plugins/PluginSettingsSections', () => ({ PluginSettingsSections: () => null }));
vi.mock('./PluginHubIncludes.js', () => ({ PluginHubIncludes: () => null }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  extensions: { list: async () => [], onChanged: () => () => {}, marketplaceList: async () => ({ ok: true, value: [] }) },
  pluginApps: { getSettings: async () => ({ descriptors: {}, values: {} }), list: async () => plugins.entries, onChanged: () => () => {} }
} }));
import { useUi } from '@/store';
import { InstalledView } from './ExtensionsHub.js';
function Location() { const location = useLocation(); return <output data-testid="destination">{JSON.stringify(location)}</output>; }
afterEach(cleanup);

it('mounts submission in the installed-plugin menu and closes the menu when drafting', async () => {
  plugins.modules = [];
  plugins.entries = [{ id: 'test', title: 'Test Plugin', name: 'Test Plugin', status: 'running', enabled: true, provenance: 'direct', appUrl: null }];
  useUi.setState({ settingsExtensionId: 'test', selectedProjectId: null });
  render(<MemoryRouter initialEntries={['/extensions/plugins/test']}><InstalledView /><Location /></MemoryRouter>);
  const more = await screen.findByRole('button', { name: 'More plugin actions' });
  expect(screen.queryByRole('menu', { name: 'Plugin actions' })).toBeNull();
  fireEvent.click(more);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Submit to marketplace' }));
  expect(screen.queryByRole('menu', { name: 'Plugin actions' })).toBeNull();
  const destination = JSON.parse(screen.getByTestId('destination').textContent!);
  expect(destination.pathname).toBe('/');
  expect(destination.state.initialPrompt).toContain('submit-a-plugin');
});

it('keeps compiled modules without an installation out of marketplace submission', async () => {
  plugins.entries = [];
  plugins.modules = [{ id: 'test', title: 'Compiled module', icon: 'Puzzle' }];
  useUi.setState({ settingsExtensionId: 'test' });
  render(<MemoryRouter><InstalledView /></MemoryRouter>);
  expect(screen.queryByText('Compiled module')).toBeNull();
  expect(screen.queryByRole('button', { name: 'More plugin actions' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Submit to marketplace' })).toBeNull();
});
