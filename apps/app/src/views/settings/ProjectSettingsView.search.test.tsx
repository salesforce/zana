// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { ProjectSettingsView } from './ProjectSettingsView.js';
import { entries } from '../../lib/settings-search/entries/project.js';

const mocks = vi.hoisted(() => ({
  updateProject: vi.fn(async () => undefined),
  descriptors: vi.fn(),
  settingsGet: vi.fn(async () => ({})),
  settingsSet: vi.fn(async (_id: string, patch: object) => patch),
  consent: vi.fn(async () => [] as unknown[]),
  claudeRead: vi.fn(),
  codexRead: vi.fn(),
  openCodeRead: vi.fn()
}));
vi.mock('@/store', () => ({
  useData: (select: (value: unknown) => unknown) => select({ updateProject: mocks.updateProject }),
  useUi: (select: (value: unknown) => unknown) => select({ pushToast: vi.fn() })
}));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('./ProjectSourcesSettings.js', () => ({ ProjectSourcesSettings: () => <div data-settings-target="project.checkouts" /> }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    harness: { descriptors: mocks.descriptors },
    projectSettings: { get: mocks.settingsGet, set: mocks.settingsSet, onChanged: () => () => undefined },
    executionConsent: { listProject: mocks.consent, revokeProject: vi.fn() },
    projects: { listProcesses: vi.fn(async () => ({ supported: true, truncated: false, processes: [] })) },
    claudeSettings: { read: mocks.claudeRead, write: vi.fn() },
    codexSettings: { read: mocks.codexRead, write: vi.fn() },
    openCodeSettings: { read: mocks.openCodeRead, write: vi.fn() }
  }
}));

const base = (id: HarnessAdapterDescriptor['id'], label: string, targets: Partial<NonNullable<HarnessAdapterDescriptor['targets']>> = {}): HarnessAdapterDescriptor => ({
  id, label, agentDefaultEligible: true, terminalEligible: false,
  defaultProfileId: id as HarnessAdapterDescriptor['defaultProfileId'],
  profiles: [], availability: { enabled: true, installed: true },
  capabilities: {} as HarnessAdapterDescriptor['capabilities'],
  settingsContributionIds: [],
  configFiles: [],
  targets: {
    roles: [{ id: 'build', label: 'Build', scope: ['local'] }],
    models: [{ id: 'm1', label: 'Model One', level: 'medium', scope: ['local'] }],
    modelLevelMapping: { low: 'm1', medium: 'm1', high: 'm1', 'extra-high': 'm1' },
    ...targets
  } as HarnessAdapterDescriptor['targets'],
  initialTaskDelivery: { local: 'spawn-arg', remote: 'spawn-arg', readinessSignal: 'process-spawned', acceptanceSignal: 'argv-bound' }
});

const local = { id: 'p1', name: 'Proj', path: '/tmp/proj' } as Project;
const remote = { id: 'p2', name: 'Remote', path: '/r', remote: { host: 'box', user: 'me', remotePath: '/srv' } } as unknown as Project;

const seen = (c: HTMLElement) => [...c.querySelectorAll('[data-settings-target]')].map((e) => e.getAttribute('data-settings-target') as string);

beforeEach(() => {
  mocks.descriptors.mockReset().mockResolvedValue([
    base('claude', 'Claude Code', {
      providers: [{ id: 'anthropic', label: 'Anthropic' }],
      providerModelRelationship: 'selectable-provider',
      executionStateMapping: { interactive: 'default' }
    } as never),
    base('codex', 'Codex', { executionStateMapping: { interactive: 'on-request' } } as never),
    base('pi', 'Pi'),
    base('opencode', 'OpenCode')
  ]);
  mocks.settingsGet.mockClear();
  mocks.consent.mockResolvedValue([{ id: 'g1', adapterId: 'claude', mode: 'autonomous', grantedAt: 1 }]);
  const valid = { state: 'valid', hash: 'h', settings: { permissions: { allow: ['Read'] }, model: 'opus' } };
  mocks.claudeRead.mockResolvedValue(valid);
  mocks.codexRead.mockResolvedValue({ state: 'valid', hash: 'h', settings: { model: 'm1' } });
  mocks.openCodeRead.mockResolvedValue({ state: 'valid', hash: 'h', settings: { model: 'm1' } });
});
afterEach(cleanup);

async function openRow(container: HTMLElement, label: string, tab?: string) {
  const toggle = await screen.findByRole('button', { name: `Project settings for ${label}` });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  if (tab) fireEvent.click(await screen.findByRole('tab', { name: tab }));
  return container;
}

describe('ProjectSettingsView settings-search targets', () => {
  it('renders the landing target without a project', () => {
    const { container } = render(<ProjectSettingsView project={null} onOpen={vi.fn()} onSaved={vi.fn()} />);
    expect(seen(container)).toEqual(['project.landing']);
  });

  it('tags the remote connection section and omits local-only sections for a remote project', async () => {
    const { container } = render(<ProjectSettingsView project={remote} onOpen={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole('button', { name: 'Project settings for Claude Code' });
    const ids = seen(container);
    expect(ids).toContain('project.remote-connection');
    expect(ids).toContain('project.remote-start-path');
    expect(ids).not.toContain('project.worktrees');
    expect(ids).not.toContain('project.checkouts');
  });

  it('tags every local section and per-harness row of the project page', async () => {
    const { container } = render(<ProjectSettingsView project={local} onOpen={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(seen(container)).toContain('project.execution-consent'));
    await waitFor(() => expect(seen(container)).toContain('project.worktree-isolation'));
    const found = new Set(seen(container));
    for (const id of ['project.checkouts', 'project.harnesses', 'project.default-harness', 'project.worktrees', 'project.execution-consent']) {
      expect(found.has(id), id).toBe(true);
    }

    // Launch tab of each harness.
    for (const label of ['Claude Code', 'Codex', 'Pi']) {
      await openRow(container, label);
      seen(container).forEach((id) => found.add(id));
    }
    for (const id of [
      'project.default-provider', 'project.default-model-level', 'project.default-execution-state',
      'project.append-system-prompt', 'project.extra-args', 'project.add-dirs', 'project.allowed-tools', 'project.denied-tools',
      'project.codex-sandbox-policy', 'project.codex-approval-policy', 'project.pi-provider', 'project.pi-model', 'project.pi-thinking'
    ]) {
      expect(found.has(id), id).toBe(true);
    }

    // Harness (native) tab of each harness.
    for (const label of ['Claude Code', 'Codex', 'OpenCode']) {
      const row = (await screen.findByRole('button', { name: `Project settings for ${label}` })).closest('.opener-row') as HTMLElement;
      if (row.querySelector('[role="tab"]') === null) fireEvent.click(await screen.findByRole('button', { name: `Project settings for ${label}` }));
      const tab = [...row.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Harness Settings') as HTMLElement;
      fireEvent.click(tab);
      await waitFor(() => expect(row.querySelector('.harness-settings-group [data-settings-target]')).toBeTruthy());
      seen(container).forEach((id) => found.add(id));
    }
    for (const id of [
      'project.codex-model', 'project.codex-approval', 'project.codex-sandbox-mode',
      'project.opencode-model', 'project.opencode-small-model', 'project.opencode-default-agent',
      'project.claude-permission-mode', 'project.claude-model', 'project.claude-allow', 'project.claude-deny', 'project.claude-additional-dirs'
    ]) {
      expect(found.has(id), id).toBe(true);
    }

    // Every id rendered must be a real index entry.
    const known = new Set(entries.map((e) => e.id));
    for (const id of found) expect(known.has(id), `unindexed target ${id}`).toBe(true);
  });
});
