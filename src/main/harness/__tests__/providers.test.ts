import { describe, it, expect, vi } from 'vitest';

// The ClaudeCodeProvider resolves bare family aliases against the developer's
// real ~/.claude/settings.json (see model-resolve.ts). These assertions pin the
// emitted argv (`--model opus` stays a family alias), so pin the resolver to
// identity here — its substitution behaviour has its own suite (model-resolve.test.ts).
vi.mock('../../model-resolve.js', () => ({
  resolveModelAlias: (model: string) => model
}));

import { providerFor } from '../registry.js';
import { ClaudeCodeProvider } from '../claude-code-provider.js';
import { ShellProvider } from '../shell-provider.js';
import { LeastCapableProvider } from '../least-capable-provider.js';
import { LEAST_CAPABLE } from '../../../shared/launch-provider.js';
import type { AppConfig, LaunchProfileId, Persona, ProjectSettings, ProjectRemote } from '../../../shared/types.js';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('registry.providerFor', () => {
  it('routes claude-family profiles to the ClaudeCodeProvider', () => {
    expect(providerFor('claude')).toBeInstanceOf(ClaudeCodeProvider);
    expect(providerFor('claude-resume')).toBeInstanceOf(ClaudeCodeProvider);
    expect(providerFor('claude-yolo')).toBeInstanceOf(ClaudeCodeProvider);
  });

  it('routes shell to the ShellProvider', () => {
    expect(providerFor('shell')).toBeInstanceOf(ShellProvider);
  });

  it('reuses ONE provider instance across profiles (built once, Rule 3)', () => {
    expect(providerFor('claude')).toBe(providerFor('claude-yolo'));
  });

  it('has a stable provider id per family', () => {
    expect(providerFor('claude').id).toBe('claude-code');
    expect(providerFor('shell').id).toBe('shell');
  });

  it('falls back to the LeastCapableProvider for an unregistered id (T2.1)', () => {
    // A profile string that drifted ahead of the registry (newer app version /
    // unregistered harness). Reachable at runtime even though the typed union
    // forbids it, so cast through unknown.
    const ghost = 'gemini-cli' as unknown as LaunchProfileId;
    expect(providerFor(ghost)).toBeInstanceOf(LeastCapableProvider);
    // NOT aliased to the shell provider (the old `?? shell` behaviour).
    expect(providerFor(ghost)).not.toBeInstanceOf(ShellProvider);
  });

  it('the unknown-id fallback exposes the all-off LEAST_CAPABLE floor — no feature activates', () => {
    const ghost = 'gemini-cli' as unknown as LaunchProfileId;
    const caps = providerFor(ghost).capabilities(ghost);
    expect(caps).toEqual(LEAST_CAPABLE);
    // Every gate a feature service keys on is false → nothing fires.
    expect(caps.isAgent).toBe(false);
    expect(caps.hasTranscript).toBe(false);
    expect(caps.supportsHooks).toBe(false);
    expect(caps.acceptsSessionId).toBe(false);
    expect(caps.canAutoCloseOnFinish).toBe(false);
    expect(caps.injectsClaudeMcpConfig).toBe(false);
  });

  it('the unknown-id fallback still degrades the SPAWN to a runnable shell (never a throw)', () => {
    const ghost = 'gemini-cli' as unknown as LaunchProfileId;
    // The literal spawn borrows shell's command so a tab opens, even though the
    // capability set does NOT borrow shell's identity.
    expect(providerFor(ghost).resolveLaunch(ghost, CONFIG, false)).toEqual({
      command: '/bin/zsh',
      args: []
    });
  });
});

describe('LaunchProvider.options (T4.1 — data-driven picker options)', () => {
  it('re-wraps the shared harnessOptions producer per profile', () => {
    // claude family → model + permissionMode roles.
    const claudeRoles = new Set(providerFor('claude').options('claude').map((o) => o.role));
    expect(claudeRoles).toEqual(new Set(['model', 'permissionMode']));

    // codex family → model + sandbox + approval (its permission-mode stand-in).
    const codex = 'codex' as LaunchProfileId;
    const codexRoles = new Set(providerFor(codex).options(codex).map((o) => o.role));
    expect(codexRoles).toEqual(new Set(['model', 'sandbox', 'approval']));

    // shell / unknown → no selectable axes.
    expect(providerFor('shell').options('shell')).toEqual([]);
    const ghost = 'gemini-cli' as unknown as LaunchProfileId;
    expect(providerFor(ghost).options(ghost)).toEqual([]);
  });
});

