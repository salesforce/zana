import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  ProjectHarnessSettings,
  ClaudeHarnessFiles,
  CursorHarnessFiles,
  OpenCodeHarnessFiles,
  CodexHarnessFiles,
  ProjectCodexSettings,
  ProjectOpenCodeSettings,
  modelOptions,
  roleOptions,
  ProjectWorktreeIsolationField,
  ProjectSettingsError,
  persistProjectSettings,
  projectSettingsErrorMessage
} from '@/views/settings/ProjectSettingsView';

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
    configFiles: [{ id: 'project-settings', label: 'Project settings', scopes: ['shared', 'local'], effect: 'native-file', rawEdit: true }],
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
    const html = renderToStaticMarkup(<ProjectHarnessSettings project={project} onOpen={() => {}} onSaved={() => {}} />);
    expect(html).toContain('Code harnesses');
    expect(html).toContain('Default harness');
    expect(html).toContain('opener-list');
    expect(html).not.toContain('Worktree isolation');
    expect(html).not.toContain('Harness launch overrides');
    expect(html).not.toContain('Claude CLI settings');
    expect(html).not.toContain('Native settings are available in this harness.');
  });

  it('renders one configured-editor button for each Claude project file', () => {
    const html = renderToStaticMarkup(
      <ClaudeHarnessFiles projectPath="/tmp/project" onOpen={() => {}} />
    );

    expect(html).toContain('>CLAUDE.md</button>');
    expect(html).toContain('>.mcp.json</button>');
    expect(html).toContain('>.claude/settings.json</button>');
    expect(html).toContain('>.claude/settings.local.json</button>');
    expect(html).not.toContain('Edit raw');
  });

  it('renders configured-editor buttons for Cursor project files', () => {
    const html = renderToStaticMarkup(
      <CursorHarnessFiles projectPath="/tmp/project" onOpen={() => {}} />
    );

    expect(html).toContain('>.cursor/mcp.json</button>');
    expect(html).toContain('>.cursor/rules</button>');
  });

  it('renders configured-editor buttons for OpenCode project files', () => {
    const html = renderToStaticMarkup(
      <OpenCodeHarnessFiles projectPath="/tmp/project" onOpen={() => {}} />
    );

    expect(html).toContain('>opencode.json</button>');
    expect(html).toContain('>opencode.jsonc</button>');
    expect(html).toContain('>tui.json</button>');
    expect(html).toContain('>.opencode</button>');
  });

  it('renders configured-editor buttons for Codex project files', () => {
    const html = renderToStaticMarkup(
      <CodexHarnessFiles projectPath="/tmp/project" onOpen={() => {}} />
    );

    expect(html).toContain('>.codex/config.toml</button>');
    expect(html).toContain('>AGENTS.md</button>');
    expect(html).toContain('>AGENTS.override.md</button>');
  });

  it('keeps configured native values available when absent from live catalogs', () => {
    const codex = { ...descriptors[0], id: 'codex' as const, label: 'Codex', targets: { ...descriptors[0].targets!, models: [{ id: 'gpt-5', label: 'GPT-5', scope: ['local'] }] } } as HarnessAdapterDescriptor;
    const opencode = { ...descriptors[0], id: 'opencode' as const, label: 'OpenCode', targets: { ...descriptors[0].targets!, models: [{ id: 'llmgw/gpt-5.6-terra-1M', label: 'Terra', scope: ['local'] }], roles: [{ id: 'build', label: 'Build', scope: ['local'] }] } } as HarnessAdapterDescriptor;

    expect(modelOptions(codex, 'legacy-model').map(({ id }) => id)).toEqual(['legacy-model', 'gpt-5']);
    expect(modelOptions(opencode).map(({ id }) => id)).toEqual(['llmgw/gpt-5.6-terra-1M']);
    expect(roleOptions(opencode, 'custom-agent').map(({ id }) => id)).toEqual(['custom-agent', 'build']);
  });

  it('renders loading, invalid, and catalog-backed native editor states', () => {
    const descriptor = { ...descriptors[0], id: 'opencode' as const, label: 'OpenCode', targets: { ...descriptors[0].targets!, models: [{ id: 'llmgw/gpt-5.6-terra-1M', label: 'Terra', scope: ['local'] }], roles: [{ id: 'build', label: 'Build', scope: ['local'] }] } } as HarnessAdapterDescriptor;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { cc: { codexSettings: { read: vi.fn() }, openCodeSettings: { read: vi.fn() } } }
    });

    expect(renderToStaticMarkup(<ProjectCodexSettings projectId="p1" descriptor={descriptor} onSaved={() => {}} />)).toContain('Loading Codex settings');
    expect(renderToStaticMarkup(<ProjectOpenCodeSettings projectId="p1" descriptor={descriptor} onSaved={() => {}} />)).toContain('Loading OpenCode settings');
  });

  it('uses canonical settings returned by the awaited write', async () => {
    const canonical = { piProvider: 'canonical-provider' };
    const write = vi.fn().mockResolvedValue(canonical);

    await expect(persistProjectSettings('p1', { piProvider: 'draft' }, write)).resolves.toEqual(canonical);
    expect(write).toHaveBeenCalledWith('p1', { piProvider: 'draft' });
  });

  it('round-trips remoteToolProxy like other project settings', async () => {
    const write = vi.fn().mockResolvedValue({ remoteToolProxy: true });
    await expect(persistProjectSettings('p-ssh', { remoteToolProxy: true }, write)).resolves.toEqual({
      remoteToolProxy: true
    });
    expect(write).toHaveBeenCalledWith('p-ssh', { remoteToolProxy: true });
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

describe('ProjectRemoteSettings', () => {
  it('keeps remote start path and does not expose a remote-tools toggle', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./ProjectSettingsView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Remote start path');
    expect(source).toContain('Agents run on this machine');
    expect(source).not.toContain('Local agent, remote tools');
    expect(source).not.toContain('savingProxy');
  });
});
