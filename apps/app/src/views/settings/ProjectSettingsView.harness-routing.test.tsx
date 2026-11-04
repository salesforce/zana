// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import type { Project } from '@zana-ai/zcc-domain/product';

const mocks = vi.hoisted(() => ({
  descriptors: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  pushToast: vi.fn(),
  pending: () => new Promise(() => undefined)
}));
vi.mock('@/store', () => ({
  useData: (select: (value: unknown) => unknown) => select({ updateProject: vi.fn().mockResolvedValue(undefined) }),
  useUi: (select: (value: unknown) => unknown) => select({ pushToast: mocks.pushToast })
}));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    harness: { descriptors: mocks.descriptors },
    projectSettings: { get: mocks.get, set: mocks.set, onChanged: () => () => undefined },
    claudeSettings: { read: mocks.pending, write: mocks.pending },
    codexSettings: { read: mocks.pending, write: mocks.pending },
    openCodeSettings: { read: mocks.pending, write: mocks.pending }
  }
}));

import { ProjectHarnessSettings } from './ProjectSettingsView.js';

const base = {
  agentDefaultEligible: true,
  terminalEligible: false,
  profiles: [],
  availability: { enabled: true, installed: true },
  capabilities: {},
  settingsContributionIds: [],
  configFiles: [],
  initialTaskDelivery: {}
};
const make = (id: string, extra: object = {}) =>
  ({ ...base, id, label: id.toUpperCase(), defaultProfileId: id, ...extra }) as unknown as HarnessAdapterDescriptor;

const descriptors = [
  make('claude', {
    targets: {
      roles: [],
      models: [{ id: 'sonnet', label: 'Sonnet', level: 'medium', scope: ['local'] }],
      executionStateMapping: { interactive: 'default', plan: 'plan' }
    }
  }),
  make('codex'),
  make('opencode'),
  make('cursor'),
  make('pi'),
  make('grok', {
    configFiles: [
      { id: 'a', label: 'Native cfg', scopes: ['shared', 'local'], effect: 'native-file', rawEdit: true },
      { id: 'b', label: 'No raw', scopes: ['local'], effect: 'native-file', rawEdit: false },
      { id: 'c', label: 'Argv cfg', effect: 'argv-app-store', scopes: [], reason: 'argv' },
      { id: 'd', label: 'Nope', effect: 'unsupported', scopes: [], reason: 'not supported here' },
      { id: 'e', label: 'Nope2', effect: 'unsupported', scopes: [] }
    ]
  }),
  make('afcode', { configFiles: [{ id: 'x', label: 'X', effect: 'unsupported', scopes: [], reason: 'afcode reason' }] }),
  make('mastracode')
];

const local = { id: 'p1', name: 'Proj', path: '/tmp/proj' } as Project;
const remote = { id: 'p2', name: 'R', path: '/r', remote: { host: 'h' } } as unknown as Project;

