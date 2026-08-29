import { describe, it, expect } from 'vitest';
import { providerFor } from '../registry.js';
import { CursorProvider } from '../cursor/provider.js';
import { CodexProvider } from '../codex/provider.js';
import { ClaudeCodeProvider } from '../claude/provider.js';
import { shellQuote, shellQuoteArgv } from '../shell-quote.js';
import type { AppConfig, ProjectRemote, ProjectSettings } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('registry.providerFor — cursor + codex families', () => {
  it('routes cursor profiles to the CursorProvider', () => {
    expect(providerFor('cursor')).toBeInstanceOf(CursorProvider);
    expect(providerFor('cursor-resume')).toBeInstanceOf(CursorProvider);
    expect(providerFor('cursor-yolo')).toBeInstanceOf(CursorProvider);
  });

  it('routes codex profiles to the CodexProvider', () => {
    expect(providerFor('codex')).toBeInstanceOf(CodexProvider);
    expect(providerFor('codex-resume')).toBeInstanceOf(CodexProvider);
    expect(providerFor('codex-yolo')).toBeInstanceOf(CodexProvider);
  });

  it('reuses ONE instance per family (built once, Rule 3)', () => {
    expect(providerFor('cursor')).toBe(providerFor('cursor-resume'));
    expect(providerFor('cursor')).toBe(providerFor('cursor-yolo'));
    expect(providerFor('codex')).toBe(providerFor('codex-resume'));
    expect(providerFor('codex')).toBe(providerFor('codex-yolo'));
  });

  it('has a stable provider id per family', () => {
    expect(providerFor('cursor').id).toBe('cursor-agent');
    expect(providerFor('codex').id).toBe('codex');
  });
});

describe('CursorProvider', () => {
  const p = new CursorProvider();
  const remote: ProjectRemote = { host: 'devbox', user: 'sfwork', remotePath: '/home/sfwork/core' };

  it('resolveLaunch: bare cursor-agent, no args', () => {
    expect(p.resolveLaunch('cursor', CONFIG, false)).toEqual({ command: 'cursor-agent', args: [] });
  });

  it('resolveLaunch: cursor-resume prepends --resume', () => {
    expect(p.resolveLaunch('cursor-resume', CONFIG, false)).toEqual({
      command: 'cursor-agent',
      args: ['--resume']
    });
  });

  it('resolveLaunch: cursor-yolo passes --force (skip permission prompts)', () => {
    expect(p.resolveLaunch('cursor-yolo', CONFIG, false)).toEqual({
      command: 'cursor-agent',
      args: ['--force']
    });
  });

  it('honors the configured cursorBinary path', () => {
    const cfg: AppConfig = { ...CONFIG, cursorBinary: '/opt/cursor/cursor-agent' };
    expect(p.resolveLaunch('cursor', cfg, false).command).toBe('/opt/cursor/cursor-agent');
  });

  it('arg builders are no-ops (v1: no claude-only flags)', () => {
    expect(p.personaArgs({ id: 'p', name: 'P', appendSystemPrompt: 'x' }, 'cursor')).toEqual([]);
    expect(p.projectSettingsArgs({ model: 'opus' }, 'cursor')).toEqual([]);
  });

  it('auto-mode always off', () => {
    expect(p.computeAutoModeActive({ profile: 'cursor', config: CONFIG, extraArgs: [] })).toBe(false);
  });

  it('baseArgsPinSession true only for cursor-resume', () => {
    expect(p.baseArgsPinSession('cursor-resume')).toBe(true);
    expect(p.baseArgsPinSession('cursor')).toBe(false);
  });

  it('capabilities: agent + promptArgv, no launcher-injected flags', () => {
    const caps = p.capabilities('cursor');
    expect(caps.isAgent).toBe(true);
    expect(caps.acceptsPromptArgv).toBe(true);
    expect(caps.hasTranscript).toBe(false);
    expect(caps.supportsHooks).toBe(false);
    expect(caps.acceptsSessionId).toBe(false);
    expect(caps.acceptsPermissionMode).toBe(false);
    expect(caps.canAutoCloseOnFinish).toBe(false);
    // cursor prints no OSC status glyph → the output-activity heuristic drives it.
    expect(caps.emitsOscStatus).toBe(false);
  });

  it('remote command cds and execs cursor-agent', () => {
    expect(p.buildRemoteCommand({ profile: 'cursor', config: CONFIG, remote }).cmd).toBe(
      `cd '/home/sfwork/core' && exec 'cursor-agent'`
    );
  });

  it('remote command carries --resume for cursor-resume + trailing extraArgs', () => {
    const { cmd } = p.buildRemoteCommand({
      profile: 'cursor-resume',
      config: CONFIG,
      remote,
      extraArgs: ['hello world']
    });
    expect(cmd).toBe(`cd '/home/sfwork/core' && exec 'cursor-agent' '--resume' 'hello world'`);
  });

  it('title maps each profile', () => {
    expect(p.title('cursor')).toBe('cursor');
    expect(p.title('cursor-resume')).toBe('cursor --resume');
    expect(p.title('cursor-yolo')).toBe('cursor --force');
  });
});