describe('ClaudeCodeProvider.resolveLaunch', () => {
  const p = new ClaudeCodeProvider();

  it('claude: emits --permission-mode auto when autoModeActive', () => {
    expect(p.resolveLaunch('claude', CONFIG, true)).toEqual({
      command: 'claude',
      args: ['--permission-mode', 'auto']
    });
  });

  it('claude: no permission flag when auto off and no default', () => {
    expect(p.resolveLaunch('claude', CONFIG, false)).toEqual({ command: 'claude', args: [] });
  });

  it('claude-resume: prepends --resume before the global args', () => {
    expect(p.resolveLaunch('claude-resume', CONFIG, true)).toEqual({
      command: 'claude',
      args: ['--resume', '--permission-mode', 'auto']
    });
  });

  it('claude-yolo: forces --dangerously-skip-permissions, never a permission mode', () => {
    expect(p.resolveLaunch('claude-yolo', CONFIG, true)).toEqual({
      command: 'claude',
      args: ['--dangerously-skip-permissions']
    });
  });

});

describe('ClaudeCodeProvider.computeAutoModeActive', () => {
  const p = new ClaudeCodeProvider();
  const base = { config: CONFIG, extraArgs: [] as string[] };

  it('defaults ON for interactive claude', () => {
    expect(p.computeAutoModeActive({ profile: 'claude', ...base })).toBe(true);
  });

  it('OFF for yolo', () => {
    expect(p.computeAutoModeActive({ profile: 'claude-yolo', ...base })).toBe(false);
  });

  it('OFF when autoModeEnabled=false', () => {
    expect(
      p.computeAutoModeActive({ profile: 'claude', config: { ...CONFIG, autoModeEnabled: false }, extraArgs: [] })
    ).toBe(false);
  });

  it('OFF when a per-tab --permission-mode overrides', () => {
    expect(
      p.computeAutoModeActive({ profile: 'claude', config: CONFIG, extraArgs: ['--permission-mode', 'plan'] })
    ).toBe(false);
  });

  it('OFF for a haiku model (auto-mode ineligible)', () => {
    const persona: Persona = { id: 'p', name: 'P', model: 'haiku' };
    expect(
      p.computeAutoModeActive({ profile: 'claude', config: CONFIG, extraArgs: [], persona })
    ).toBe(false);
  });

  it('OFF when a persona pins a permission mode', () => {
    const persona: Persona = { id: 'p', name: 'P', permissionMode: 'acceptEdits' };
    expect(p.computeAutoModeActive({ profile: 'claude', config: CONFIG, extraArgs: [], persona })).toBe(false);
  });

  it('OFF for portable execution choices at every settings level', () => {
    const cases = [
      { config: { ...CONFIG, defaultExecutionState: 'plan' as const }, extraArgs: [] },
      { config: CONFIG, projectSettings: { executionState: 'plan' as const }, extraArgs: [] },
      {
        config: CONFIG,
        projectSettings: { harnessRouting: { schemaVersion: 1 as const, byAdapter: { claude: { executionState: 'plan' as const } } } },
        extraArgs: []
      },
      { config: CONFIG, persona: { id: 'p', name: 'P', executionState: 'plan' as const }, extraArgs: [] }
    ];
    for (const input of cases) {
      expect(p.computeAutoModeActive({ profile: 'claude', ...input })).toBe(false);
    }
  });
});

describe('ClaudeCodeProvider.guidanceArgs', () => {
  const p = new ClaudeCodeProvider();
  it('is empty — claude delivers guidance via --append-system-prompt, not a flag', () => {
    expect(p.guidanceArgs('claude', 'use inbox_push')).toEqual([]);
    expect(p.guidanceArgs('claude-resume', 'use inbox_push')).toEqual([]);
    expect(p.guidanceArgs('claude-yolo', 'use inbox_push')).toEqual([]);
  });
});

