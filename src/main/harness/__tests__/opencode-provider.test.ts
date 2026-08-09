import { describe, it, expect } from 'vitest';
import { providerFor } from '../registry.js';
import { OpenCodeProvider } from '../opencode-provider.js';
import type { AppConfig, ProjectRemote } from '../../../shared/types.js';
import { shellQuote, shellQuoteArgv } from '../shell-quote.js';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('registry.providerFor — opencode family', () => {
  it('routes opencode profiles to the OpenCodeProvider', () => {
    expect(providerFor('opencode')).toBeInstanceOf(OpenCodeProvider);
    expect(providerFor('opencode-resume')).toBeInstanceOf(OpenCodeProvider);
  });

  it('reuses ONE instance per family (built once, Rule 3)', () => {
    expect(providerFor('opencode')).toBe(providerFor('opencode-resume'));
  });

  it('has a stable provider id', () => {
    expect(providerFor('opencode').id).toBe('opencode');
  });
});

describe('OpenCodeProvider', () => {
  const p = new OpenCodeProvider();
  const remote: ProjectRemote = { host: 'devbox', user: 'sfwork', remotePath: '/home/sfwork/core' };

  it('resolveLaunch: bare opencode, no args', () => {
    expect(p.resolveLaunch('opencode', CONFIG, false)).toEqual({ command: 'opencode', args: [] });
  });

  it('resolveLaunch: opencode-resume prepends --continue when no session id is detected', () => {
    expect(p.resolveLaunch('opencode-resume', CONFIG, false)).toEqual({
      command: 'opencode',
      args: ['--continue']
    });
  });

  it('resolveLaunch: opencode-resume targets a detected session id via --session', () => {
    expect(p.resolveLaunch('opencode-resume', CONFIG, false, 'ses_abc123')).toEqual({
      command: 'opencode',
      args: ['--session', 'ses_abc123']
    });
  });

  it('honors the configured opencodeBinary path', () => {
    const cfg: AppConfig = { ...CONFIG, opencodeBinary: '/opt/opencode/opencode' };
    expect(p.resolveLaunch('opencode', cfg, false).command).toBe('/opt/opencode/opencode');
  });

  it('exposes every configured OpenCode model target for verified local launches only', () => {
    const models = p.adapter.descriptor.targets?.models ?? [];
    expect(models.map((model) => model.id)).toEqual([
      'aisuite/gpt-5.6-luna',
      'aisuite/gpt-5.6-terra',
      'aisuite/gpt-5.6-sol',
      'aisuite/us.anthropic.claude-haiku-4-5-20251001-v1:0',
      'aisuite/us.anthropic.claude-sonnet-5',
      'aisuite/gemini-3.1-pro-preview',
      'aisuite/gemini-3.5-flash'
    ]);
    expect(Object.fromEntries(models.map((model) => [model.id, model.level]))).toMatchObject({
      'aisuite/gpt-5.6-luna': 'low',
      'aisuite/gpt-5.6-terra': 'medium',
      'aisuite/gpt-5.6-sol': 'high',
      'aisuite/us.anthropic.claude-haiku-4-5-20251001-v1:0': 'low',
      'aisuite/us.anthropic.claude-sonnet-5': 'medium',
      'aisuite/gemini-3.1-pro-preview': 'medium',
      'aisuite/gemini-3.5-flash': 'low'
    });
    expect(models.every((model) => model.scope.length === 1 && model.scope[0] === 'local')).toBe(true);
    expect(models.every((model) => model.evidenceVersion === '1.18.0')).toBe(true);
    expect(p.adapter.evidence.map(({ id }) => id)).toEqual(expect.arrayContaining(models.map(({ id }) => id)));
  });

  it('declares approved global execution-state mappings', () => {
    expect(p.adapter.descriptor.targets?.executionStateMapping).toEqual({
      plan: 'plan',
      interactive: 'default',
      'accept-edits': 'build + auto-approve',
      autonomous: 'build + auto-approve'
    });
  });

  it('declares argv-bound opening-task delivery for both local and remote launches', () => {
    expect(p.adapter.descriptor.initialTaskDelivery).toMatchObject({
      local: 'spawn-arg',
      remote: 'spawn-arg',
      acceptanceSignal: 'argv-bound'
    });
  });

  it('mcpEnv wires zcc-inbox as a remote server via OPENCODE_CONFIG_CONTENT', () => {
    const env = p.mcpEnv('opencode', 'http://127.0.0.1:8765/mcp/proj/sess');
    expect(Object.keys(env)).toEqual(['OPENCODE_CONFIG_CONTENT']);
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toEqual({
      mcp: {
        'zcc-inbox': {
          type: 'remote',
          url: 'http://127.0.0.1:8765/mcp/proj/sess',
          enabled: true
        }
      }
    });
  });

  it('mcpEnv bakes the per-session URL straight into the value (no substitution token)', () => {
    const env = p.mcpEnv('opencode-resume', 'http://host/mcp/a/b');
    expect(env.OPENCODE_CONFIG_CONTENT).toContain('"url":"http://host/mcp/a/b"');
    expect(env.OPENCODE_CONFIG_CONTENT).not.toContain('${');
  });

  it('arg builders are no-ops (OpenCode reads MCP/agents/hooks from its own config)', () => {
    expect(p.personaArgs({ id: 'p', name: 'P', appendSystemPrompt: 'x' }, 'opencode')).toEqual([]);
    expect(p.projectSettingsArgs({ model: 'opus' }, 'opencode')).toEqual([]);
    // MCP rides the env (mcpEnv), never argv.
    expect(p.mcpArgs('opencode', 'http://127.0.0.1/mcp/p/s')).toEqual([]);
    expect(p.guidanceArgs('opencode', 'Be concise.')).toEqual([]);
    expect(p.hookArgs('opencode', { stop: 'http://h/hook/stop/p/s' })).toEqual([]);
  });

  it('auth injection is empty (OpenCode authenticates via its own login)', () => {
    expect(p.authKey('opencode')).toBeNull();
    expect(p.authInjection('opencode', { baseUrl: 'https://x', token: 'k' })).toEqual({});
  });

  it('auto-mode always off', () => {
    expect(p.computeAutoModeActive({ profile: 'opencode', config: CONFIG, extraArgs: [] })).toBe(
      false
    );
  });

  it('baseArgsPinSession true only for opencode-resume', () => {
    expect(p.baseArgsPinSession('opencode-resume')).toBe(true);
    expect(p.baseArgsPinSession('opencode')).toBe(false);
  });

  it('capabilities: agent + promptArgv, no launcher-injected flags', () => {
    const caps = p.capabilities('opencode');
    expect(caps.isAgent).toBe(true);
    expect(caps.acceptsPromptArgv).toBe(true);
    expect(caps.hasTranscript).toBe(true);
    // The zcc-inbox MCP rides OPENCODE_CONFIG_CONTENT, NOT the claude --mcp-config
    // path, so this stays false (it gates the claude-only flag block in create()).
    expect(caps.injectsClaudeMcpConfig).toBe(false);
    expect(caps.supportsHooks).toBe(false);
    expect(caps.acceptsSessionId).toBe(false);
    expect(caps.acceptsPermissionMode).toBe(false);
    expect(caps.canAutoCloseOnFinish).toBe(false);
    expect(caps.emitsOscStatus).toBe(false);
  });

  it('remote command starts OpenCode in a pane-local login shell', () => {
    expect(p.buildRemoteCommand({ profile: 'opencode', config: CONFIG, remote }).cmd).toBe(
      `cd '/home/sfwork/core' && exec 'bash' '-lic' ${shellQuote(`exec ${shellQuoteArgv(['opencode'])}`)}`
    );
  });

  it('remote command keeps resume and opening prompt inside the login shell argv', () => {
    const { cmd } = p.buildRemoteCommand({
      profile: 'opencode-resume',
      config: CONFIG,
      remote,
      extraArgs: ['--prompt', 'hello world']
    });
    expect(cmd).toBe(
      `cd '/home/sfwork/core' && exec 'bash' '-lic' ${shellQuote(
        `exec ${shellQuoteArgv(['opencode', '--continue', '--prompt', 'hello world'])}`
      )}`
    );
  });

  it('quotes remote cwd and task bytes through both shell layers', () => {
    const { cmd } = p.buildRemoteCommand({
      profile: 'opencode',
      config: CONFIG,
      remote: { host: 'devbox', remotePath: "/srv/team's app" },
      extraArgs: ['--prompt', 'say "$(whoami)"; `id` $HOME']
    });
    expect(cmd).toBe(
      `cd '/srv/team'\\''s app' && exec 'bash' '-lic' ${shellQuote(
        `exec ${shellQuoteArgv(['opencode', '--prompt', 'say "$(whoami)"; `id` $HOME'])}`
      )}`
    );
  });

  it('does not use configured local binary paths for remote OpenCode', () => {
    const { cmd } = p.buildRemoteCommand({
      profile: 'opencode',
      config: { ...CONFIG, opencodeBinary: '/opt/local/opencode' },
      remote
    });
    expect(cmd).toContain("'opencode'");
    expect(cmd).not.toContain('/opt/local/opencode');
  });

  it('remote command rejects unverified structured target routing', () => {
    expect(() => p.buildRemoteCommand({
      profile: 'opencode',
      config: {
        ...CONFIG,
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: {
            opencode: { modelTargetId: 'aisuite/gpt-5.6-luna', executionState: 'plan' }
          }
        }
      },
      remote,
      projectSettings: {
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: {
            opencode: { modelTargetId: 'aisuite/gpt-5.6-terra', executionState: 'interactive' }
          }
        }
      },
      persona: { id: 'p', name: 'P', modelLevel: 'high', executionState: 'accept-edits' },
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: { modelTargetId: 'aisuite/gemini-3.5-flash', executionState: 'autonomous' }
        }
      }
    })).toThrow('model target is unavailable for remote launches');
  });

  it('title maps each profile', () => {
    expect(p.title('opencode')).toBe('opencode');
    expect(p.title('opencode-resume')).toBe('opencode --continue');
  });

  describe('detectBlockedPrompt (LAS-07 — the non-OSC "needs-you" signal)', () => {
    // Captured live via node-pty (matches the binary source strings
    // `M(q,T("△")),M(q,T("Permission required"))` +
    // `options:{once:"Allow once",always:"Allow always"}`).
    const BLOCKED_SCREEN = [
      '△ Permission required',
      '  # Shell command',
      '$ echo hello > /tmp/oc_perm_test.txt',
      '  Allow once   Allow always   Reject'
    ].join('\n');

    it('matches the real OpenCode permission-prompt screen', () => {
      expect(p.detectBlockedPrompt('opencode', BLOCKED_SCREEN)).toBe(true);
    });

    it('matches on any single action label (title + one button)', () => {
      expect(p.detectBlockedPrompt('opencode', 'Permission required\nReject')).toBe(true);
      expect(p.detectBlockedPrompt('opencode', 'Permission required\nAllow once')).toBe(true);
      expect(p.detectBlockedPrompt('opencode', 'Permission required\nAllow always')).toBe(true);
    });

    it('is case-insensitive (defends against a repaint casing quirk)', () => {
      expect(p.detectBlockedPrompt('opencode', 'PERMISSION REQUIRED ... ALLOW ONCE')).toBe(true);
    });

    it('requires BOTH the title AND an action — prose mentioning permission cannot trip it', () => {
      // Streamed reasoning that happens to say "permission" is NOT a prompt.
      expect(
        p.detectBlockedPrompt('opencode', 'I need permission to edit this file, let me ask.')
      ).toBe(false);
      // The title alone (no action button visible yet) is not enough.
      expect(p.detectBlockedPrompt('opencode', '△ Permission required')).toBe(false);
      // An action word in ordinary output, no title.
      expect(p.detectBlockedPrompt('opencode', 'Reject the null hypothesis.')).toBe(false);
    });

    it('is a no-op for empty / ordinary output', () => {
      expect(p.detectBlockedPrompt('opencode', '')).toBe(false);
      expect(p.detectBlockedPrompt('opencode', 'Reading files and running the build...')).toBe(
        false
      );
    });

    // Surface 2 — the interactive QUESTION / ask-tool prompt (QuestionV2). Captured
    // from a live OpenCode question card: a numbered-options list + a "Type your own
    // answer" row + the select-footer key-hint bar `↑↓ select  enter submit  esc
    // dismiss`. The footer's `r("enter ")+"submit"` / `r("esc ")+"dismiss"` span
    // concatenation renders the two phrases contiguously.
    const QUESTION_SCREEN = [
      'How would you like to spend a free weekend?',
      '  1. Hiking in the mountains',
      '  2. Reading at home',
      '  3. Visiting a museum',
      '  4. Cooking a big meal',
      '  5. Type your own answer',
      '↑↓ select  enter submit  esc dismiss'
    ].join('\n');

    it('matches the interactive question surface via the select-footer key hints', () => {
      expect(p.detectBlockedPrompt('opencode', QUESTION_SCREEN)).toBe(true);
    });

    it('requires BOTH footer phrases — a lone "submit"/"dismiss" cannot trip it', () => {
      // Only one half of the key-hint pair present.
      expect(p.detectBlockedPrompt('opencode', 'press enter submit to continue')).toBe(false);
      expect(p.detectBlockedPrompt('opencode', 'you can esc dismiss this later')).toBe(false);
      // Prose that mentions submit/dismiss but never the contiguous key hints.
      expect(
        p.detectBlockedPrompt('opencode', 'I will submit the PR and dismiss the warning.')
      ).toBe(false);
    });
  });
});
