// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HubRow } from '../extensions/installed-plugins';
const h = vi.hoisted(() => ({ index: {} as any, get: vi.fn(), save: vi.fn(), retry: vi.fn(), host: vi.fn() }));
vi.mock('@/plugins/plugin-settings-index', () => ({ usePluginSettingsIndex: () => h.index }));
vi.mock('@/plugins/installed-plugin-store', () => ({ retryInstalledPlugins: h.retry }));
vi.mock('@/lib/product-client', () => ({ product: { pluginApps: { getSettings: h.get, setSettings: h.save } } }));
vi.mock('@/modules/ModulePanelHost', () => ({ getHost: h.host }));
vi.mock('@/plugins/PluginSettingsSections', () => ({ PluginSettingsSections: () => <input aria-label="Custom filter" /> }));
vi.mock('@/plugins/PluginLoadFailure', () => ({ PluginLoadFailure: ({ detail }: { detail: string }) => <div role="alert">{detail}</div> }));
import { PluginSettingsView } from './PluginSettingsView';

const snapshot = { descriptors: { name: { type: 'string', label: 'Name' }, budget: { type: 'number', label: 'Budget' } }, values: { name: 'Before', budget: 1 } };
const row = (id = 'sample'): HubRow => ({ module: { id, title: id, icon: 'Box' }, entry: null, plugin: { id, enabled: true, name: id, status: 'running', description: 'Sample plugin' } as never });
function Nav() { const go = useNavigate(); return <><button onClick={() => go('/settings/plugins/other')}>Other</button><button onClick={() => go('/settings/plugins/sample?area=configuration&setting=name#plugin-configure')}>Reveal</button></>; }
const mount = (url = '/settings/plugins/sample') => render(<MemoryRouter initialEntries={[url]}><Nav /><Routes><Route path="/settings/plugins/:pluginId" element={<PluginSettingsView />} /></Routes></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks(); h.index = { rows: [row(), row('other')], sections: [{ pluginId: 'sample', title: 'Connections' }], loading: false, error: '' };
  h.get.mockResolvedValue(snapshot); h.save.mockImplementation(async (_id, values) => ({ ...snapshot, values: { ...snapshot.values, ...values } }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

it('keeps custom state across areas, saves numbers through the existing API, and links to management', async () => {
  mount(); await screen.findByRole('navigation', { name: 'Plugin settings areas' });
  expect(screen.getByRole('link', { name: 'Plugin details' }).getAttribute('href')).toBe('/extensions/plugins/sample?view=installed');
  fireEvent.change(screen.getByLabelText('Custom filter'), { target: { value: 'kept' } });
  fireEvent.click(screen.getByRole('button', { name: 'Configuration', exact: true }));
  const budget = screen.getByRole('spinbutton', { name: 'Budget' }); fireEvent.change(budget, { target: { value: '7' } }); fireEvent.blur(budget);
  await waitFor(() => expect(h.save).toHaveBeenCalledWith('sample', { budget: 7 }));
  fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
  expect((screen.getByLabelText('Custom filter') as HTMLInputElement).value).toBe('kept');
});

it('reveals descriptor deep links, including a repeated navigation, and reports failed saves', async () => {
  h.save.mockRejectedValue(new Error('Save denied')); mount('/settings/plugins/sample?setting=name#plugin-configure');
  const input = await screen.findByRole('textbox', { name: 'Name' });
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.change(input, { target: { value: 'After' } }); fireEvent.blur(input);
  expect((await screen.findByRole('alert')).textContent).toBe('Save denied');
  fireEvent.click(screen.getByRole('button', { name: 'Reveal' })); await waitFor(() => expect(document.activeElement).toBe(input));
});

it('supports custom-only and no-settings plugins without empty area controls', async () => {
  h.get.mockResolvedValue({ descriptors: {}, values: {} }); const view = mount();
  await waitFor(() => expect(screen.queryByText('Loading configuration…')).toBeNull());
  expect(screen.getByLabelText('Custom filter')).toBeTruthy(); expect(screen.queryByRole('navigation')).toBeNull();
  view.unmount(); h.index.sections = []; mount();
  expect(await screen.findByText('This plugin does not expose any settings.')).toBeTruthy();
});

it('keeps disabled/unconsented code inert and explains unavailable runtime settings', async () => {
  h.index.rows[0].plugin.enabled = false; const view = mount();
  expect(screen.getByText(/This plugin is disabled/)).toBeTruthy(); expect(h.get).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Custom filter')).toBeNull();
  view.unmount(); h.index.rows[0] = { ...row(), entry: { enabled: true, needsConsent: true } }; mount();
  expect(screen.getByText(/Review this plugin/)).toBeTruthy(); expect(h.get).not.toHaveBeenCalled();
});

it('renders loading, missing-plugin, and discovery failure states with retry', () => {
  h.index.rows = []; h.index.loading = true; const view = mount(); expect(screen.getByText('Loading plugin…')).toBeTruthy();
  view.unmount(); h.index.loading = false; h.index.error = 'Offline'; const failed = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(h.retry).toHaveBeenCalledOnce(); failed.unmount();
  h.index.error = ''; mount(); expect(screen.getByText('This plugin is no longer installed.')).toBeTruthy();
});

it('retries failed reads and ignores a stale response after switching plugins', async () => {
  h.get.mockRejectedValueOnce(new Error('Read denied')); mount();
  expect((await screen.findByRole('alert')).textContent).toContain('Read denied');
  let resolve!: (value: typeof snapshot) => void;
  h.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.click(screen.getByRole('button', { name: 'Other' }));
  await screen.findByRole('textbox', { name: 'Name' });
  await act(async () => resolve({ ...snapshot, values: { name: 'Stale', budget: 9 } }));
  expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Before');
});

it('preserves legacy host readiness and renderer failure boundaries', async () => {
  const legacy = row(); legacy.plugin = null; legacy.module.settingsPanel = () => <p>Legacy settings</p>;
  legacy.entry = { enabled: true, mainActive: false } as never; h.index.rows = [legacy]; h.index.sections = [];
  const view = mount(); expect(screen.getByText(/main process is not running/)).toBeTruthy(); expect(h.host).not.toHaveBeenCalled();
  view.unmount(); legacy.entry!.mainActive = true; const ready = mount(); expect(screen.getByText('Legacy settings')).toBeTruthy(); expect(h.host).toHaveBeenCalledWith('sample');
  ready.unmount(); h.index.rows = [{ ...row(), module: { ...row().module, loadError: 'Renderer failed' }, plugin: { ...row().plugin, status: 'degraded', statusDetail: 'Recover runtime' } }];
  h.get.mockResolvedValue({ descriptors: {}, values: {} }); mount(); expect(screen.getByRole('alert').textContent).toBe('Renderer failed');
  expect(await screen.findByText(/Plugin settings are unavailable/)).toBeTruthy();
});

it('ignores an older save response after a newer field save completes', async () => {
  let finishFirst!: (value: typeof snapshot) => void;
  h.save.mockImplementationOnce(() => new Promise(done => { finishFirst = done; }))
    .mockResolvedValueOnce({ ...snapshot, values: { name: 'After', budget: 7 } });
  mount('/settings/plugins/sample?area=configuration');
  const budget = await screen.findByRole('spinbutton', { name: 'Budget' });
  fireEvent.change(budget, { target: { value: '7' } }); fireEvent.blur(budget);
  const name = screen.getByRole('textbox', { name: 'Name' });
  fireEvent.change(name, { target: { value: 'After' } }); fireEvent.blur(name);
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
  await act(async () => finishFirst({ ...snapshot, values: { name: 'Before', budget: 7 } }));
  expect((name as HTMLInputElement).value).toBe('After');
});
