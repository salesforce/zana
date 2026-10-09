// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { HarnessView } from './HarnessView.js';
import { RevealContext, type RevealState } from '../../lib/settings-search/reveal.js';
import { resetThreadModelCatalog } from '../../components/thread/pickers/thread-model-catalog.js';

const state = vi.hoisted(() => ({
  rows: [] as HarnessVerifyResult[],
  descriptors: vi.fn(async () => [] as HarnessAdapterDescriptor[])
}));
vi.mock('@/store', () => ({
  useData: (select: (value: unknown) => unknown) => select({ harnessStatus: state.rows, refreshHarnessStatus: vi.fn(async () => undefined) }),
  useUi: (select: (value: unknown) => unknown) => select({ settingsAnchor: 'harness-legacy' })
}));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../../hooks/useHosts.js', () => ({
  useHosts: () => [{ id: 'local', name: 'Studio Mac', isPrimary: true, status: 'connected' }],
  primaryHost: (hosts: Array<unknown>) => hosts[0]
}));
vi.mock('../../lib/product-client.js', () => ({ product: {
  threads: { providers: vi.fn(async () => ({ providers: [{ id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' }] })) },
  harness: { descriptors: state.descriptors },
  hosts: { providerCliStatus: vi.fn(async () => ({})) }
} }));

const descriptor = (id: 'claude' | 'codex'): HarnessAdapterDescriptor => ({
  id, label: id, agentDefaultEligible: true, terminalEligible: false,
  profiles: [], availability: { enabled: true, installed: true },
  capabilities: {} as HarnessAdapterDescriptor['capabilities'],
  settingsContributionIds: [`${id}-global-defaults`], configFiles: [],
  targets: {
    roles: [],
    providers: [{ id: 'anthropic', label: 'Anthropic' }],
    models: [{ id: 'sonnet', label: 'Sonnet', level: 'medium', scope: ['local'] }],
    modelLevelMapping: { low: 'haiku', medium: 'sonnet', high: 'opus', 'extra-high': 'fable' },
    executionStateMapping: { interactive: 'default' }
  } as HarnessAdapterDescriptor['targets'],
  initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
});

beforeEach(() => {
  state.rows = [
    { family: 'claude', label: 'Claude Code', installed: true, alwaysEnabled: true, enabled: true, binary: 'claude', installHint: 'install' },
    { family: 'codex', label: 'Codex', installed: true, alwaysEnabled: false, enabled: true, binary: 'codex', installHint: 'install' }
  ];
  state.descriptors.mockReset().mockResolvedValue([descriptor('claude'), descriptor('codex')]);
  resetThreadModelCatalog(async () => ({ providers: [], models: [], selectedOnlyModels: [], permissionCeiling: 'full', modelLoadError: null }));
});
afterEach(() => { cleanup(); resetThreadModelCatalog(); });

function View({ reveal, initial = {} as AppConfig, update = vi.fn(async () => undefined) }: { reveal?: RevealState; initial?: AppConfig; update?: () => Promise<undefined> }) {
  const [config, setConfig] = useState(initial);
  const view = <HarnessView config={config} onConfigDraft={setConfig} onUpdate={update} />;
  return reveal ? <RevealContext.Provider value={reveal}>{view}</RevealContext.Provider> : view;
}
const has = (c: HTMLElement, id: string) => !!c.querySelector(`[data-settings-target="${id}"]`);

describe('HarnessView settings-search targets', () => {
  it('tags the status rows and keeps collapsed launch-default rows closed without a reveal', async () => {
    const { container } = render(<View />);
    await waitFor(() => expect(state.descriptors).toHaveBeenCalled());
    for (const id of ['harness.installed-harnesses', 'harness.model-lists', 'harness.session-settings', 'harness.claude.row', 'harness.codex.row', 'harness.codex.enabled', 'harness.default-harness']) {
      expect(has(container, id), id).toBe(true);
    }
    expect(has(container, 'harness.claude.binary')).toBe(false);
  });

  it.each(['harness.claude.binary', 'harness.claude.default-provider', 'harness.claude.default-model-level', 'harness.claude.default-execution-state'])(
    'opens the Claude row when a jump targets %s',
    async (target) => {
      const { container } = render(<View reveal={{ target, reveal: null }} />);
      await screen.findByRole('button', { name: 'Advanced settings for Claude Code' });
      await waitFor(() => expect(has(container, target), target).toBe(true));
      expect(has(container, 'harness.codex.binary')).toBe(false);
    }
  );

  it('omits optional launch-default fields when the descriptor has no targets', async () => {
    state.descriptors.mockResolvedValue([{ ...descriptor('claude'), targets: undefined }]);
    const { container } = render(<View reveal={{ target: 'harness.claude.binary', reveal: null }} />);
    await waitFor(() => expect(has(container, 'harness.claude.binary')).toBe(true));
    expect(has(container, 'harness.claude.default-provider')).toBe(false);
    expect(has(container, 'harness.claude.default-model-level')).toBe(false);
    expect(has(container, 'harness.claude.default-execution-state')).toBe(false);
  });

  it('persists tool allow/deny chips added from the revealed Claude row', async () => {
    const update = vi.fn(async () => undefined);
    render(<View update={update} reveal={{ target: 'harness.claude.allowed-tools', reveal: null }} />);
    await screen.findByRole('button', { name: 'Default harness' });
    for (const [label, key, value] of [['Allowed tools', 'claudeAllowedTools', 'Bash(git:*)'], ['Denied tools', 'claudeDeniedTools', 'Bash(rm:*)']]) {
      const input = await screen.findByRole('textbox', { name: `Add ${label}` });
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(update).toHaveBeenCalledWith({ [key]: [value] });
    }
  });

  it('clears the tool list settings when the last chip is removed', async () => {
    const update = vi.fn(async () => undefined);
    const initial = { claudeAddDirs: ['/repo'], claudeAllowedTools: ['Read'] } as AppConfig;
    render(<View update={update} initial={initial} reveal={{ target: 'harness.claude.add-dirs', reveal: null }} />);
    await screen.findByRole('button', { name: 'Default harness' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove /repo' }));
    expect(update).toHaveBeenCalledWith({ claudeAddDirs: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Read' }));
    expect(update).toHaveBeenCalledWith({ claudeAllowedTools: undefined });
  });
});
