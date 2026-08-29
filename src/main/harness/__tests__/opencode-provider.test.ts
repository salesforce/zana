import { describe, it, expect, vi } from 'vitest';
import { providerFor, registrationFor } from '../registry.js';
import {
  OpenCodeAgentDiscoveryCache,
  OpenCodeAgentDiscoveryError,
  OpenCodeProvider,
  enrichOpenCodeAgentDescriptors,
  parseOpenCodeAgentDescriptors,
  parseOpenCodeAgentDebugOutput,
  parseOpenCodeAgentDiscoveryOutput
} from '../opencode/provider.js';
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

describe('parseOpenCodeAgentDescriptors', () => {
  it('returns renderer-safe mode-aware descriptors and dedupes by id', () => {
    expect(parseOpenCodeAgentDescriptors([
      '  build (primary)  ',
      'general (all)',
      'research (subagent)',
      'build (primary)'
    ].join('\n'))).toEqual([
      { id: 'build', label: 'build', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'general', label: 'general', mode: 'all', hidden: false, directLaunchAllowed: true },
      { id: 'research', label: 'research', mode: 'subagent', hidden: false, directLaunchAllowed: false }
    ]);
  });

  it('skips unknown modes and unsafe ids', () => {
    const tooLong = 'x'.repeat(257);
    expect(parseOpenCodeAgentDescriptors([
      'ok (primary)',
      'also-ok (subagent)',
      'unknown (mystery)',
      'two words (primary)',
      '-flag (primary)',
      'bad\u0007id (primary)',
      'bad\u0080id (primary)',
      `${tooLong} (primary)`,
      ' (primary)'
    ].join('\n'))).toEqual([
      { id: 'ok', label: 'ok', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'also-ok', label: 'also-ok', mode: 'subagent', hidden: false, directLaunchAllowed: false }
    ]);
  });

  it('accepts whitespace-only output as an established empty catalog but rejects non-empty output without headings', () => {
    expect(parseOpenCodeAgentDiscoveryOutput(' \n\t\r\n')).toEqual([]);
    expect(() => parseOpenCodeAgentDiscoveryOutput('build\tprimary\nplan\tprimary'))
      .toThrow('OpenCode agent discovery returned non-empty unrecognized output');
  });

  it('ignores non-heading lines and invalid candidate headings while preserving safe headings', () => {
    expect(parseOpenCodeAgentDiscoveryOutput([
      'OpenCode agents',
      'build (primary)',
      'warning: config changed',
      'build (primary)',
      '-unsafe (all)',
      'two words (subagent)',
      'researcher (subagent)'
    ].join('\n'))).toEqual([
      { id: 'build', label: 'build', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'researcher', label: 'researcher', mode: 'subagent', hidden: false, directLaunchAllowed: false }
    ]);
  });

  it('accepts complete expected OpenCode output including blank lines and all recognized modes', () => {
    expect(parseOpenCodeAgentDiscoveryOutput('\nbuild (primary)\nplan (subagent)\ngeneral (all)\n')).toEqual([
      { id: 'build', label: 'build', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'plan', label: 'plan', mode: 'subagent', hidden: false, directLaunchAllowed: false },
      { id: 'general', label: 'general', mode: 'all', hidden: false, directLaunchAllowed: true }
    ]);
  });

  it('accepts real-shaped OpenCode output without parsing or validating permission details', () => {
    expect(parseOpenCodeAgentDiscoveryOutput([
      'build (primary)',
      '  [',
      '  {',
      '    "permission": "*",',
      '    "action": "allow",',
      '    "pattern": "*"',
      '  },',
      '  {',
      '    "permission": "external_directory",',
      '    "pattern": "/Users/example/.local/share/opencode/tool-output/*",',
      '    "action": "allow",',
      '    "futureShape": { "nested": [true, false] }',
      '  }',
      ']',
      'human log text may appear here',
      'researcher (subagent)',
      '  [',
      '  this block is intentionally not valid JSON',
      '  ]'
    ].join('\n'))).toEqual([
      { id: 'build', label: 'build', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'researcher', label: 'researcher', mode: 'subagent', hidden: false, directLaunchAllowed: false }
    ]);
  });

  it('parses only renderer-safe hidden metadata from debug JSON', () => {
    expect(parseOpenCodeAgentDebugOutput('{"hidden":true,"description":"secret","permission":{"*":"allow"}}'))
      .toEqual({ hidden: true });
    expect(parseOpenCodeAgentDebugOutput('{"name":"visible"}')).toEqual({ hidden: false });
    expect(parseOpenCodeAgentDebugOutput('{"name":"visible","hidden":null}')).toEqual({ hidden: false });
    expect(parseOpenCodeAgentDebugOutput('{"name":"visible","hidden":"unexpected"}')).toEqual({ hidden: false });
    expect(parseOpenCodeAgentDebugOutput('{\n  "name": "hidden",\n  "hidden": true,\n  "permission": ['))
      .toEqual({ hidden: true });
    expect(parseOpenCodeAgentDebugOutput('{\n  "name": "visible",\n  "description": "\\\"hidden\\\": true",\n  "permission": ['))
      .toEqual({ hidden: false });
    for (const output of ['[]', 'null', 'not json', 'warning: stale config\n{"hidden":null}']) {
      expect(() => parseOpenCodeAgentDebugOutput(output)).toThrow('OpenCode agent debug returned invalid metadata');
    }
  });

  it('enriches primary agents with bounded debug metadata and excludes hidden direct launch', async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const loadDebug = vi.fn((id: string) => new Promise<string>((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      release.push(() => {
        active -= 1;
        resolve(JSON.stringify({ hidden: id === 'hidden-primary', description: 'must not escape' }));
      });
    }));
    const enriched = enrichOpenCodeAgentDescriptors([
      { id: 'hidden-primary', label: 'hidden-primary', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'visible-primary', label: 'visible-primary', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'visible-all', label: 'visible-all', mode: 'all', hidden: false, directLaunchAllowed: true },
      { id: 'worker', label: 'worker', mode: 'subagent', hidden: false, directLaunchAllowed: false }
    ], loadDebug);
    await vi.waitFor(() => expect(loadDebug).toHaveBeenCalledTimes(2));
    expect(peak).toBe(2);
    release.splice(0).forEach((done) => done());
    await vi.waitFor(() => expect(loadDebug).toHaveBeenCalledTimes(3));
    release.splice(0).forEach((done) => done());

    await expect(enriched).resolves.toEqual([
      { id: 'hidden-primary', label: 'hidden-primary', mode: 'primary', hidden: true, directLaunchAllowed: false },
      { id: 'visible-primary', label: 'visible-primary', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'visible-all', label: 'visible-all', mode: 'all', hidden: false, directLaunchAllowed: true },
      { id: 'worker', label: 'worker', mode: 'subagent', hidden: false, directLaunchAllowed: false }
    ]);
    expect(loadDebug).not.toHaveBeenCalledWith('worker');
  });

  it('fails enrichment closed when any primary debug command fails', async () => {
    await expect(enrichOpenCodeAgentDescriptors([
      { id: 'visible', label: 'visible', mode: 'primary', hidden: false, directLaunchAllowed: true },
      { id: 'worker', label: 'worker', mode: 'subagent', hidden: false, directLaunchAllowed: false }
    ], async () => { throw new Error('sensitive debug failure'); })).rejects.toMatchObject({
      code: 'debug-failed',
      agentId: 'visible'
    });
  });

  it('classifies invalid debug metadata with only the safe candidate id', async () => {
    await expect(enrichOpenCodeAgentDescriptors([
      { id: 'visible', label: 'visible', mode: 'primary', hidden: false, directLaunchAllowed: true }
    ], async () => 'not json')).rejects.toMatchObject({
      code: 'invalid-debug-metadata',
      agentId: 'visible'
    });
  });

  it('projects internal discovery errors to renderer-safe typed failures', async () => {
    expect(OpenCodeProvider.failureResult(new OpenCodeAgentDiscoveryError('list-failed'))).toEqual({
      status: 'failure',
      reason: 'list-failed'
    });
    expect(OpenCodeProvider.failureResult(
      new OpenCodeAgentDiscoveryError('debug-failed', 'build', { cause: new Error('/secret/path permission denied') })
    )).toEqual({ status: 'failure', reason: 'debug-failed', agentId: 'build' });
    expect(OpenCodeProvider.failureResult(new Error('raw stdout and prompt'))).toEqual({
      status: 'failure',
      reason: 'list-failed'
    });
  });

  it('rejects non-empty permission or log output when no safe heading exists', () => {
    expect(() => parseOpenCodeAgentDiscoveryOutput('  [\nwarning\n  ]'))
      .toThrow('OpenCode agent discovery returned non-empty unrecognized output');
  });

  it('filters role targets authoritatively before launch mapping', () => {
    expect(OpenCodeProvider.roleTargetsFromDiscovery({ status: 'success', descriptors: [
      { id: 'build', label: 'build', mode: 'subagent', hidden: false, directLaunchAllowed: false },
      { id: 'hidden', label: 'hidden', mode: 'primary', hidden: true, directLaunchAllowed: false },
      { id: 'general', label: 'general', mode: 'all', hidden: false, directLaunchAllowed: true }
    ] }, [
      { id: 'build', label: 'Build', scope: ['local'] },
      { id: 'plan', label: 'Plan', scope: ['local'] }
    ])).toEqual([
      { id: 'general', label: 'general', scope: ['local'] }
    ]);
  });

  it('keeps static fallback available to UI mapping after discovery failure', () => {
    const staticRoles = [{ id: 'build', label: 'Build', scope: ['local'] as ['local'] }];
    expect(OpenCodeProvider.roleTargetsFromDiscovery({ status: 'failure' }, staticRoles)).toBe(staticRoles);
  });

  it('contains unexpected discovery exceptions at launch preflight', async () => {
    class ThrowingOpenCodeProvider extends OpenCodeProvider {
      override async discoverAgentDescriptors(): ReturnType<OpenCodeProvider['discoverAgentDescriptors']> {
        throw new Error('parser escaped');
      }
    }
    await expect(new ThrowingOpenCodeProvider().discoverRoleTargets({ cwd: '/repo', config: CONFIG }))
      .resolves.toEqual([]);
  });
});

