// @vitest-environment happy-dom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { HarnessView } from './HarnessView.js';
import { resetThreadModelCatalog } from '../../components/thread/pickers/thread-model-catalog.js';

const state = vi.hoisted(() => ({
  rows: [] as HarnessVerifyResult[],
  refresh: vi.fn(async () => undefined),
  anchor: null as string | null,
  providers: vi.fn(async () => ({ providers: [{ id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' }] })),
  descriptors: vi.fn(async () => [] as HarnessAdapterDescriptor[]),
  cliStatus: vi.fn(async () => ({})),
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
  threads: { providers: state.providers },
  harness: { descriptors: state.descriptors },
  hosts: { providerCliStatus: state.cliStatus }
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
  resetThreadModelCatalog(async () => ({
    providers: [], models: [], selectedOnlyModels: [], permissionCeiling: 'full', modelLoadError: null
  }));
});
afterEach(() => { cleanup(); resetThreadModelCatalog(); });

function View({ initial = {} as AppConfig, update = vi.fn(async () => undefined) } = {}) {
  const [config, setConfig] = useState(initial);
  return <HarnessView config={config} onConfigDraft={setConfig} onUpdate={update} />;
}

describe('Harness setup layout', () => {
  it('leads with installation, gives the machine context, and persists the enable switch immediately', async () => {
    const update = vi.fn(async () => undefined);
    const { container } = render(<View update={update} />);
    await waitFor(() => expect(screen.getByText('2 installed · 2 enabled')).toBeTruthy());
    const headings = [...container.querySelectorAll('.harness-settings > section > h3')].map((el) => el.textContent);
    expect(headings).toEqual(['Installed harnesses', 'Model lists', 'Session settings']);
    expect(screen.getByText('This machine · Studio Mac')).toBeTruthy();
    const status = within(screen.getByTestId('harness-status-list'));
    expect(status.getByText('Always on')).toBeTruthy();
    expect(status.getByText('Installed')).toBeTruthy();
    expect(status.getByText('Not installed')).toBeTruthy();
    const codex = status.getByRole('switch', { name: 'Show Codex in the New Agent modal' });
    fireEvent.click(codex);
    expect(codex.getAttribute('aria-checked')).toBe('false');
    expect(update).toHaveBeenCalledWith({ harnessCodexEnabled: false });
    expect(screen.getByTestId('harness-machines-link').getAttribute('href')).toBe('/settings/machines');
    expect(screen.queryByText('experimental_registerProvider')).toBeNull();
  });

  it('shows probe progress, disables repeat checks, and recovers when the probe completes', async () => {
    let finish!: () => void;
    state.refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<View />);
    expect(state.refresh).toHaveBeenCalledWith({ refreshModels: false });
    expect(screen.getByText('Checking installation and sign-in…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(2));
    expect(state.refresh).toHaveBeenLastCalledWith({ refreshModels: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check status' })).toBeTruthy());
  });

  it('uses complete disclosure rows for terminal defaults and keeps binary edits working', async () => {
    state.anchor = 'harness-legacy';
    const update = vi.fn(async () => undefined);
    render(<View update={update} />);
    await waitFor(() => expect(state.descriptors).toHaveBeenCalled());
    const panel = screen.getByRole('tabpanel', { name: 'CLI Agent' });
    const row = within(panel).getByRole('button', { name: 'Advanced settings for Claude Code' });
    fireEvent.click(within(row).getByText('Claude Code'));
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const input = within(panel).getByRole('textbox', { name: 'Claude Code binary' });
    fireEvent.change(input, { target: { value: ' /opt/claude ' } });
    fireEvent.blur(input);
    expect(update).toHaveBeenCalledWith({ claudeBinary: '/opt/claude' });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(within(panel).queryByRole('textbox', { name: 'Claude Code binary' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Modern' }));
    expect(screen.getByRole('tabpanel', { name: 'Modern' }).id).toBe('settings-anchor-harness-thread');
  });

  it('keeps the initial empty probe readable when no machine connection is available', async () => {
    state.rows = [];
    state.connected = false;
    render(<View />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check status' })).toBeTruthy());
    expect(within(screen.getByTestId('harness-status-list')).getByText('Checking…')).toBeTruthy();
    expect(state.cliStatus).not.toHaveBeenCalled();
  });

  it('keeps Models and Reload inside Modern disclosures when provider discovery fails', async () => {
    state.providers.mockRejectedValueOnce(new Error('offline'));
    render(<View />);
    await waitFor(() => expect(screen.getByText('No Modern providers registered.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Models for Codex' })).toBeNull();
  });

  it('groups Claude instructions, tool rules, arguments, and connection without changing persistence', async () => {
    state.anchor = 'harness-legacy';
    const update = vi.fn(async () => undefined);
    render(<View update={update} />);
    await screen.findByRole('button', { name: 'Default harness' });
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
    expect(screen.getByLabelText('Settings priority').textContent).toContain('GlobalProjectPersonaAgent');
  });

  it('explains disabled or missing harnesses and keeps their connection setting editable', async () => {
    state.anchor = 'harness-legacy';
    render(<View initial={{ harnessPiEnabled: false } as AppConfig} />);
    await screen.findByRole('button', { name: 'Default harness' });
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings for Pi' }));
    expect(screen.getByText('Enable this harness above to edit its launch defaults.')).toBeTruthy();
    expect((screen.getByRole('group', { name: 'Provider & reasoning' }) as HTMLFieldSetElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Pi binary' }) as HTMLInputElement).disabled).toBe(false);
    cleanup();
    render(<View initial={{ harnessPiEnabled: true } as AppConfig} />);
    await screen.findByRole('button', { name: 'Default harness' });
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings for Pi' }));
    expect(screen.getByText(/Install this harness above/)).toBeTruthy();
    expect((screen.getByRole('group', { name: 'Provider & reasoning' }) as HTMLFieldSetElement).disabled).toBe(true);
  });
});