const open = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Project settings for ${name}` }));
};


beforeEach(() => {
  mocks.descriptors.mockReset().mockResolvedValue(descriptors);
  mocks.get.mockReset().mockResolvedValue({});
  mocks.set.mockReset().mockImplementation(async (_id: string, patch: object) => patch);
  mocks.pushToast.mockReset();
});
afterEach(cleanup);

describe('ProjectHarnessSettings routing editor', () => {
  it('renders no launch extras while settings are not loaded', async () => {
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    render(<ProjectHarnessSettings project={local} onOpen={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(mocks.descriptors).toHaveBeenCalled());
    expect(screen.queryByText('Append system prompt')).toBeNull();
  });

  it('saves claude, pi and codex launch fields through the settings write path', async () => {
    const onSaved = vi.fn();
    render(<ProjectHarnessSettings project={local} onOpen={vi.fn()} onSaved={onSaved} />);
    await open('CLAUDE');
    const prompt = await screen.findByPlaceholderText('Optional');
    fireEvent.change(prompt, { target: { value: ' hello ' } });
    fireEvent.blur(prompt);
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('p1', { appendSystemPrompt: 'hello' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    await open('PI');
    const model = await screen.findByPlaceholderText('anthropic/claude-opus-4-8');
    fireEvent.change(model, { target: { value: ' m ' } });
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('p1', { piModel: 'm' }));

    await open('CODEX');
    expect(await screen.findByText('Default Sandbox Policy')).toBeTruthy();
  });

  it('persists routing changes via applyHarnessRoutingPatch', async () => {
    render(<ProjectHarnessSettings project={local} onOpen={vi.fn()} onSaved={vi.fn()} />);
    await open('CLAUDE');
    fireEvent.click(await screen.findByRole('button', { name: /Default execution state/i }));
    fireEvent.click(await screen.findByText(/default \[Interactive\]/));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('p1', {
      harnessRouting: { schemaVersion: 1, byAdapter: { claude: { executionState: 'interactive' } } }
    }));
  });

  it('rolls back and announces a failed save', async () => {
    mocks.set.mockRejectedValue(new Error('disk full'));
    render(<ProjectHarnessSettings project={local} onOpen={vi.fn()} onSaved={vi.fn()} />);
    await open('PI');
    fireEvent.change(await screen.findByPlaceholderText('anthropic'), { target: { value: 'x' } });
    expect((await screen.findByRole('alert')).textContent).toContain('disk full');
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringContaining('disk full'), 'error');
  });

  it('renders per-family harness and files tabs for a local project', async () => {
    const onOpen = vi.fn();
    render(<ProjectHarnessSettings project={local} onOpen={onOpen} onSaved={vi.fn()} />);
    for (const [name, harnessText, filesText] of [
      ['CLAUDE', null, 'CLAUDE.md'],
      ['CODEX', 'Loading Codex settings', '.codex/config.toml'],
      ['OPENCODE', 'Loading OpenCode settings', 'opencode.json'],
      ['CURSOR', 'No native harness settings are available.', '.cursor/rules']
    ] as const) {
      await open(name);
      const row = screen.getByRole('button', { name: `Project settings for ${name}` }).closest('.opener-row') as HTMLElement;
      const click = (label: string) => fireEvent.click(row.querySelector(`[role="tab"][aria-selected]:nth-child(${label === 'Harness Settings' ? 2 : 3})`)!);
      click('Harness Settings');
      if (harnessText) expect(row.textContent).toContain(harnessText);
      click('Harness Files');
      fireEvent.click(await screen.findByRole('button', { name: filesText }));
    }
    expect(onOpen).toHaveBeenCalledTimes(4);
  });

  it('shows native-harness fallback copy for remote projects and generic file statuses', async () => {
    render(<ProjectHarnessSettings project={remote} onOpen={vi.fn()} onSaved={vi.fn()} />);
    await open('CLAUDE');
    const claudeRow = screen.getByRole('button', { name: 'Project settings for CLAUDE' }).closest('.opener-row') as HTMLElement;
    fireEvent.click(claudeRow.querySelectorAll('[role="tab"]')[1]);
    expect(claudeRow.textContent).toContain('No native harness settings are available.');

    await open('GROK');
    const row = screen.getByRole('button', { name: 'Project settings for GROK' }).closest('.opener-row') as HTMLElement;
    fireEvent.click(row.querySelectorAll('[role="tab"]')[2]);
    expect(row.textContent).toContain('shared + local; structured edit available; raw edit available.');
    expect(row.textContent).toContain('local; structured edit available; raw edit unavailable.');
    expect(row.textContent).toContain('Zana app/argv');
    expect(row.textContent).toContain('not supported here');
    expect(row.textContent).toContain('Unsupported');
    fireEvent.click(row.querySelectorAll('[role="tab"]')[1]);
    expect(row.textContent).toContain('No native harness settings are available.');

    await open('AFCODE');
    const af = screen.getByRole('button', { name: 'Project settings for AFCODE' }).closest('.opener-row') as HTMLElement;
    fireEvent.click(af.querySelectorAll('[role="tab"]')[1]);
    expect(af.textContent).toContain('afcode reason');
  });
});
