import { describe, it, expect } from 'vitest';
import { BaseLaunchProvider } from '../base-provider.js';
import { ClaudeCodeProvider } from '../claude/provider.js';
import { CursorProvider } from '../cursor/provider.js';
import { CodexProvider } from '../codex/provider.js';
import { ShellProvider } from '../shell/provider.js';
import type { AppConfig, LaunchProfileId, ProjectRemote } from '@zana-ai/zcc-domain/product';
import type { ResolvedLaunch, RemoteCommandInput, RemoteCommandResult } from '../launch-provider.js';
import { facetSupport, type TrustedHarnessAdapter } from '../adapter-contract.js';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('BaseLaunchProvider — every concrete provider extends it', () => {
  it('all four providers are instances of the base class', () => {
    expect(new ClaudeCodeProvider()).toBeInstanceOf(BaseLaunchProvider);
    expect(new CursorProvider()).toBeInstanceOf(BaseLaunchProvider);
    expect(new CodexProvider()).toBeInstanceOf(BaseLaunchProvider);
    expect(new ShellProvider()).toBeInstanceOf(BaseLaunchProvider);
  });
});

/**
 * A minimal provider that overrides ONLY the three abstract members. It should
 * be a fully-working LaunchProvider purely from the base defaults — the proof
 * that authoring a new "simple CLI" provider is ~25 lines, not ~90.
 */
class MinimalProvider extends BaseLaunchProvider {
  readonly id = 'minimal';
  readonly adapter: TrustedHarnessAdapter = {
    descriptor: {
      id: 'shell',
      label: 'Minimal',
      agentDefaultEligible: false,
      terminalEligible: false,
      profiles: [],
      capabilities: facetSupport({}),
      settingsContributionIds: [],
      configFiles: [],
      initialTaskDelivery: {
        local: 'unsupported',
        remote: 'unsupported',
        readinessSignal: 'none',
        acceptanceSignal: 'delivery-attempted'
      }
    },
    collision: { terminatesAtDoubleDash: true },
    evidence: []
  };
  resolveLaunch(_profile: LaunchProfileId, _config: AppConfig): ResolvedLaunch {
    return { command: 'minimal-cli', args: [] };
  }
  title(): string {
    return 'minimal';
  }
  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    return this.simpleRemoteExec(input, 'minimal-cli');
  }
}

describe('BaseLaunchProvider defaults — a minimal subclass is substitutable', () => {
  const p = new MinimalProvider();

  it('the -c-channel + persona + project builders default to empty', () => {
    expect(p.mcpArgs('shell', 'http://x/mcp/p/s')).toEqual([]);
    expect(p.guidanceArgs('shell', 'guidance')).toEqual([]);
    expect(p.hookArgs('shell', { stop: 'http://x/hook/stop/p/s' })).toEqual([]);
    expect(p.personaArgs({ id: 'p', name: 'P', appendSystemPrompt: 'x' }, 'shell')).toEqual([]);
    expect(p.projectSettingsArgs({ model: 'opus' }, 'shell')).toEqual([]);
  });

  it('auto-mode is off and no session is pinned by default', () => {
    expect(p.computeAutoModeActive({ profile: 'shell', config: CONFIG, extraArgs: [] })).toBe(false);
    expect(p.baseArgsPinSession('shell')).toBe(false);
  });

  it('capabilities delegate to the shared profile accessor', () => {
    // Delegates to providerCapabilities(profile) — a shell profile yields the
    // all-false shell caps regardless of the provider identity.
    expect(p.capabilities('shell').isAgent).toBe(false);
  });

  it('simpleRemoteExec cds and execs the bare binary + cleaned extraArgs', () => {
    const remote: ProjectRemote = { host: 'devbox', remotePath: '/srv/app' };
    const { cmd } = p.buildRemoteCommand({ profile: 'shell', config: CONFIG, remote, extraArgs: ['', 'hello'] });
    // Empty extraArg dropped (cleanExtraArgs), no drift with a hand-rolled filter.
    expect(cmd).toBe(`cd '/srv/app' && exec 'minimal-cli' 'hello'`);
  });
});