describe('ClaudeCodeProvider.hookArgs', () => {
  const p = new ClaudeCodeProvider();
  it('is empty — claude hooks ride the launcher-owned --settings JSON, not a flag', () => {
    const urls = { stop: 'http://127.0.0.1:47821/hook/stop/proj/sess' };
    expect(p.hookArgs('claude', urls)).toEqual([]);
    expect(p.hookArgs('claude-resume', urls)).toEqual([]);
    expect(p.hookArgs('claude-yolo', urls)).toEqual([]);
  });
});

describe('ClaudeCodeProvider.baseArgsPinSession', () => {
  const p = new ClaudeCodeProvider();
  it('true only for claude-resume', () => {
    expect(p.baseArgsPinSession('claude-resume')).toBe(true);
    expect(p.baseArgsPinSession('claude')).toBe(false);
    expect(p.baseArgsPinSession('claude-yolo')).toBe(false);
  });
});

describe('ClaudeCodeProvider.title', () => {
  const p = new ClaudeCodeProvider();
  it('maps each profile', () => {
    expect(p.title('claude')).toBe('claude');
    expect(p.title('claude-resume')).toBe('claude --resume');
    expect(p.title('claude-yolo')).toBe('claude --yolo');
  });
});

describe('ClaudeCodeProvider.buildRemoteCommand', () => {
  const p = new ClaudeCodeProvider();
  const remote: ProjectRemote = { host: 'devbox', user: 'sfwork', remotePath: '/home/sfwork/core' };

  it('cds into the remote path and execs the claude argv (auto mode on ⇒ env prefix)', () => {
    const { cmd } = p.buildRemoteCommand({ profile: 'claude', config: CONFIG, remote });
    expect(cmd).toBe(
      `cd '/home/sfwork/core' && CLAUDE_CODE_ENABLE_AUTO_MODE=1 exec 'claude' '--permission-mode' 'auto'`
    );
  });

  it('prepends the auto-mode env when active', () => {
    const { cmd } = p.buildRemoteCommand({ profile: 'claude', config: CONFIG, remote });
    expect(cmd).toContain('CLAUDE_CODE_ENABLE_AUTO_MODE=1 ');
  });

  it('layers project settings after base args', () => {
    const ps: ProjectSettings = { model: 'sonnet' };
    const { cmd } = p.buildRemoteCommand({ profile: 'claude-yolo', config: CONFIG, remote, projectSettings: ps });
    expect(cmd).toBe(`cd '/home/sfwork/core' && exec 'claude' '--dangerously-skip-permissions' '--model' 'sonnet'`);
  });

  it('folds a persona AND project allowedTools into ONE merged flag (no silent drop)', () => {
    // Regression: the claude CLI takes last-occurrence-wins for --allowedTools,
    // so emitting the persona list AND the project list as two flags silently
    // dropped the persona's list on the remote path (the local path always
    // merged). buildRemoteCommand must fold both into a single deduped flag.
    const persona: Persona = { id: 'p', name: 'P', allowedTools: ['Read', 'Grep'] };
    const ps: ProjectSettings = { allowedTools: ['Write', 'Grep'] };
    const { cmd } = p.buildRemoteCommand({ profile: 'claude', config: CONFIG, remote, persona, projectSettings: ps });
    // Exactly one --allowedTools, carrying the union in first-seen order (Grep deduped).
    expect(cmd.match(/--allowedTools/g)).toHaveLength(1);
    expect(cmd).toContain(`'--allowedTools' 'Write,Grep,Read'`);
  });

  it('applies global, project, persona, then agent prompt layers remotely', () => {
    const { cmd } = p.buildRemoteCommand({
      profile: 'claude',
      config: { ...CONFIG, claudeAppendSystemPrompt: 'global' },
      remote,
      projectSettings: { appendSystemPrompt: 'project' },
      persona: { id: 'p', name: 'P', appendSystemPrompt: 'persona' },
      extraArgs: ['--append-system-prompt', 'agent']
    });
    expect(cmd.indexOf("'global'")).toBeLessThan(cmd.indexOf("'project'"));
    expect(cmd.indexOf("'project'")).toBeLessThan(cmd.indexOf("'persona'"));
    expect(cmd.indexOf("'persona'")).toBeLessThan(cmd.indexOf("'agent'"));
  });

  it('combines denied tools across global, project, and persona layers remotely', () => {
    const { cmd } = p.buildRemoteCommand({
      profile: 'claude',
      config: { ...CONFIG, claudeDeniedTools: ['Bash(rm:*)'] },
      remote,
      projectSettings: { deniedTools: ['Write'] },
      persona: { id: 'p', name: 'P', deniedTools: ['Edit'] }
    });
    expect(cmd.match(/--disallowedTools/g)).toHaveLength(1);
    expect(cmd).toContain("'--disallowedTools' 'Bash(rm:*),Write,Edit'");
  });

  it('emits no --allowedTools when neither persona nor project sets one', () => {
    const persona: Persona = { id: 'p', name: 'P', appendSystemPrompt: 'hi' };
    const { cmd } = p.buildRemoteCommand({ profile: 'claude', config: CONFIG, remote, persona });
    expect(cmd).not.toContain('--allowedTools');
  });

  it('injects no MCP config / inbox tools when remoteMcpUrl is absent (historical default)', () => {
    const { cmd } = p.buildRemoteCommand({ profile: 'claude', config: CONFIG, remote });
    expect(cmd).not.toContain('--mcp-config');
    expect(cmd).not.toContain('zcc-inbox');
    expect(cmd).not.toContain('--append-system-prompt');
  });

  it('forwards MCP: inline --mcp-config with the loopback URL + inbox allowlist + guidance', () => {
    const url = 'http://127.0.0.1:49999/mcp/proj-1/sess-1';
    const { cmd } = p.buildRemoteCommand({ profile: 'claude', config: CONFIG, remote, remoteMcpUrl: url });
    // Inline mcp-config carrying the resolved loopback URL (no remote file).
    expect(cmd).toContain('--mcp-config');
    expect(cmd).toContain(url);
    expect(cmd).toContain('streamable-http');
    // Inbox tools folded into the single --allowedTools flag.
    expect(cmd.match(/--allowedTools/g)).toHaveLength(1);
    expect(cmd).toContain('mcp__zcc-inbox__inbox_push');
    expect(cmd).toContain('mcp__zcc-inbox__inbox_search');
    // Interactive (non-scheduled) ⇒ no schedule_report in the allowlist.
    expect(cmd).not.toContain('mcp__zcc-inbox__schedule_report');
    // Inbox-usage guidance appended to the system prompt.
    expect(cmd).toContain('--append-system-prompt');
  });

  it('adds schedule_report to the inbox allowlist for a scheduled remote run', () => {
    const url = 'http://127.0.0.1:49999/mcp/proj-1/sess-1';
    const { cmd } = p.buildRemoteCommand({
      profile: 'claude',
      config: CONFIG,
      remote,
      remoteMcpUrl: url,
      scheduled: true
    });
    expect(cmd).toContain('mcp__zcc-inbox__schedule_report');
  });
});

