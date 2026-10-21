// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

async function openBinary(family: 'Claude Code' | 'Codex') {
  state.anchor = 'harness-legacy';
  await waitFor(() => expect(state.descriptors).toHaveBeenCalled());
  const panel = screen.getByRole('tabpanel', { name: 'CLI Agent' });
  const row = within(panel).getByRole('button', { name: `Advanced settings for ${family}` });
  fireEvent.click(within(row).getByText(family));
  return within(panel).getByRole('textbox', { name: `${family} binary` }) as HTMLInputElement;
}

describe('clearing a harness binary field', () => {
  it('sends an empty string when an emptied field is blurred', async () => {
    const update = vi.fn(async () => undefined);
    state.anchor = 'harness-legacy';
    render(<View initial={{ claudeBinary: '/opt/claude', codexBinary: '/opt/codex' } as AppConfig} update={update} />);
    const claude = await openBinary('Claude Code');
    expect(claude.value).toBe('/opt/claude');
    fireEvent.change(claude, { target: { value: '   ' } });
    fireEvent.blur(claude);
    expect(update).toHaveBeenCalledWith({ claudeBinary: '' });
    const codex = await openBinary('Codex');
    fireEvent.change(codex, { target: { value: '' } });
    fireEvent.blur(codex);
    expect(update).toHaveBeenCalledWith({ codexBinary: '' });
  });

  it('sends nothing when an untouched or unchanged field is blurred', async () => {
    const update = vi.fn(async () => undefined);
    state.anchor = 'harness-legacy';
    render(<View initial={{ claudeBinary: 'claude', codexBinary: '/opt/codex' } as AppConfig} update={update} />);
    const claude = await openBinary('Claude Code');
    fireEvent.blur(claude);
    const codex = await openBinary('Codex');
    fireEvent.blur(codex);
    fireEvent.change(codex, { target: { value: '/opt/codex-x' } });
    fireEvent.change(codex, { target: { value: ' /opt/codex ' } });
    fireEvent.blur(codex);
    fireEvent.change(claude, { target: { value: '  ' } });
    fireEvent.blur(claude);
    expect(update).not.toHaveBeenCalled();
  });

  it('renders an empty input when no explicit binary is stored or Claude reports its default', async () => {
    state.anchor = 'harness-legacy';
    render(<View initial={{ claudeBinary: 'claude' } as AppConfig} />);
    const claude = await openBinary('Claude Code');
    expect(claude.value).toBe('');
    expect(claude.placeholder).toBe('claude');
    const codex = await openBinary('Codex');
    expect(codex.value).toBe('');
  });

  it('keeps what the user types, even the word claude, until blur', async () => {
    state.anchor = 'harness-legacy';
    render(<View initial={{ claudeBinary: '/opt/claude' } as AppConfig} />);
    const claude = await openBinary('Claude Code');
    fireEvent.change(claude, { target: { value: 'claude' } });
    expect(claude.value).toBe('claude');
  });
});
