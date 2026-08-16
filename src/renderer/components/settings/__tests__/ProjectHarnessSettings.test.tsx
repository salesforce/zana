import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HarnessAdapterDescriptor } from '../../../../shared/harness-adapter.js';
import type { Project } from '../../../../shared/types.js';
import {
  ProjectHarnessSettings,
  ProjectWorktreeIsolationField,
  ProjectSettingsError,
  persistProjectSettings,
  projectSettingsErrorMessage
} from '../ProjectTab.js';

const descriptors: HarnessAdapterDescriptor[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    agentDefaultEligible: true,
    terminalEligible: false,
    defaultProfileId: 'claude',
    profiles: [{ id: 'claude', posture: 'default' }],
    availability: { enabled: true, installed: true },
    capabilities: {} as HarnessAdapterDescriptor['capabilities'],
    settingsContributionIds: [],
    targets: {
      roles: [],
      models: [{ id: 'sonnet', label: 'Sonnet', level: 'medium', scope: ['local'] }],
      modelLevelMapping: { low: 'haiku', medium: 'sonnet', high: 'opus', 'extra-high': 'fable' },
      executionStateMapping: { interactive: 'default' }
    },
    initialTaskDelivery: {
      local: 'spawn-arg',
      remote: 'spawn-arg',
      readinessSignal: 'process-spawned',
      acceptanceSignal: 'argv-bound'
    }
  }
];

describe('ProjectHarnessSettings', () => {
  it('offers inherit, enabled, and disabled worktree defaults', () => {
    const html = renderToStaticMarkup(
      <ProjectWorktreeIsolationField value={false} onChange={vi.fn()} />
    );
    expect(html).toContain('Worktree isolation');
    expect(html).toContain('Never use worktrees');
    expect(html).toContain('aria-label="Worktree isolation"');
  });

  it('renders one default harness control and per-harness accordion rows', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        cc: {
          harness: { descriptors: vi.fn().mockResolvedValue(descriptors) },
          projectSettings: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue({}) }
        }
      }
    });
    const project = { id: 'p1', name: 'Project', path: '/tmp/project' } as Project;
    const html = renderToStaticMarkup(<ProjectHarnessSettings project={project} onSaved={() => {}} />);
    expect(html).toContain('Code harnesses');
    expect(html).toContain('Default harness');
    expect(html).toContain('opener-list');
    expect(html).not.toContain('Worktree isolation');
    expect(html).not.toContain('Harness launch overrides');
    expect(html).not.toContain('Claude CLI settings');
  });

  it('uses canonical settings returned by the awaited write', async () => {
    const canonical = { piProvider: 'canonical-provider' };
    const write = vi.fn().mockResolvedValue(canonical);

    await expect(persistProjectSettings('p1', { piProvider: 'draft' }, write)).resolves.toEqual(canonical);
    expect(write).toHaveBeenCalledWith('p1', { piProvider: 'draft' });
  });

  it('propagates write failures for the component to announce', async () => {
    const write = vi.fn().mockRejectedValue(new Error('disk full'));

    await expect(persistProjectSettings('p1', { piProvider: 'draft' }, write)).rejects.toThrow('disk full');
    const error = await persistProjectSettings('p1', { piProvider: 'draft' }, write).catch((cause) => cause);
    const html = renderToStaticMarkup(
      <ProjectSettingsError message={projectSettingsErrorMessage(error)} />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not save project harness settings: disk full');
  });
});