describe('CodexProvider', () => {
  const p = new CodexProvider();
  const remote: ProjectRemote = { host: 'devbox', remotePath: '/srv/app' };

  it('resolveLaunch: bare codex, no args', () => {
    expect(p.resolveLaunch('codex', CONFIG, false)).toEqual({ command: 'codex', args: [] });
  });

  it('resolveLaunch: codex-resume uses the resume SUBCOMMAND (not a flag)', () => {
    expect(p.resolveLaunch('codex-resume', CONFIG, false)).toEqual({
      command: 'codex',
      args: ['resume', '--last']
    });
  });

  it('resolveLaunch: codex-resume with an exact id reopens THAT session (resume <uuid>)', () => {
    // The codex twin of claude's `--resume <claudeSessionId>`: a detected rollout
    // id becomes the positional subcommand target, NOT `--last`.
    expect(p.resolveLaunch('codex-resume', CONFIG, false, 'roll-uuid-1')).toEqual({
      command: 'codex',
      args: ['resume', 'roll-uuid-1']
    });
  });

  it('resolveLaunch: codex-yolo passes --dangerously-bypass-approvals-and-sandbox', () => {
    // The full-bypass flag (approvals AND sandbox), distinct from the hooks-only
    // --dangerously-bypass-hook-trust the hook wiring emits.
    expect(p.resolveLaunch('codex-yolo', CONFIG, false)).toEqual({
      command: 'codex',
      args: ['--dangerously-bypass-approvals-and-sandbox']
    });
  });

  it('resolveLaunch: resumeSessionId is IGNORED for the plain codex profile', () => {
    // Only the resume profile consumes the id; a fresh `codex` launch stays bare.
    expect(p.resolveLaunch('codex', CONFIG, false, 'roll-uuid-1')).toEqual({
      command: 'codex',
      args: []
    });
  });

  it('honors the configured codexBinary path', () => {
    const cfg: AppConfig = { ...CONFIG, codexBinary: '/usr/local/bin/codex' };
    expect(p.resolveLaunch('codex', cfg, false).command).toBe('/usr/local/bin/codex');
  });

  it('emits global native sandbox and approval defaults', () => {
    const cfg: AppConfig = {
      ...CONFIG,
      defaultCodexSandbox: 'workspace-write',
      defaultCodexApproval: 'on-request'
    };
    expect(p.resolveLaunch('codex', cfg, false).args).toEqual([
      '-s', 'workspace-write', '-a', 'on-request'
    ]);
  });

  it('maps portable execution states to native sandbox and approval policies', () => {
    expect(p.executionContribution('plan').args).toEqual(['-s', 'read-only', '-a', 'on-request']);
    expect(p.executionContribution('interactive').args).toEqual(['-s', 'workspace-write', '-a', 'untrusted']);
    expect(p.executionContribution('accept-edits').args).toEqual(['-s', 'workspace-write', '-a', 'on-request']);
    expect(p.executionContribution('autonomous').args).toEqual(['-s', 'danger-full-access', '-a', 'never']);
  });

  it('leaves Codex execution tuple emission to effective resolution', () => {
    // Model in codex's own dialect (a slug, not a claude alias). `-c`-shaped
    // flags (--permission-mode/--allowedTools) are NOT emitted — codex uses the
    // sandbox/approval axis instead.
    const ps: ProjectSettings = {
      model: 'gpt-5-codex',
      codexSandbox: 'workspace-write',
      codexApproval: 'on-request',
      appendSystemPrompt: 'x'
    };
    expect(p.projectSettingsArgs(ps, 'codex')).toEqual([]);
    expect(p.modelContribution('gpt-5-codex').args).toEqual(['-m', 'gpt-5-codex']);
    expect(
      p.personaArgs(
        { id: 'p', name: 'P', model: 'gpt-5', codexApproval: 'never' },
        'codex'
      )
    ).toEqual([]);
  });

  it('codex-yolo drops -s/-a (the bypass flag supersedes sandbox/approval) but keeps -m', () => {
    // The full-bypass flag makes the sandbox/approval axis moot, so the persona/
    // projectSettings arg builders suppress -s/-a for codex-yolo — parity with
    // claude-yolo suppressing --permission-mode. The model flag still rides.
    const ps: ProjectSettings = {
      model: 'gpt-5-codex',
      codexSandbox: 'workspace-write',
      codexApproval: 'on-request'
    };
    expect(p.projectSettingsArgs(ps, 'codex-yolo')).toEqual([]);
    expect(
      p.personaArgs({ id: 'p', name: 'P', model: 'gpt-5', codexApproval: 'never' }, 'codex-yolo')
    ).toEqual([]);
  });

  it('arg builders: `default`/empty model is the emit-nothing sentinel', () => {
    // The `default` model + no sandbox/approval → codex uses its own configured
    // defaults, so we emit nothing (byte-identical to a plain launch).
    expect(p.personaArgs({ id: 'p', name: 'P', model: 'default' }, 'codex')).toEqual([]);
    expect(p.projectSettingsArgs({}, 'codex')).toEqual([]);
  });

  it('baseArgsPinSession true only for codex-resume', () => {
    expect(p.baseArgsPinSession('codex-resume')).toBe(true);
    expect(p.baseArgsPinSession('codex')).toBe(false);
  });

  it('capabilities: agent + promptArgv, transcript + hooks bridgeable via -c (A6)', () => {
    const caps = p.capabilities('codex');
    expect(caps.isAgent).toBe(true);
    expect(caps.acceptsPromptArgv).toBe(true);
    // codex writes a readable rollout JSONL (codex-transcript-reader), so it
    // has a summarizable transcript even though its session id is detected, not
    // minted at spawn (acceptsSessionId stays false).
    expect(caps.hasTranscript).toBe(true);
    // codex hooks ride `-c hooks.Stop=…` + the bypass flag (A6), so it can signal
    // turn-end even without the Claude launcher flags.
    expect(caps.supportsHooks).toBe(true);
    expect(caps.canAutoCloseOnFinish).toBe(true);
    expect(caps.acceptsSessionId).toBe(false);
    // codex prints no OSC status glyph → the output-activity heuristic drives it
    // (working/idle from output silence, not from a spinner glyph).
    expect(caps.emitsOscStatus).toBe(false);
  });

  it('remote command execs the resume subcommand for codex-resume', () => {
    expect(p.buildRemoteCommand({ profile: 'codex-resume', config: CONFIG, remote }).cmd).toBe(
      `cd '/srv/app' && exec 'codex' 'resume' '--last'`
    );
  });

  it('remote command adds NO hook args when createRemote wired no remoteHookUrls', () => {
    // shell/cursor gate, scheduled/headless, or a boot before the MCP server
    // binds ⇒ the historical no-hooks remote spawn (bare `exec codex`).
    const { cmd } = p.buildRemoteCommand({ profile: 'codex', config: CONFIG, remote });
    expect(cmd).toBe(`cd '/srv/app' && exec 'codex'`);
    expect(cmd).not.toContain('--dangerously-bypass-hook-trust');
    expect(cmd).not.toContain('-c');
  });

  it('remote command folds the reverse-tunnel -c hooks + bypass flag in ahead of the prompt', () => {
    // createRemote hands codex the loopback `/hook/*` URLs; buildRemoteCommand
    // turns them into the SAME `-c hooks.*` overrides as the local path, spliced
    // BETWEEN the base argv and the trailing per-tab prompt (extraArgs). This is
    // the remote twin of the local codex hook wiring — same routes as claude remote.
    const remoteHookUrls = {
      notify: 'http://127.0.0.1:49200/hook/notify/proj/sess',
      subagent: 'http://127.0.0.1:49200/hook/subagent/proj/sess',
      firstPrompt: 'http://127.0.0.1:49200/hook/firstprompt/proj/sess'
    };
    const { cmd } = p.buildRemoteCommand({
      profile: 'codex',
      config: CONFIG,
      remote,
      remoteHookUrls,
      extraArgs: ['do the thing']
    });
    // The exact same argv the local hookArgs would emit for these urls, quoted
    // and spliced after `codex` and before the prompt.
    const hookArgv = p.hookArgs('codex', remoteHookUrls);
    expect(hookArgv[0]).toBe('--dangerously-bypass-hook-trust');
    for (const a of hookArgv) {
      // Every emitted hook arg (flag, `-c`, and each TOML override) is present,
      // shell-quoted, in the remote command.
      expect(cmd).toContain(shellQuote(a));
    }
    // Bypass flag precedes the prompt; the prompt is last.
    expect(cmd.indexOf('--dangerously-bypass-hook-trust')).toBeGreaterThan(cmd.indexOf("exec 'codex'"));
    expect(cmd.indexOf(shellQuote('do the thing'))).toBeGreaterThan(
      cmd.indexOf('--dangerously-bypass-hook-trust')
    );
  });

  it('remote hook args are byte-identical to the local hookArgs for the same urls', () => {
    // Guards the remote path against drifting from the local path: both must
    // reach the identical `/hook/*` routes with the identical curl commands.
    const remoteHookUrls = {
      stop: 'http://127.0.0.1:49200/hook/stop/proj/sess',
      notify: 'http://127.0.0.1:49200/hook/notify/proj/sess',
      subagent: 'http://127.0.0.1:49200/hook/subagent/proj/sess'
    };
    const { cmd } = p.buildRemoteCommand({
      profile: 'codex',
      config: CONFIG,
      remote,
      remoteHookUrls
    });
    const expectedArgv = ['codex', ...p.hookArgs('codex', remoteHookUrls)];
    expect(cmd).toBe(`cd '/srv/app' && exec ${shellQuoteArgv(expectedArgv)}`);
  });

  it('title maps each profile', () => {
    expect(p.title('codex')).toBe('codex');
    expect(p.title('codex-resume')).toBe('codex resume');
    expect(p.title('codex-yolo')).toBe('codex --yolo');
  });
});

