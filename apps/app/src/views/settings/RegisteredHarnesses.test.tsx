// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { RegisteredHarnesses } from './RegisteredHarnesses.js';
const state = vi.hoisted(() => ({ inventory: {} as any, snapshot: {} as any, ensure: vi.fn(), ensureProvider: vi.fn(), reload: vi.fn(), refresh: vi.fn(), refreshStatus: vi.fn(), catalog: null as any }));
vi.mock('../../hooks/useRegisteredThreadProviders.js', () => ({ useRegisteredThreadProviders: () => state.inventory }));
vi.mock('../../components/thread/pickers/ProviderIcon.js', () => ({ ProviderIcon: () => <span>icon</span> }));
vi.mock('../../components/thread/pickers/thread-model-catalog.js', () => ({ threadModelCatalogForHost: () => state.catalog ?? ({ subscribe: () => () => {}, getSnapshot: () => state.snapshot, ensure: state.ensure, ensureProvider: state.ensureProvider, reload: state.reload, refresh: state.refresh }) }));
const provider = { id: 'codex', displayName: 'Codex', pluginId: 'owner' };
const model = (i: number) => ({ id: `m-${i}`, model: `m-${i}`, displayName: `Model ${i}`, isDefault: i === 0 });
const entry = () => ({ models: [model(0)], modelLoadError: null });
const probe = { family: 'codex', installed: true, version: '1.2.3' } as HarnessVerifyResult;
function View({ config = {}, status = [probe], hostId = 'local', update = vi.fn(async () => {}) }: { config?: Partial<AppConfig>; status?: HarnessVerifyResult[]; hostId?: string; update?: (patch: Partial<AppConfig>) => Promise<void> } = {}) {
  return <MemoryRouter><RegisteredHarnesses config={config as AppConfig} status={status} hostId={hostId || undefined} hostName={hostId ? 'Actual Mac' : undefined} onUpdate={update} onRefreshStatus={state.refreshStatus} checkingStatus={false} /></MemoryRouter>;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.catalog = null;
  state.inventory = { providers: [provider], plugins: [{ id: 'owner', name: 'Provider owner' }], loading: false, error: null, refresh: vi.fn() };
  state.snapshot = { byProvider: { codex: entry() }, inflight: new Set(), provisionalProviders: new Set() };
});
afterEach(cleanup);
describe('RegisteredHarnesses', () => {
  it('shows registered providers and links to their actual plugin without seeded rows', () => {
    render(<View config={{ defaultHarness: 'codex' }} />);
    expect(screen.getByText('Actual Mac · 1 registered')).toBeTruthy();
    expect(screen.getByText('Agent 1.2.3')).toBeTruthy();
    expect(screen.getByText('Default for new agents')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'From Provider owner' }).getAttribute('href')).toBe('/extensions/plugins/owner?view=installed');
    expect(screen.getByRole('link', { name: 'Add harness' }).getAttribute('href')).toBe('/extensions/plugins/browse');
    expect(screen.queryByText('Claude Code')).toBeNull();
    expect(state.ensure).toHaveBeenCalledOnce();
  });
  it('sorts plugin registrations and searches by provider or owning plugin', () => {
    state.inventory.providers = [provider, { id: 'new-agent', displayName: 'Another agent', pluginId: 'third-party' }];
    render(<View />);
    expect([...screen.getByTestId('registered-harness-list').querySelectorAll('h4')].map(n => n.textContent)).toEqual(['Another agent', 'Codex']);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'third-party' } });
    expect(screen.getByText('Another agent')).toBeTruthy(); expect(screen.queryByText('Codex')).toBeNull();
    fireEvent.change(input, { target: { value: 'absent' } });
    expect(screen.getByText('No harnesses match your search.')).toBeTruthy();
  });
  it('shows recovery for an unavailable registration and a missing CLI', () => {
    state.inventory.providers = [{ ...provider, available: false, unavailableReason: 'Runtime damaged' }];
    const view = render(<View />);
    expect(screen.getByText('Runtime damaged')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set up' }).getAttribute('href')).toContain('/owner?');
    state.inventory.providers = [provider];
    view.rerender(<View status={[{ ...probe, installed: false }]} />);
    expect(screen.getByText('Command-line agent not installed')).toBeTruthy();
  });
  it('persists the existing launch default, with pending and failure states', async () => {
    let reject!: (reason: Error) => void;
    const update = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    render(<View update={update} />);
    const button = screen.getByRole('button', { name: 'Use for new agents' });
    fireEvent.click(button);
    expect(update).toHaveBeenCalledWith({ defaultHarness: 'codex' }, { throwOnError: true });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    reject(new Error('save failed'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save Codex'));
    expect(screen.queryByText('Default for new agents')).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  it('retains default badges from persisted configuration and blocks disabled CLI defaults', async () => {
    const update = vi.fn(async () => {});
    const view = render(<View update={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use for new agents' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    view.rerender(<View update={update} config={{ defaultHarness: 'codex' }} />);
    expect((screen.getByRole('button', { name: 'Default' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<View config={{ harnessCodexEnabled: false }} />);
    expect(screen.getByText('CLI disabled')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Use for new agents' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('browses bounded models, expands on request, reloads the same provider, and closes', () => {
    state.snapshot.byProvider.codex.models = Array.from({ length: 51 }, (_, i) => model(i));
    render(<View />);
    const toggle = screen.getByRole('button', { name: 'Browse Codex models' });
    fireEvent.click(toggle);
    expect(screen.getByText('Model 0')).toBeTruthy(); expect(screen.queryByText('Model 50')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more models (50 of 51)' }));
    expect(screen.getByText('Model 50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(state.refresh).toHaveBeenCalledWith('codex');
    fireEvent.click(toggle);
    expect(screen.queryByText('Model 0')).toBeNull();
  });
  it('requests unloaded models and keeps stale catalogue errors visible', () => {
    state.snapshot.byProvider = {};
    const view = render(<View />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse Codex models' }));
    expect(state.ensureProvider).toHaveBeenCalledWith('codex');
    state.snapshot = { ...state.snapshot, byProvider: { codex: { ...entry(), modelLoadError: 'timeout', modelLoadErrorDetail: 'Actual timeout detail' } } };
    view.rerender(<View />);
    expect(screen.getByText('Actual timeout detail')).toBeTruthy();
    expect(screen.getByText(/Previously loaded models/)).toBeTruthy();
  });
  it('refreshes the registry and the same machine catalogue', () => {
    render(<View />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh harnesses' }));
    expect(state.inventory.refresh).toHaveBeenCalledOnce(); expect(state.reload).toHaveBeenCalledOnce(); expect(state.refreshStatus).toHaveBeenCalledOnce();
  });
  it('keeps disconnected data honest and does not request model discovery', () => {
    render(<View hostId="" />);
    expect(screen.getByText('No connected machine · 1 registered')).toBeTruthy();
    expect(screen.getByText(/Machine disconnected/)).toBeTruthy(); expect(state.ensure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Browse Codex models' }));
    expect((screen.getByRole('button', { name: 'Reload models' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh harnesses' }));
    expect(state.reload).not.toHaveBeenCalled();
  });
  it.each([
    [{ loading: true }, 'Loading registered harnesses…'],
    [{ error: 'Registry offline' }, 'Harness registration could not be loaded. Try refreshing.'],
    [{}, 'No provider plugins registered. Add a provider from Plugins to get started.']
  ])('explains an empty registry (%j)', (override, message) => {
    state.inventory = { ...state.inventory, providers: [], ...override };
    render(<View />);
    expect(screen.getByText(message)).toBeTruthy();
  });
});

it('marks retained models stale when the real catalog roster refresh fails', async () => {
  const catalogModule = await vi.importActual<typeof import('../../components/thread/pickers/thread-model-catalog.js')>('../../components/thread/pickers/thread-model-catalog.js');
  let failRoster = false;
  catalogModule.resetThreadModelCatalog(async (query) => {
    if (failRoster && !query?.providerId) throw new Error('Host offline');
    return { providers: [provider], models: [model(0)], selectedOnlyModels: [], permissionCeiling: 'full', modelLoadError: null };
  });
  state.catalog = catalogModule.threadModelCatalogForHost('local');
  const view = render(<View />);
  try {
    await screen.findByText('1 model available');
    failRoster = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh harnesses' }));
    await screen.findByText('Previously loaded models · Could not check provider availability: Host offline');
    expect(screen.queryByText('1 model available')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use for new agents' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Browse Codex models' }));
    expect(screen.getByText('Model 0')).toBeTruthy();
  } finally { view.unmount(); catalogModule.resetThreadModelCatalog(); }
});
