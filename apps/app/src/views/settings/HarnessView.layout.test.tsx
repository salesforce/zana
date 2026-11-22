// @vitest-environment happy-dom
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { HarnessView } from './HarnessView.js';
import { resetThreadModelCatalog } from '../../components/thread/pickers/thread-model-catalog.js';

vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: vi.fn(async () => ({ hostId: 'local', revision: 'fixture', variables: [] })) }));

vi.mock('./ProviderAuthentication.js', () => ({ ProviderAuthentication: () => null }));


const state = vi.hoisted(() => ({
  rows: [] as HarnessVerifyResult[],
  refresh: vi.fn(async () => undefined),
  anchor: null as string | null,
  providers: vi.fn(async () => ({ providers: [{ id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' }] })),
  descriptors: vi.fn(async () => [] as HarnessAdapterDescriptor[]),
  cliStatus: vi.fn(async () => ({})),
  installCli: vi.fn(),
  connected: true
}));
vi.mock('@/store', () => ({
  useData: (select: (value: unknown) => unknown) => select({ harnessStatus: state.rows, refreshHarnessStatus: state.refresh }),
  useUi: (select: (value: unknown) => unknown) => select({ settingsAnchor: state.anchor })
}));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../../hooks/useHosts.js', () => ({
  useHosts: () => [{ id: 'local', name: 'Studio Mac', isPrimary: true, status: state.connected ? 'connected' : 'disconnected' }],
  primaryHost: (hosts: Array<unknown>) => hosts[0]
}));
vi.mock('../../lib/product-client.js', () => ({ product: {
  pluginApps: { list: vi.fn(async () => []), onChanged: vi.fn(() => () => {}) },
  threads: { providers: state.providers },
  harness: { descriptors: state.descriptors },
  hosts: { providerCliStatus: state.cliStatus, installProviderCli: state.installCli }
} }));

beforeEach(() => {
  state.rows = [
    { family: 'claude', label: 'Claude Code', installed: true, alwaysEnabled: true, enabled: true, binary: 'claude', installHint: 'install', version: '2.0' },
    { family: 'codex', label: 'Codex', installed: true, alwaysEnabled: false, enabled: true, binary: 'codex', installHint: 'install' },
    { family: 'pi', label: 'Pi', installed: false, alwaysEnabled: false, enabled: false, binary: 'pi', installHint: 'install' }
  ];
  state.anchor = null;
  state.connected = true;
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.providers.mockReset().mockResolvedValue({ providers: [{ id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' }] });
  state.descriptors.mockReset().mockResolvedValue(state.rows.map((row) => ({
    id: row.family, label: row.label, agentDefaultEligible: true, terminalEligible: false,
    profiles: [], availability: { enabled: row.enabled, installed: row.installed },
    capabilities: {} as HarnessAdapterDescriptor['capabilities'],
    settingsContributionIds: [`${row.family}-global-defaults`], configFiles: [],
    initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
  })));
  state.cliStatus.mockReset().mockResolvedValue({});
  state.installCli.mockReset();
  resetThreadModelCatalog(async () => ({
    providers: [], models: [], selectedOnlyModels: [], permissionCeiling: 'full', modelLoadError: null
  }));
});
afterEach(() => { cleanup(); resetThreadModelCatalog(); });

function View({ initial = {} as AppConfig, update = vi.fn(async () => undefined) } = {}) {
  const [config, setConfig] = useState(initial);
  return <MemoryRouter><HarnessView config={config} onConfigDraft={setConfig} onUpdate={update} /></MemoryRouter>;
}

describe('Harness setup layout', () => {
  it('persists a CLI default independently and clears an unavailable CLI default', async () => {
    const update = vi.fn(async () => undefined);
    const view = render(<View initial={{ defaultThreadProviderId: 'custom' } as AppConfig} update={update} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Default for CLI agents' }));
    fireEvent.click(screen.getByRole('option', { name: 'Codex', exact: true }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ defaultHarness: 'codex' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Default for CLI agents' }).textContent).toContain('Codex'));
    expect(screen.getByRole('button', { name: 'Default for threads' }).textContent).toContain('custom');
    view.unmount();
    render(<View initial={{ defaultHarness: 'pi', defaultThreadProviderId: 'custom' } as AppConfig} update={update} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear default' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ defaultHarness: undefined }));
    expect(screen.getByRole('button', { name: 'Default for threads' }).textContent).toContain('custom');
  });

  it('refreshes installation evidence from the registered harness center', async () => {
    render(<View />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledWith({ refreshModels: false }));
  });

  it('keeps CLI update progress, failure and retry attached to the matching row', async () => {
    state.cliStatus.mockResolvedValue({ codex: { displayName: 'Codex', installed: true,
      installAction: { kind: 'update', label: 'Update CLI', command: 'codex update' } } });
    let finish!: (events: unknown[]) => void;
    state.installCli.mockImplementationOnce((_host, _request, onEvent) => {
      onEvent({ type: 'output', text: 'Checking Codex' });
      return new Promise(resolve => { finish = resolve; });
    });
    render(<View />);
    const bulk = await screen.findByTestId('harness-update-all');
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    const update = await screen.findByTestId('harness-cli-update-codex');
    fireEvent.click(update);
    expect((bulk as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('harness-cli-progress-codex').textContent).toContain('Checking Codex');
    await act(async () => finish([{ type: 'error', message: 'Update interrupted' }]));
    expect(screen.getByTestId('harness-cli-error-codex').textContent).toBe('Update interrupted');
    state.installCli.mockResolvedValueOnce([{ type: 'completed', success: true, exitCode: 0 }]);
    fireEvent.click(bulk);
    await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('harness-cli-error-codex')).toBeNull();
    expect(screen.queryByTestId('harness-cli-progress-codex')).toBeNull();
    expect(state.installCli).toHaveBeenLastCalledWith('local', { provider: 'codex', actionKind: 'update' }, expect.any(Function));
  });

  it('lists installed harnesses alphabetically by label regardless of probe order', async () => {
    state.rows = [
      { family: 'pi', label: 'Pi', installed: false, alwaysEnabled: false, enabled: false, binary: 'pi', installHint: 'install' },
      { family: 'codex', label: 'Codex', installed: true, alwaysEnabled: false, enabled: true, binary: 'codex', installHint: 'install' },
      { family: 'claude', label: 'Claude Code', installed: true, alwaysEnabled: true, enabled: true, binary: 'claude', installHint: 'install' },
      { family: 'opencode', label: 'Pi', installed: true, alwaysEnabled: false, enabled: true, binary: 'opencode', installHint: 'install' }
    ];
    state.descriptors.mockResolvedValue(state.rows.map((row) => ({
      id: row.family, label: row.label, agentDefaultEligible: true, terminalEligible: false,
      profiles: [], availability: { enabled: row.enabled, installed: row.installed },
      capabilities: {} as HarnessAdapterDescriptor['capabilities'],
      settingsContributionIds: [], configFiles: [],
      initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
    })));
      render(<View initial={{ defaultHarness: 'pi' } as AppConfig} />);
    await waitFor(() => expect(screen.getByText(/3 installed · 3 enabled/)).toBeTruthy());
    const names = [...screen.getByTestId('registered-harness-list').querySelectorAll('h4')].map((el) => el.textContent);
    expect(names).toEqual(['Claude Code', 'Codex', 'Pi', 'Pi']);
    expect(state.rows.map((row) => row.family)).toEqual(['pi', 'codex', 'claude', 'opencode']);
    fireEvent.click(await screen.findByRole('button', { name: 'Default for CLI agents' }));
    const picker = await screen.findByRole('listbox');
    const options = within(picker).getAllByRole('option').map((el) => el.textContent ?? '');
    expect(options.map((text) => text.replace(' (not installed)', '').trim())).toEqual(['Claude Code', 'Codex', 'Pi', 'Pi']);
  });

  it('shares one inventory across CLI and thread providers and persists the enable switch', async () => {
    const update = vi.fn(async () => undefined);
    render(<View update={update} />);
    await screen.findByText(/Studio Mac · 2 installed · 2 enabled/);
    const list = within(screen.getByTestId('registered-harness-list'));
    expect(list.getAllByRole('heading', { name: 'Codex' })).toHaveLength(1);
    fireEvent.click(list.getByRole('button', { name: 'Configure Codex' }));
    const codex = list.getByRole('switch', { name: 'Show Codex in the New Agent modal' });
    fireEvent.click(codex);
    expect(codex.getAttribute('aria-checked')).toBe('false');
    expect(update).toHaveBeenCalledWith({ harnessCodexEnabled: false });
    expect(screen.getByTestId('harness-machines-link').getAttribute('href')).toBe('/settings/machines');
    expect(screen.queryByText('experimental_registerProvider')).toBeNull();
  });

  it('reuses loaded status on reopen and only re-probes on refresh', async () => {
    render(<View />);
    await waitFor(() => expect(state.descriptors).toHaveBeenCalled());
    expect(state.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    expect(state.refresh).toHaveBeenCalledWith({ refreshModels: false });
  });

  it('shows probe progress, disables repeat checks, and recovers when the probe completes', async () => {
    let finish!: () => void;
    state.rows = [];
    state.refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<View />);
    expect(state.refresh).toHaveBeenCalledWith({ refreshModels: false });
    expect(screen.getByText(/Checking installation and sign-in…/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(2));
    expect(state.refresh).toHaveBeenLastCalledWith({ refreshModels: false });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check status' })).toBeTruthy());
  });

  it('uses complete disclosure rows for terminal defaults and keeps binary edits working', async () => {
      const update = vi.fn(async () => undefined);
    render(<View update={update} />);
    await waitFor(() => expect(state.descriptors).toHaveBeenCalled());
    const panel = screen.getByTestId('registered-harness-list');
    fireEvent.click(within(panel).getByRole('button', { name: 'Configure Claude Code' }));
    const row = within(panel).getByRole('button', { name: 'Advanced settings for Claude Code' });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const input = within(panel).getByRole('textbox', { name: 'Claude Code binary' });
    fireEvent.change(input, { target: { value: ' /opt/claude ' } });
    fireEvent.blur(input);
    expect(update).toHaveBeenCalledWith({ claudeBinary: '/opt/claude' });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(within(panel).queryByRole('textbox', { name: 'Claude Code binary' })).toBeNull();

  });

  it('keeps the initial empty probe readable when no machine connection is available', async () => {
    state.rows = [];
    state.connected = false;
    render(<View />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check status' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Configure Codex' })).toBeTruthy();
    expect(state.cliStatus).not.toHaveBeenCalled();
  });

  it('keeps Models and Reload inside Modern disclosures when provider discovery fails', async () => {
    state.providers.mockRejectedValueOnce(new Error('offline'));
    render(<View />);
    await screen.findByText(/Could not refresh registered harnesses/);
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    expect(screen.getByRole('button', { name: 'Advanced settings for Codex' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload models' })).toBeNull();
  });

  it('groups Claude instructions, tool rules, arguments, and connection without changing persistence', async () => {
      const update = vi.fn(async () => undefined);
    render(<View update={update} />);
    await screen.findByRole('button', { name: 'Default for CLI agents' });
    fireEvent.click(screen.getByRole('button', { name: 'Configure Claude Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings for Claude Code' }));
    const instructions = screen.getByRole('group', { name: 'Instructions' });
    const prompt = within(instructions).getByRole('textbox', { name: 'Append system prompt' });
    fireEvent.change(prompt, { target: { value: ' Be concise. ' } });
    fireEvent.blur(prompt);
    expect(update).toHaveBeenCalledWith({ claudeAppendSystemPrompt: 'Be concise.' });
    fireEvent.change(prompt, { target: { value: '' } });
    fireEvent.blur(prompt);
    expect(update).toHaveBeenCalledWith({ claudeAppendSystemPrompt: undefined });
    const args = within(screen.getByRole('group', { name: 'Command arguments' })).getByRole('textbox');
    fireEvent.change(args, { target: { value: '--plugin-dir "/some path"' } });
    fireEvent.blur(args);
    expect(update).toHaveBeenCalledWith({ claudeExtraArgs: ['--plugin-dir', '/some path'] });
    fireEvent.change(args, { target: { value: '' } });
    fireEvent.blur(args);
    expect(update).toHaveBeenCalledWith({ claudeExtraArgs: undefined });
    const tools = screen.getByRole('group', { name: 'Tools & access' });
    for (const [label, key, value] of [
      ['Add dirs', 'claudeAddDirs', '/repo'],
      ['Allowed tools', 'claudeAllowedTools', 'Bash(git:*)'],
      ['Denied tools', 'claudeDeniedTools', 'Bash(rm:*)']
    ]) {
      const input = within(tools).getByRole('textbox', { name: `Add ${label}` });
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(update).toHaveBeenCalledWith({ [key]: [value] });
    }
    expect(within(screen.getByRole('group', { name: 'Connection' })).getByRole('textbox', { name: 'Claude Code binary' })).toBeTruthy();
  });

  it('explains disabled or missing harnesses and keeps their connection setting editable', async () => {
      render(<View initial={{ harnessPiEnabled: false } as AppConfig} />);
    await screen.findByRole('button', { name: 'Default for CLI agents' });
    fireEvent.click(screen.getByRole('button', { name: 'Configure Pi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings for Pi' }));
    expect(screen.getByText('Enable this harness above to edit its launch defaults.')).toBeTruthy();
    expect((screen.getByRole('group', { name: 'Provider & reasoning' }) as HTMLFieldSetElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Pi binary' }) as HTMLInputElement).disabled).toBe(false);
    cleanup();
    render(<View initial={{ harnessPiEnabled: true } as AppConfig} />);
    await screen.findByRole('button', { name: 'Default for CLI agents' });
    fireEvent.click(screen.getByRole('button', { name: 'Configure Pi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings for Pi' }));
    expect(screen.getByText(/Install this harness above/)).toBeTruthy();
    expect((screen.getByRole('group', { name: 'Provider & reasoning' }) as HTMLFieldSetElement).disabled).toBe(true);
  });
});