/**
 * The three `-c` global-override bridges (MCP / guidance / hooks) are codex's
 * whole non-Claude parity story, and each interpolates a runtime value into a
 * TOML string. The escaping is the risky part — an unescaped quote/newline in
 * the injected value produces malformed TOML that codex rejects at spawn,
 * silently disabling the bridge. These string-level assertions pin the exact
 * emitted argv so a refactor of the escaper can't regress it unnoticed. (Tier-A
 * #3 from the multi-provider coupling map: the `-c` bridge was previously
 * untested at the string level.)
 */
describe('CodexProvider — the three -c bridges (exact argv + TOML escaping)', () => {
  const p = new CodexProvider();

  describe('mcpArgs (A5 — MCP over -c)', () => {
    it('emits a double-quoted url under mcp_servers.zcc-inbox.url', () => {
      const url = 'http://127.0.0.1:5123/mcp/proj-abc/sess-xyz';
      expect(p.mcpArgs('codex', url)).toEqual(['-c', `mcp_servers.zcc-inbox.url="${url}"`]);
    });

    it('escapes TOML-significant chars in the url (backslash, double-quote)', () => {
      // Our real URLs are plain ASCII, but the escaper is defensive — prove it.
      const url = 'http://h/mcp/a"b\\c';
      expect(p.mcpArgs('codex', url)).toEqual([
        '-c',
        'mcp_servers.zcc-inbox.url="http://h/mcp/a\\"b\\\\c"'
      ]);
    });

    it('is identical for the resume profile (-c is a global option)', () => {
      const url = 'http://127.0.0.1:5123/mcp/p/s';
      expect(p.mcpArgs('codex-resume', url)).toEqual(p.mcpArgs('codex', url));
    });
  });

  describe('guidanceArgs (G3 — developer_instructions over -c)', () => {
    it('returns [] for empty guidance (nothing to inject)', () => {
      expect(p.guidanceArgs('codex', '')).toEqual([]);
    });

    it('emits a double-quoted developer_instructions value', () => {
      expect(p.guidanceArgs('codex', 'Be concise.')).toEqual([
        '-c',
        'developer_instructions="Be concise."'
      ]);
    });

    it('escapes the control chars a TOML basic string forbids raw (\\n, \\t, \\r) + quotes/backslashes', () => {
      const guidance = 'line1\ntab\there\r\nquote " and \\ slash';
      expect(p.guidanceArgs('codex', guidance)).toEqual([
        '-c',
        'developer_instructions="line1\\ntab\\there\\r\\nquote \\" and \\\\ slash"'
      ]);
    });
  });

  describe('hookArgs (A6/C9 — lifecycle hooks over -c + trust bypass)', () => {
    it('returns [] with no hook urls (nothing to wire, no bypass flag)', () => {
      expect(p.hookArgs('codex', {})).toEqual([]);
    });

    it('emits the bypass flag then a Stop hook that curls the stop url (drains stdin)', () => {
      const stop = 'http://127.0.0.1:5123/hook/stop/proj/sess';
      expect(p.hookArgs('codex', { stop })).toEqual([
        '--dangerously-bypass-hook-trust',
        '-c',
        `hooks.Stop=[{matcher="*",hooks=[{type="command",command="cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST \\"${stop}\\""}]}]`
      ]);
    });

    it('maps notify → PermissionRequest(/blocked) + UserPromptSubmit(/unblocked)', () => {
      const notify = 'http://h/hook/notify/p/s';
      const args = p.hookArgs('codex', { notify });
      expect(args[0]).toBe('--dangerously-bypass-hook-trust');
      // PermissionRequest → /blocked (agent waiting on the user).
      expect(args).toContain(
        `hooks.PermissionRequest=[{matcher="*",hooks=[{type="command",command="cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST \\"${notify}/blocked\\""}]}]`
      );
      // UserPromptSubmit → /unblocked (a new turn cleared the wait).
      expect(args).toContain(
        `hooks.UserPromptSubmit=[{matcher="*",hooks=[{type="command",command="cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST \\"${notify}/unblocked\\""}]}]`
      );
    });

    it('maps firstPrompt → a UserPromptSubmit hook that forwards stdin (--data-binary @-)', () => {
      const firstPrompt = 'http://h/hook/firstprompt/p/s';
      const args = p.hookArgs('codex', { firstPrompt });
      expect(args).toContain(
        `hooks.UserPromptSubmit=[{matcher="*",hooks=[{type="command",command="curl -sS -m 5 -o /dev/null -X POST --data-binary @- \\"${firstPrompt}\\""}]}]`
      );
    });

    it('folds notify(/unblocked) + firstPrompt into ONE UserPromptSubmit override (two command entries)', () => {
      const notify = 'http://h/hook/notify/p/s';
      const firstPrompt = 'http://h/hook/firstprompt/p/s';
      const args = p.hookArgs('codex', { notify, firstPrompt });
      // Exactly one UserPromptSubmit key, carrying both commands in order.
      const ups = args.filter((a) => a.startsWith('hooks.UserPromptSubmit='));
      expect(ups).toHaveLength(1);
      expect(ups[0]).toBe(
        `hooks.UserPromptSubmit=[{matcher="*",hooks=[` +
          `{type="command",command="cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST \\"${notify}/unblocked\\""},` +
          `{type="command",command="curl -sS -m 5 -o /dev/null -X POST --data-binary @- \\"${firstPrompt}\\""}` +
          `]}]`
      );
    });

    it('maps subagent → SubagentStart(/start) + SubagentStop(/stop)', () => {
      const subagent = 'http://h/hook/subagent/p/s';
      const args = p.hookArgs('codex', { subagent });
      expect(args).toContain(
        `hooks.SubagentStart=[{matcher="*",hooks=[{type="command",command="cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST \\"${subagent}/start\\""}]}]`
      );
      expect(args).toContain(
        `hooks.SubagentStop=[{matcher="*",hooks=[{type="command",command="cat >/dev/null 2>&1; curl -sS -m 5 -o /dev/null -X POST \\"${subagent}/stop\\""}]}]`
      );
    });

    it('emits the bypass flag exactly ONCE regardless of how many events are wired', () => {
      const args = p.hookArgs('codex', {
        stop: 'http://h/hook/stop/p/s',
        notify: 'http://h/hook/notify/p/s',
        firstPrompt: 'http://h/hook/firstprompt/p/s',
        subagent: 'http://h/hook/subagent/p/s'
      });
      expect(args.filter((a) => a === '--dangerously-bypass-hook-trust')).toHaveLength(1);
      expect(args[0]).toBe('--dangerously-bypass-hook-trust');
    });
  });
});