describe('ShellProvider', () => {
  const p = new ShellProvider();

  it('resolveLaunch returns the configured shell with empty argv', () => {
    expect(p.resolveLaunch('shell', CONFIG)).toEqual({ command: '/bin/zsh', args: [] });
  });

  it('arg builders are no-ops', () => {
    expect(p.personaArgs({ id: 'p', name: 'P', appendSystemPrompt: 'x' }, 'shell')).toEqual([]);
    expect(p.projectSettingsArgs({ model: 'opus' }, 'shell')).toEqual([]);
    expect(p.mcpArgs('shell', 'http://127.0.0.1/mcp/p/s')).toEqual([]);
    expect(p.guidanceArgs('shell', 'use inbox_push')).toEqual([]);
    expect(p.hookArgs('shell', { stop: 'http://127.0.0.1/hook/stop/p/s' })).toEqual([]);
  });

  it('auto-mode is always off', () => {
    expect(p.computeAutoModeActive({ profile: 'shell', config: CONFIG, extraArgs: [] })).toBe(false);
  });

  it('never pins a session', () => {
    expect(p.baseArgsPinSession('shell')).toBe(false);
  });

  it('remote command execs the login shell with literal ${SHELL} braces', () => {
    const remote: ProjectRemote = { host: 'devbox', remotePath: '/srv/app' };
    const { cmd } = p.buildRemoteCommand({ profile: 'shell', config: CONFIG, remote });
    expect(cmd).toBe(`cd '/srv/app' && exec "\${SHELL:-/bin/sh}" -l`);
  });

  it('title is shell', () => {
    expect(p.title('shell')).toBe('shell');
  });
});