describe('OpenCodeAgentDiscoveryCache', () => {
  it('dedupes in-flight work, caches success by binary and cwd, and bypasses only explicit refresh', async () => {
    let now = 1_000;
    const cache = new OpenCodeAgentDiscoveryCache(5_000, 2, () => now);
    let resolveFirst!: (value: readonly never[]) => void;
    const firstLoader = vi.fn(() => firstLoader.mock.calls.length === 1
      ? new Promise<readonly never[]>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve([]));
    const first = cache.discover('/bin/opencode', '/one', firstLoader);
    const duplicate = cache.discover('/bin/opencode', '/one', firstLoader);
    expect(firstLoader).toHaveBeenCalledTimes(1);
    resolveFirst([]);
    await expect(Promise.all([first, duplicate])).resolves.toEqual([[], []]);

    await cache.discover('/bin/opencode', '/one', firstLoader);
    expect(firstLoader).toHaveBeenCalledTimes(1);
    await cache.discover('/other/opencode', '/one', vi.fn(async () => []));
    await cache.discover('/bin/opencode', '/two', vi.fn(async () => []));
    await cache.discover('/bin/opencode', '/one', firstLoader, { bypassCache: true });
    expect(firstLoader).toHaveBeenCalledTimes(2);

    now += 5_001;
    await cache.discover('/bin/opencode', '/one', firstLoader);
    expect(firstLoader).toHaveBeenCalledTimes(3);
  });

  it('keeps default discovery results for the app lifetime until explicit refresh', async () => {
    let now = 1_000;
    const cache = new OpenCodeAgentDiscoveryCache(undefined, 8, () => now);
    const load = vi.fn(async () => [] as const);
    await cache.discover('opencode', '/project', load);
    now += 86_400_000;
    await cache.discover('opencode', '/project', load);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.discover('opencode', '/project', load, { bypassCache: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('retains startup-warmed catalogs for more than the legacy eight-project limit', async () => {
    const cache = new OpenCodeAgentDiscoveryCache();
    const firstProjectLoad = vi.fn(async () => [] as const);
    await Promise.all(Array.from({ length: 16 }, (_, index) => cache.discover(
      'opencode', `/project-${index}`, index === 0 ? firstProjectLoad : async () => []
    )));

    await cache.discover('opencode', '/project-0', firstProjectLoad);
    expect(firstProjectLoad).toHaveBeenCalledTimes(1);
  });

  it('does not retain failed discovery', async () => {
    const cache = new OpenCodeAgentDiscoveryCache();
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([]);
    await expect(cache.discover('opencode', '/one', loader)).rejects.toThrow('boom');
    await expect(cache.discover('opencode', '/one', loader)).resolves.toEqual([]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not let an older automatic completion replace a newer force-refresh cache entry', async () => {
    const cache = new OpenCodeAgentDiscoveryCache();
    const oldResult = [{ id: 'old', label: 'old', mode: 'primary', hidden: false, directLaunchAllowed: true }] as const;
    const refreshedResult = [{ id: 'new', label: 'new', mode: 'primary', hidden: false, directLaunchAllowed: true }] as const;
    let resolveOld!: (value: typeof oldResult) => void;
    let resolveRefresh!: (value: typeof refreshedResult) => void;
    const oldLoad = cache.discover('opencode', '/one', () => new Promise((resolve) => { resolveOld = resolve; }));
    const refreshLoad = cache.discover(
      'opencode',
      '/one',
      () => new Promise((resolve) => { resolveRefresh = resolve; }),
      { bypassCache: true }
    );

    resolveRefresh(refreshedResult);
    await expect(refreshLoad).resolves.toEqual(refreshedResult);
    resolveOld(oldResult);
    await expect(oldLoad).resolves.toEqual(oldResult);

    const cachedLoad = vi.fn(async () => oldResult);
    await expect(cache.discover('opencode', '/one', cachedLoad)).resolves.toEqual(refreshedResult);
    expect(cachedLoad).not.toHaveBeenCalled();
  });

  it('globally bounds concurrent discovery across keys and cache-bypass calls', async () => {
    const cache = new OpenCodeAgentDiscoveryCache(5_000, 8, Date.now, 2);
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const loader = vi.fn(() => new Promise<readonly never[]>((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      releases.push(() => {
        active -= 1;
        resolve([]);
      });
    }));

    const discoveries = [
      cache.discover('opencode', '/one', loader, { bypassCache: true }),
      cache.discover('opencode', '/two', loader, { bypassCache: true }),
      cache.discover('opencode', '/three', loader, { bypassCache: true })
    ];
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(peak).toBe(2);
    releases.shift()?.();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
    expect(peak).toBe(2);
    releases.splice(0).forEach((release) => release());
    await expect(Promise.all(discoveries)).resolves.toEqual([[], [], []]);
  });

  it('coalesces force refreshes for the same key while preserving automatic bypass', async () => {
    const cache = new OpenCodeAgentDiscoveryCache();
    let resolveAutomatic!: (value: readonly never[]) => void;
    let resolveRefresh!: (value: readonly never[]) => void;
    const automaticLoader = vi.fn(() => new Promise<readonly never[]>((resolve) => { resolveAutomatic = resolve; }));
    const refreshLoader = vi.fn(() => new Promise<readonly never[]>((resolve) => { resolveRefresh = resolve; }));

    const automatic = cache.discover('opencode', '/one', automaticLoader);
    const refresh = cache.discover('opencode', '/one', refreshLoader, { bypassCache: true });
    const duplicateRefresh = cache.discover('opencode', '/one', refreshLoader, { bypassCache: true });

    expect(automaticLoader).toHaveBeenCalledTimes(1);
    expect(refreshLoader).toHaveBeenCalledTimes(1);
    expect(duplicateRefresh).toBe(refresh);
    resolveRefresh([]);
    resolveAutomatic([]);
    await expect(Promise.all([automatic, refresh, duplicateRefresh])).resolves.toEqual([[], [], []]);
  });

  it('rejects cleanly when the global pending queue is full', async () => {
    const cache = new OpenCodeAgentDiscoveryCache(5_000, 8, Date.now, 1, 2);
    const releases: Array<() => void> = [];
    const loader = vi.fn(() => new Promise<readonly never[]>((resolve) => releases.push(() => resolve([]))));

    const active = cache.discover('opencode', '/active', loader, { bypassCache: true });
    const pendingOne = cache.discover('opencode', '/pending-one', loader, { bypassCache: true });
    const pendingTwo = cache.discover('opencode', '/pending-two', loader, { bypassCache: true });
    await expect(cache.discover('opencode', '/overflow', loader, { bypassCache: true }))
      .rejects.toThrow('OpenCode agent discovery queue is full');
    expect(loader).toHaveBeenCalledTimes(1);

    releases.shift()?.();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
    releases.shift()?.();
    await expect(Promise.all([active, pendingOne, pendingTwo])).resolves.toEqual([[], [], []]);
  });
});

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

  it('builds only a registration-owned exact native resume plan', () => {
    expect(registrationFor('opencode')?.nativeConversationResume?.('ses_exact')).toEqual({
      profile: 'opencode-resume', resumeSessionId: 'ses_exact'
    });
  });
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
      'llmgw/gpt-5.6-luna-1M',
      'llmgw/gpt-5.6-terra-1M',
      'llmgw/gpt-5.6-sol-1M',
      'llmgw/gemini-3.5-flash',
      'llmgw/gemini-3.1-pro-preview',
      'llmgw/grok-4.6'
    ]);
    expect(Object.fromEntries(models.map((model) => [model.id, model.level]))).toMatchObject({
      'llmgw/gpt-5.6-luna-1M': 'low',
      'llmgw/gpt-5.6-terra-1M': 'medium',
      'llmgw/gpt-5.6-sol-1M': 'high',
      'llmgw/gemini-3.5-flash': 'low',
      'llmgw/gemini-3.1-pro-preview': 'medium',
      'llmgw/grok-4.6': 'high'
    });
    expect(models.every((model) => model.scope.length === 1 && model.scope[0] === 'local')).toBe(true);
    expect(models.every((model) => model.evidenceVersion === '1.18.0')).toBe(true);
    expect(p.adapter.evidence.map(({ id }) => id)).toEqual(expect.arrayContaining(models.map(({ id }) => id)));
  });

  it('describes 1.18.0 as a minimum supported and reviewed floor', () => {
    expect(p.adapter.evidence.every(({ observed }) =>
      observed?.startsWith('Minimum supported/reviewed CLI floor: 1.18.0.')
    )).toBe(true);
  });

  it('maps dynamic roles to explicit reviewed discovery evidence', () => {
    expect(p.dynamicRoleEvidenceTarget(
      { id: 'reviewer', label: 'reviewer', scope: ['local'] },
      '1.18.10'
    )).toEqual({
      id: 'opencode.role.discovery', label: 'reviewer', scope: ['local'], evidenceVersion: '1.18.0'
    });
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
            opencode: { modelTargetId: 'llmgw/gpt-5.6-luna-1M', executionState: 'plan' }
          }
        }
      },
      remote,
      projectSettings: {
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: {
            opencode: { modelTargetId: 'llmgw/gpt-5.6-terra-1M', executionState: 'interactive' }
          }
        }
      },
      persona: { id: 'p', name: 'P', modelLevel: 'high', executionState: 'accept-edits' },
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: { modelTargetId: 'llmgw/gemini-3.5-flash', executionState: 'autonomous' }
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

    it('matches the current interactive question footer using "enter confirm"', () => {
      expect(
        p.detectBlockedPrompt('opencode', 'tab select  enter confirm  esc dismiss')
      ).toBe(true);
    });

    it('requires BOTH footer phrases — a lone "submit"/"dismiss" cannot trip it', () => {
      // Only one half of the key-hint pair present.
      expect(p.detectBlockedPrompt('opencode', 'press enter submit to continue')).toBe(false);
      expect(p.detectBlockedPrompt('opencode', 'press enter confirm to continue')).toBe(false);
      expect(p.detectBlockedPrompt('opencode', 'you can esc dismiss this later')).toBe(false);
      // Prose that mentions submit/dismiss but never the contiguous key hints.
      expect(
        p.detectBlockedPrompt('opencode', 'I will submit the PR and dismiss the warning.')
      ).toBe(false);
    });
  });
});

describe.runIf(process.env.ZCC_LIVE_OPENCODE === '1')('OpenCodeProvider live discovery', () => {
  it('discovers this project through the real CLI', async () => {
    const result = await new OpenCodeProvider().discoverAgentDescriptors({
      cwd: process.cwd(),
      config: CONFIG
    }, { bypassCache: true });
    expect(result).toMatchObject({ status: 'success' });
    if (result.status === 'success') {
      expect(result.descriptors.filter(({ directLaunchAllowed }) => directLaunchAllowed).map(({ id }) => id))
        .toEqual(expect.arrayContaining(['build', 'plan', 'test-primary']));
      expect(result.descriptors.filter(({ hidden }) => hidden).map(({ id }) => id))
        .toEqual(expect.arrayContaining(['compaction', 'summary', 'title']));
    }
  }, 30_000);
});