/**
 * Per-harness auth injection (Settings → Harness). Each provider maps a resolved
 * {@link HarnessAuthCredential} onto its CLI's auth dialect. The load-bearing
 * invariant across all providers: an EMPTY credential ⇒ EMPTY injection, so a
 * plain launch stays byte-identical (the golden-argv net enforces this at the
 * pty level; here we pin the provider contract directly).
 */
describe('authInjection + authKey — per-harness auth dialect', () => {
  it('CursorProvider: env-only, empty when nothing stored', () => {
    const p = new CursorProvider();
    expect(p.authKey('cursor')).toBe('cursor');
    expect(p.authInjection('cursor', {})).toEqual({});
    expect(p.authInjection('cursor', { baseUrl: 'https://cur.example/api' })).toEqual({
      env: { CURSOR_API_URL: 'https://cur.example/api' }
    });
    expect(p.authInjection('cursor', { token: 'k' })).toEqual({ env: { CURSOR_API_KEY: 'k' } });
    expect(p.authInjection('cursor', { baseUrl: 'https://cur.example/api', token: 'k' })).toEqual({
      env: { CURSOR_API_URL: 'https://cur.example/api', CURSOR_API_KEY: 'k' }
    });
  });

  it('CodexProvider: custom-provider -c block + token env, empty when nothing stored', () => {
    const p = new CodexProvider();
    expect(p.authKey('codex')).toBe('codex');
    // No credential ⇒ byte-identical launch (codex uses its own login).
    expect(p.authInjection('codex', {})).toEqual({});

    // A token alone defaults the base_url to codex's normal OpenAI endpoint and
    // routes the bearer through the named env var (fixes the Responses-API 401).
    const tokenOnly = p.authInjection('codex', { token: 'sk-abc' });
    expect(tokenOnly.env).toEqual({ ZCC_CODEX_KEY: 'sk-abc' });
    expect(tokenOnly.args).toEqual([
      '-c',
      'model_provider="zcc"',
      '-c',
      'model_providers.zcc.name="ZCC"',
      '-c',
      'model_providers.zcc.base_url="https://api.openai.com/v1"',
      '-c',
      'model_providers.zcc.env_key="ZCC_CODEX_KEY"'
    ]);

    // A base URL alone still selects the custom provider (no token env emitted).
    const urlOnly = p.authInjection('codex', { baseUrl: 'https://gw.example/v1' });
    expect(urlOnly.env).toEqual({});
    expect(urlOnly.args).toContain('model_providers.zcc.base_url="https://gw.example/v1"');
  });

  it('CodexProvider: escapes a TOML-significant char in the base_url', () => {
    const p = new CodexProvider();
    const { args } = p.authInjection('codex', { baseUrl: 'https://h/v1"x', token: 't' });
    expect(args).toContain('model_providers.zcc.base_url="https://h/v1\\"x"');
  });

  it('ClaudeCodeProvider: env-only ANTHROPIC_BASE_URL/AUTH_TOKEN, empty when nothing stored', () => {
    const p = new ClaudeCodeProvider();
    expect(p.authKey('claude')).toBe('claude');
    // No credential ⇒ byte-identical launch (golden-argv net depends on this).
    expect(p.authInjection('claude', {})).toEqual({});
    // Never emits argv — auth is purely env for claude.
    expect(p.authInjection('claude', { token: 't' })).toEqual({
      env: { ANTHROPIC_AUTH_TOKEN: 't' }
    });
    expect(p.authInjection('claude', { baseUrl: 'https://gw.example' })).toEqual({
      env: { ANTHROPIC_BASE_URL: 'https://gw.example' }
    });
    // The bearer maps to ANTHROPIC_AUTH_TOKEN (gateway form), NOT ANTHROPIC_API_KEY.
    const both = p.authInjection('claude', { baseUrl: 'https://gw.example', token: 'sk-ant-x' });
    expect(both).toEqual({
      env: { ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_AUTH_TOKEN: 'sk-ant-x' }
    });
    expect(both.args).toBeUndefined();
    expect(JSON.stringify(both)).not.toContain('ANTHROPIC_API_KEY');
  });
});
