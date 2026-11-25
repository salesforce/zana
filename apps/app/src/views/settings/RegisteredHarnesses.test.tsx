// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { RegisteredHarnesses } from './RegisteredHarnesses.js';
const state = vi.hoisted(() => ({ inventory: {} as any, snapshot: {} as any, ensure: vi.fn(), ensureProvider: vi.fn(), reload: vi.fn(), refresh: vi.fn(), refreshStatus: vi.fn(), catalog: null as any }));
vi.mock('./ProviderAuthentication.js', () => ({ ProviderAuthentication: ({ name, onReady }: { name: string; onReady: () => void }) => <button onClick={onReady}>Finish {name} sign-in</button> }));
vi.mock('../../hooks/useRegisteredThreadProviders.js', () => ({ useRegisteredThreadProviders: () => state.inventory }));
vi.mock('../../components/thread/pickers/ProviderIcon.js', () => ({ ProviderIcon: () => <span>icon</span> }));
vi.mock('../../components/thread/pickers/thread-model-catalog.js', () => ({ threadModelCatalogForHost: () => state.catalog ?? ({ subscribe: () => () => {}, getSnapshot: () => state.snapshot, ensure: state.ensure, ensureProvider: state.ensureProvider, reload: state.reload, refresh: state.refresh }) }));
const provider = { id: 'codex', displayName: 'Codex', pluginId: 'owner' };
const model = (i: number) => ({ id: `m-${i}`, model: `m-${i}`, displayName: `Model ${i}`, supportedReasoningEfforts: [], defaultReasoningEffort: 'medium', isDefault: i === 0 });
const entry = () => ({ models: [model(0)], modelLoadError: null });
const probe = { family: 'codex', label: 'Codex', installed: true, version: '1.2.3' } as HarnessVerifyResult;
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
  it('sets an arbitrary registered thread provider without changing the CLI default', async () => {
    state.inventory.providers = [{ id: 'plugin-custom', displayName: 'Custom', pluginId: 'owner' }];
    state.snapshot.byProvider['plugin-custom'] = entry();
    const update = vi.fn(async () => {});
    render(<View config={{ defaultHarness: 'claude' }} update={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure Custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set as thread default' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ defaultThreadProviderId: 'plugin-custom' }, { throwOnError: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Default for threads' }));
    fireEvent.click(screen.getByRole('option', { name: 'Custom' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]).toEqual([{ defaultThreadProviderId: 'plugin-custom' }, { throwOnError: true }]);
  });
  it('shows the priority strip once under Defaults, covering threads and CLI agents', () => {
    render(<View config={{}} />);
    const strip = screen.getByRole('group', { name: 'Provider, model, role and execution state priority' });
    expect(screen.getAllByRole('group', { name: /priority$/ })).toHaveLength(1);
    expect(strip.textContent).toContain('AgentPersonaProjectGlobalBuilt-in default');
    expect(strip.textContent).toContain('new threads and CLI agents');
  });

  it('shows registered providers and links to their actual plugin without seeded rows', () => {
    render(<View config={{ defaultThreadProviderId: 'codex' }} />);
    expect(screen.getByText('Actual Mac')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(screen.getByText('Thread default')).toBeTruthy();
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
  it('joins a registered provider, a runtime provider, and the local CLI by stable ID', () => {
    state.inventory.providers = [provider, { id: 'acp-hermes-agent', displayName: 'Hermes Agent', pluginId: 'owner' }];
    state.snapshot.providers = [{ id: 'codex', displayName: 'Runtime Codex' }, { id: 'pi', displayName: 'Pi' }];
    const cliOnly = { ...probe, family: 'afcode', label: 'Agentforce Code' } as HarnessVerifyResult;
    const { container } = render(<View status={[probe, cliOnly]} />);
    const rows = [...container.querySelectorAll('.registered-harness')];
    expect(rows.map(row => row.querySelector('h4')?.textContent)).toEqual(['Agentforce Code', 'Codex', 'Hermes Agent', 'Pi']);
    expect(rows[0].getAttribute('data-provider-id')).toBeNull();
    expect(rows[1].getAttribute('data-harness-family')).toBe('codex');
    expect(rows[2].getAttribute('data-harness-family')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Configure Agentforce Code' }));
    expect(screen.queryByRole('button', { name: 'Reload models' })).toBeNull();
    expect(state.ensureProvider).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Configure Pi' }));
    expect(screen.getByRole('button', { name: 'Reload models' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set as thread default' })).toBeNull();
    expect(state.ensureProvider).toHaveBeenCalledWith('pi');
  });
  it('shows recovery for an unavailable registration and a missing CLI', () => {
    state.inventory.providers = [{ ...provider, available: false, unavailableReason: 'Runtime damaged' }];
    const view = render(<View />);
    expect(screen.getByText('Runtime damaged')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    expect(screen.getByRole('link', { name: 'Set up' }).getAttribute('href')).toContain('/owner?');
    state.inventory.providers = [provider];
    view.rerender(<View status={[{ ...probe, installed: false }]} />);
    expect(screen.getByText('Command-line agent not installed')).toBeTruthy();
  });
  it('persists the thread default, with pending and failure states', async () => {
    let reject!: (reason: Error) => void;
    const update = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    render(<View update={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    const button = screen.getByRole('button', { name: 'Set as thread default' });
    fireEvent.click(button);
    expect(update).toHaveBeenCalledWith({ defaultThreadProviderId: 'codex' }, { throwOnError: true });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    reject(new Error('save failed'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save Codex'));
    expect(screen.queryByText('Thread default')).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  it('retains persisted badges and allows a thread default when its CLI agent is disabled', async () => {
    const update = vi.fn(async () => {});
    const view = render(<View update={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set as thread default' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    view.rerender(<View update={update} config={{ defaultThreadProviderId: 'codex' }} />);
    expect((screen.getByRole('button', { name: 'Default' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<View update={update} config={{ harnessCodexEnabled: false }} />);
    expect(screen.getByText('CLI disabled')).toBeTruthy();
    const threadDefaultButton = screen.getByRole('button', { name: 'Set as thread default' }) as HTMLButtonElement;
    expect(threadDefaultButton.disabled).toBe(false);
    fireEvent.click(threadDefaultButton);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]).toEqual([{ defaultThreadProviderId: 'codex' }, { throwOnError: true }]);
  });
  it('browses bounded models, expands on request, reloads the same provider, and closes', () => {
    state.snapshot.byProvider.codex.models = Array.from({ length: 51 }, (_, i) => model(i));
    render(<View />);
    const toggle = screen.getByRole('button', { name: 'Configure Codex' });
    fireEvent.click(toggle);
    expect(screen.getAllByText('Model 0').length).toBeGreaterThan(0); expect(screen.queryByText('Model 50')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Codex models' }), { target: { value: 'm-50' } });
    expect(screen.getByText('Model 50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(state.refresh).toHaveBeenCalledWith('codex');
    fireEvent.click(toggle);
    expect(screen.queryByText('Model 0')).toBeNull();
  });
  it('requests unloaded models and keeps stale catalogue errors visible', () => {
    state.snapshot.byProvider = {};
    const view = render(<View />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    expect(state.ensureProvider).toHaveBeenCalledWith('codex');
    state.snapshot = { ...state.snapshot, byProvider: { codex: { ...entry(), modelLoadError: 'timeout', modelLoadErrorDetail: 'Actual timeout detail' } } };
    view.rerender(<View />);
    expect(screen.getByText('Actual timeout detail')).toBeTruthy();
    expect(screen.getByText(/Previously loaded models/)).toBeTruthy();
  });
  it('refreshes the registry and the same machine catalogue', () => {
    render(<View />);
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    expect(state.inventory.refresh).toHaveBeenCalledOnce(); expect(state.reload).toHaveBeenCalledOnce(); expect(state.refreshStatus).toHaveBeenCalledOnce();
  });
  it('keeps disconnected data honest and does not request model discovery', () => {
    render(<View hostId="" />);
    expect(screen.getByText('No connected machine')).toBeTruthy();
    expect(screen.getByText(/Machine disconnected/)).toBeTruthy(); expect(state.ensure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    expect((screen.getByRole('button', { name: 'Reload models' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    expect(state.reload).not.toHaveBeenCalled();
  });
  it.each([
    [{ loading: true }, 'Loading registered harnesses…'],
    [{ error: 'Registry offline' }, 'Harness registration could not be loaded. Try refreshing.'],
    [{}, 'No provider plugins registered. Add a provider from Plugins to get started.']
  ])('explains an empty registry (%j)', (override, message) => {
    state.inventory = { ...state.inventory, providers: [], ...override };
    render(<View status={[]} />);
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
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await screen.findByText('Previously loaded models · Could not check provider availability: Host offline');
    expect(screen.queryByText('1 model available')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set as thread default' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    expect(screen.getAllByText('Model 0').length).toBeGreaterThan(0);
  } finally { view.unmount(); catalogModule.resetThreadModelCatalog(); }
});

it('refreshes the selected machine provider catalogue when native sign-in becomes ready', () => {
  render(<View />);
  fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
  fireEvent.click(screen.getByRole('button', { name: 'Finish Codex sign-in' }));
  expect(state.refresh).toHaveBeenCalledWith('codex');
});
