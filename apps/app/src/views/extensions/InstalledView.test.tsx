// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
const state = vi.hoisted(() => ({ desktop: true, compact: false, entries: [] as PluginAppEntry[],
  install: vi.fn(), offExt: vi.fn(), offApps: vi.fn(), changed: null as null | ((entries: PluginAppEntry[]) => void) }));
vi.mock('@/modules', () => ({ useMergedModules: () => [] }));
vi.mock('@/modules/ModulePanelHost', () => ({ getHost: vi.fn() }));
vi.mock('@/lib/app-surface', () => ({ hasDesktopBridge: () => state.desktop }));
vi.mock('@/hooks/useCompactLayout', () => ({ useCompactLayout: () => state.compact }));
vi.mock('@/components/MobilePageHeader', () => ({ MobilePageHeader: ({ children }: { children: import('react').ReactNode }) => state.compact ? <div>{children}</div> : null }));
vi.mock('@/plugins/plugin-app-loader', () => ({ reconcilePluginApps: vi.fn() }));
vi.mock('@/plugins/PluginDefinedSettings', () => ({ PluginDefinedSettings: () => null }));
vi.mock('@/plugins/PluginSettingsSections', () => ({ PluginSettingsSections: () => null }));
vi.mock('./PluginHubIncludes.js', () => ({ PluginHubIncludes: () => null }));
vi.mock('./PluginBrowseSplit.js', () => ({ PluginBrowseSplit: ({ toolbarExtra }: { toolbarExtra?: import('react').ReactNode }) =>
  <div data-testid="browse-plugins">{toolbarExtra}</div> }));
vi.mock('@/components/InstallFromGitDialog', () => ({ InstallFromGitDialog: ({ mode, onClose }: { mode?: string; onClose: () => void }) =>
  <button onClick={onClose}>{mode === 'open' ? 'Close existing plugin' : 'Close repository install'}</button> }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  extensions: { list: async () => [], onChanged: () => state.offExt, install: state.install, marketplaceList: async () => ({ ok: true, value: [] }) },
  pluginApps: { list: async () => state.entries, onChanged: (changed: (entries: PluginAppEntry[]) => void) => { state.changed = changed; return state.offApps; } }
} }));
import { useUi } from '@/store';
import { ExtensionsHub, InstalledView } from './ExtensionsHub.js';
function Location() { const location = useLocation(); return <output data-testid="destination">{JSON.stringify(location)}</output>; }
const toast = vi.fn(), select = vi.fn(), setTab = vi.fn();
const setup = (onBrowse?: () => void) => render(<MemoryRouter><InstalledView onBrowse={onBrowse} toolbarExtra={<button>More actions</button>} mobileActions={<button>Maintenance</button>} /><Location /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks(); state.desktop = true; state.compact = false; state.entries = []; state.install.mockResolvedValue({ ok: true });
  useUi.setState({ settingsExtensionId: null, selectedProjectId: null, pushToast: toast, selectSettingsExtension: select, setExtensionsTab: setTab });
});
afterEach(cleanup);
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Add plugin' }));

it('puts creation, catalog browsing and source installation in one dismissible Add menu', async () => {
  const onBrowse = vi.fn(); setup(onBrowse);
  openMenu();
  expect(screen.getByRole('menu', { name: 'Add a plugin' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  openMenu(); fireEvent.mouseDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Browse plugins' }));
  expect(onBrowse).toHaveBeenCalledOnce(); expect(screen.queryByRole('menu')).toBeNull();
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Create a plugin' }));
  const destination = JSON.parse(screen.getByTestId('destination').textContent!);
  expect(destination.pathname).toBe('/'); expect(destination.state.initialPrompt).toContain('Create a new zcc plugin that');
});

it('keeps folder and repository install actions, including the open-existing flow', () => {
  setup();
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Open existing plugin' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close existing plugin' }));
  expect(screen.queryByRole('button', { name: 'Close existing plugin' })).toBeNull();
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Install from repository' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close repository install' }));
  openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Install from folder' }));
  expect(state.install).toHaveBeenCalledWith({ kind: 'localDir' });
});

it.each([{ ok: false, message: 'Folder denied' }, new Error('Install failed'), 'bad install'])('surfaces folder installation errors %j', async (failure) => {
  if (typeof failure === 'object' && !(failure instanceof Error)) state.install.mockResolvedValueOnce(failure);
  else state.install.mockRejectedValueOnce(failure);
  setup(); openMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Install from folder' }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(failure instanceof Error ? 'Install failed' : typeof failure === 'string' ? 'bad install' : 'Folder denied', 'error'));
});

it('shows remote/mobile restrictions while keeping creation and maintenance accessible', () => {
  state.desktop = false; state.compact = true; setup();
  expect(screen.getByRole('button', { name: 'Maintenance' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create a plugin' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Install from folder' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/instance owner’s desktop/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Browse plugins' }));
  expect(setTab).toHaveBeenCalledWith('marketplace');
});

it('loads installed cards, opens their details, and releases subscriptions on unmount', async () => {
  state.entries = [{ id: 'demo', name: 'Demo', icon: 'Box', description: 'A demo plugin', enabled: true, status: 'running', appUrl: null, provenance: 'builtin' }];
  const view = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Demo plugin details' }));
  expect(select).toHaveBeenCalledWith('demo');
  view.unmount(); expect(state.offExt).toHaveBeenCalledOnce(); expect(state.offApps).toHaveBeenCalledOnce();
});

it('navigates between the installed collection and Browse while retaining maintenance access', () => {
  setupHub();
  expect(document.querySelector('.ext-hub-shell--installed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Browse', exact: true }));
  expect(screen.getByTestId('browse-plugins')).toBeTruthy();
  expect(document.querySelector('.ext-hub-shell--installed')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Installed' }));
  fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
  expect(screen.getByRole('menuitem', { name: 'Check for updates' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});

function setupHub() { return render(<MemoryRouter><ExtensionsHub /></MemoryRouter>); }

it('respects controlled hub navigation with the outer tabs hidden', () => {
  const onTabChange = vi.fn();
  const view = render(<MemoryRouter><ExtensionsHub tab="marketplace" showTabs={false} onTabChange={onTabChange} /></MemoryRouter>);
  expect(screen.queryByRole('tablist')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
  expect(screen.getByRole('menu', { name: 'Extension maintenance' })).toBeTruthy();
  state.compact = true;
  view.rerender(<MemoryRouter><ExtensionsHub tab="installed" showTabs={false} onTabChange={onTabChange} /></MemoryRouter>);
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Plugin collections' })).getByRole('button', { name: 'Browse', exact: true }));
  expect(onTabChange).toHaveBeenCalledWith('marketplace');
  expect(document.querySelector('.ext-hub-shell--installed')).toBeTruthy();
});
