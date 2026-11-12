import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSeedSettings,
  AutomatedClaudeAdmissionError,
  planAutomatedClaudeLaunch,
  requiredMcpUnavailableMessage,
  removeAutomatedConfigDir,
  sanitizeMcpServers,
  filterMcpServersByAllowlist,
  isReservedMcpName,
  sweepStaleAutomatedConfigDirs
} from '../automated-isolation.js';
import { mcpAllowlistCovers } from '@zana-ai/zcc-domain/product';
import {
  createAutomatedConfigDir,
  createAutomatedConfigDirWithWarnings,
  filterMcpServersByAllowlist as bridgeFilter,
  userMcpAllowlistCovers,
  sanitizeMcpServers as bridgeSanitizeMcpServers,
  isReservedMcpName as bridgeIsReservedMcpName
} from '../../../../../../plugins/provider-claude-code/src/bridge/automated-config-dir.js';

describe('automated claude isolation', () => {
  // Isolation only applies when the isolated dir can authenticate.
  const authEnv = { ANTHROPIC_API_KEY: 'test-key' };
  let dataDir: string;
  let sourceDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-iso-data-'));
    sourceDir = mkdtempSync(join(tmpdir(), 'zcc-iso-src-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  });

  describe('plan', () => {
    it('creates a 0700 seeded dir and returns argv + env', () => {
      writeFileSync(join(sourceDir, 'settings.json'), JSON.stringify({ apiKeyHelper: 'h', hooks: { a: 1 } }));
      const plan = planAutomatedClaudeLaunch({ ownerId: 's1', env: {}, dataDir, sourceConfigDir: sourceDir })!;
      expect(plan.args).toEqual(['--setting-sources', 'user']);
      expect(plan.env).toEqual({ CLAUDE_CONFIG_DIR: plan.configDir });
      expect(statSync(plan.configDir).mode & 0o777).toBe(0o700);
      expect(JSON.parse(readFileSync(join(plan.configDir, 'settings.json'), 'utf8'))).toEqual({ apiKeyHelper: 'h' });
      expect(statSync(join(plan.configDir, 'settings.json')).mode & 0o777).toBe(0o600);
      expect(lstatSync(join(plan.configDir, 'projects')).isSymbolicLink()).toBe(true);
    });

    it('blocks an OAuth-only home and removes the leaf', () => {
      writeFileSync(join(sourceDir, 'settings.json'), JSON.stringify({ hooks: { a: 1 }, env: { OTEL_X: '1' } }));
      writeFileSync(join(sourceDir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }));
      expect(() => planAutomatedClaudeLaunch({ ownerId: 'oauth', env: {}, dataDir, sourceConfigDir: sourceDir }))
        .toThrow(/authentication-unavailable/);
      expect(existsSync(join(dataDir, 'claude-automated-config', 'oauth'))).toBe(false);
    });

    it('blocks when the real settings are missing and no env auth is set', () => {
      expect(() => planAutomatedClaudeLaunch({ ownerId: 's1', env: {}, dataDir, sourceConfigDir: sourceDir }))
        .toThrow(/authentication-unavailable/);
    });

    it.each([
      ['apiKeyHelper', { apiKeyHelper: 'h' }],
      ['awsAuthRefresh', { awsAuthRefresh: 'r' }],
      ['seeded ANTHROPIC_AUTH_TOKEN', { env: { ANTHROPIC_AUTH_TOKEN: 't' } }],
      ['seeded CLAUDE_CODE_USE_BEDROCK', { env: { CLAUDE_CODE_USE_BEDROCK: '1' } }]
    ])('keeps isolation when settings carry %s', (_label, settings) => {
      writeFileSync(join(sourceDir, 'settings.json'), JSON.stringify(settings));
      expect(planAutomatedClaudeLaunch({ ownerId: 'a', env: {}, dataDir, sourceConfigDir: sourceDir })).not.toBeNull();
    });

    it('still isolates (no settings) when the real settings are missing but env auth exists', () => {
      const plan = planAutomatedClaudeLaunch({ ownerId: 's1', env: authEnv, dataDir, sourceConfigDir: sourceDir })!;
      expect(existsSync(join(plan.configDir, 'settings.json'))).toBe(false);
    });

    it('does not conjure a missing Claude home', () => {
      const missing = join(sourceDir, 'nope');
      expect(() => planAutomatedClaudeLaunch({ ownerId: 's1', env: {}, dataDir, sourceConfigDir: missing }))
        .toThrow(/authentication-unavailable/);
      expect(existsSync(missing)).toBe(false);
    });

    it('blocks with config-unavailable for a hostile owner id', () => {
      expect(() => planAutomatedClaudeLaunch({ ownerId: '..', env: {}, dataDir, sourceConfigDir: sourceDir }))
        .toThrow(/config-unavailable/);
      expect(() => planAutomatedClaudeLaunch({ ownerId: '', env: {}, dataDir, sourceConfigDir: sourceDir }))
        .toThrow(/config-unavailable/);
    });

    it('preserves the preparation failure as the config admission cause', () => {
      const blocker = join(dataDir, 'not-a-directory');
      writeFileSync(blocker, 'x');
      let thrown: unknown;
      try {
        planAutomatedClaudeLaunch({ ownerId: 'blocked', env: {}, dataDir: blocker, sourceConfigDir: sourceDir });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ message: expect.stringMatching(/config-unavailable/), cause: expect.any(Error) });
    });

    it('sanitizes path separators in the owner id', () => {
      const plan = planAutomatedClaudeLaunch({ ownerId: '../../x', env: authEnv, dataDir, sourceConfigDir: sourceDir })!;
      expect(plan.configDir.startsWith(join(dataDir, 'claude-automated-config'))).toBe(true);
    });
  });

  describe('required MCP servers', () => {
    const plan = (requiredMcps?: string[], ownerId = 'req') =>
      planAutomatedClaudeLaunch({ ownerId, env: authEnv, dataDir, sourceConfigDir: sourceDir, ...(requiredMcps ? { requiredMcps } : {}) });
    beforeEach(() => {
      writeFileSync(
        join(sourceDir, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            slack: { command: 'npx', args: ['slack-mcp'] },
            secretive: { command: 'npx', args: ['x', '--api-key=abc'] },
            oauthy: { type: 'http', url: 'https://example.com/mcp?token=abc' },
            assigned: { command: 'x', args: ['API_KEY=abc'] },
            jsonarg: { command: 'x', args: ['{"token":"abc"}'] },
            withenv: { command: 'npx', args: ['y'], env: { SLACK_TOKEN: 'abc' } },
            emptyenv: { command: 'npx', args: ['z'], env: {} }
          }
        })
      );
    });

    it('launches when every required server is carried', () => {
      const result = plan(['slack']);
      expect(JSON.parse(readFileSync(join(result.configDir, '.claude.json'), 'utf8')).mcpServers).toHaveProperty('slack');
    });

    it('drops credential assignments and JSON args', () => {
      expect(() => plan(['assigned'], 'a1')).toThrow(/not available/);
      expect(() => plan(['jsonarg'], 'a2')).toThrow(/not available/);
    });

    it('treats a server whose env was stripped as unavailable, but not one with empty env', () => {
      expect(() => plan(['withenv'], 'e1')).toThrow(/Required MCP server not available in the isolated config: withenv\./);
      expect(() => plan(['emptyenv'], 'e2')).not.toThrow();
    });

    it('is a no-op when undeclared or empty', () => {
      expect(() => plan()).not.toThrow();
      expect(() => plan([], 'empty')).not.toThrow();
    });

    it('refuses, naming every missing server, and removes the leaf', () => {
      let error: unknown;
      try { plan(['slack', 'secretive', 'oauthy', 'absent']); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(AutomatedClaudeAdmissionError);
      const admission = error as AutomatedClaudeAdmissionError;
      expect(admission.reason).toBe('required-mcp-unavailable');
      expect(admission.missing).toEqual(['secretive', 'oauthy', 'absent']);
      expect(admission.preSpawn).toBe(true);
      expect(admission.message).toBe(requiredMcpUnavailableMessage(['secretive', 'oauthy', 'absent']));
      expect(admission.message).toContain('Required MCP servers not available');
      expect(admission.message).toContain('Use my Claude config');
      expect(existsSync(join(dataDir, 'claude-automated-config', 'req'))).toBe(false);
    });

    it('uses the singular form for one missing server and refuses when no config exists', () => {
      rmSync(join(sourceDir, '.claude.json'));
      expect(() => plan(['slack'], 'none')).toThrow(/Required MCP server not available in the isolated config: slack\./);
    });

    it('other admission errors are not pre-spawn', () => {
      expect(new AutomatedClaudeAdmissionError('authentication-unavailable').preSpawn).toBe(false);
    });
  });

  describe('workspace trust', () => {
    const plan = (cwd: string) =>
      planAutomatedClaudeLaunch({
        ownerId: 't1',
        env: { ...authEnv, CLAUDE_CONFIG_DIR: sourceDir },
        dataDir,
        sourceConfigDir: sourceDir,
        cwd
      })!;
    const seededProjects = (configDir: string) =>
      JSON.parse(readFileSync(join(configDir, '.claude.json'), 'utf8')).projects;

    beforeEach(() => {
      writeFileSync(join(sourceDir, 'settings.json'), JSON.stringify({ apiKeyHelper: 'h' }));
    });

    it('carries over trust the user already accepted for the cwd', () => {
      writeFileSync(
        join(sourceDir, '.claude.json'),
        JSON.stringify({ projects: { '/work/app': { hasTrustDialogAccepted: true, allowedTools: ['x'] } } })
      );
      expect(seededProjects(plan('/work/app').configDir)).toEqual({ '/work/app': { hasTrustDialogAccepted: true } });
    });

    it('carries over trust accepted for an ancestor of the cwd', () => {
      writeFileSync(
        join(sourceDir, '.claude.json'),
        JSON.stringify({ projects: { '/work': { hasTrustDialogAccepted: true } } })
      );
      expect(seededProjects(plan('/work/app/sub').configDir)).toEqual({
        '/work/app/sub': { hasTrustDialogAccepted: true }
      });
    });

    it.each([
      ['an untrusted project', { projects: { '/work/app': { hasTrustDialogAccepted: false } } }],
      ['a different project', { projects: { '/other': { hasTrustDialogAccepted: true } } }],
      ['no projects map', {}],
      ['a non-object projects map', { projects: 'x' }]
    ])('never grants trust for %s', (_label, source) => {
      writeFileSync(join(sourceDir, '.claude.json'), JSON.stringify(source));
      expect(seededProjects(plan('/work/app').configDir)).toBeUndefined();
    });

    it('seeds no trust when the real .claude.json is missing or unreadable', () => {
      expect(seededProjects(plan('/work/app').configDir)).toBeUndefined();
      writeFileSync(join(sourceDir, '.claude.json'), '{not json');
      rmSync(join(dataDir, 'claude-automated-config'), { recursive: true, force: true });
      expect(seededProjects(plan('/work/app').configDir)).toBeUndefined();
    });

    it('seeds no trust when no cwd is given', () => {
      writeFileSync(
        join(sourceDir, '.claude.json'),
        JSON.stringify({ projects: { '/work/app': { hasTrustDialogAccepted: true } } })
      );
      const p = planAutomatedClaudeLaunch({ ownerId: 't2', env: { ...authEnv, CLAUDE_CONFIG_DIR: sourceDir }, dataDir, sourceConfigDir: sourceDir })!;
      expect(seededProjects(p.configDir)).toBeUndefined();
    });
  });

  describe('remove and sweep', () => {
    it('removes the leaf without following the projects symlink', () => {
      mkdirSync(join(sourceDir, 'projects'), { recursive: true });
      writeFileSync(join(sourceDir, 'projects', 'keep.jsonl'), 'x');
      const plan = planAutomatedClaudeLaunch({ ownerId: 's1', env: authEnv, dataDir, sourceConfigDir: sourceDir })!;
      removeAutomatedConfigDir(dataDir, plan.configDir);
      expect(existsSync(plan.configDir)).toBe(false);
      expect(existsSync(join(sourceDir, 'projects', 'keep.jsonl'))).toBe(true);
    });

    it('refuses to remove a path outside the parent', () => {
      expect(() => removeAutomatedConfigDir(dataDir, dataDir)).toThrow(/escapes/);
    });

    it('sweeps expired unowned leaves, keeping live and fresh ones', () => {
      const old = planAutomatedClaudeLaunch({ ownerId: 'old', env: authEnv, dataDir, sourceConfigDir: sourceDir })!;
      const live = planAutomatedClaudeLaunch({ ownerId: 'live', env: authEnv, dataDir, sourceConfigDir: sourceDir })!;
      const fresh = planAutomatedClaudeLaunch({ ownerId: 'fresh', env: authEnv, dataDir, sourceConfigDir: sourceDir })!;
      const past = new Date(Date.now() - 10_000);
      utimesSync(old.configDir, past, past);
      utimesSync(live.configDir, past, past);
      const removed = sweepStaleAutomatedConfigDirs({ dataDir, liveOwnerIds: new Set(['live']), ttlMs: 5_000 });
      expect(removed).toEqual(['old']);
      expect(existsSync(live.configDir)).toBe(true);
      expect(existsSync(fresh.configDir)).toBe(true);
    });

    it('is a no-op when the parent does not exist', () => {
      expect(sweepStaleAutomatedConfigDirs({ dataDir, liveOwnerIds: new Set() })).toEqual([]);
    });
  });

  describe('seed contents', () => {
    it.each([null, 'str', 5, [], {}, { env: 'x' }, { env: { OTEL_X: '1' } }, { hooks: {} }])(
      'yields no seed for %j',
      (source) => {
        expect(buildSeedSettings(source)).toBeNull();
      }
    );

    it.each([[true, { skipDangerousModePermissionPrompt: true }], [false, null], ['true', null]])(
      'carries skipDangerousModePermissionPrompt only when literally true (%j)',
      (value, expected) => {
        expect(buildSeedSettings({ skipDangerousModePermissionPrompt: value })).toEqual(expected);
      }
    );

    it('sanitizes MCP servers identically to the provider bridge', () => {
      const raw = {
        a: { type: 'stdio', command: 'c', args: ['-y', 'pkg'], env: { K: 'v' }, extra: 1 },
        b: { url: 'https://h.example/mcp?region=eu', headers: { X: 'y' } },
        c: { command: 'c', args: ['--api-key', 'v'] },
        d: { command: 'c', args: ['Bearer v'] },
        e: { url: 'https://h.example/mcp?token=v' },
        f: { url: 'nope' },
        g: { type: 1, command: 'c' },
        h: { command: 'c', args: [1] },
        i: { type: 'stdio' },
        j: 'x',
        '': { command: 'c' }
      };
      expect(sanitizeMcpServers(raw)).toEqual(bridgeSanitizeMcpServers(raw));
      expect(sanitizeMcpServers(raw)).toEqual({
        a: { type: 'stdio', command: 'c', args: ['-y', 'pkg'] },
        b: { url: 'https://h.example/mcp?region=eu' }
      });
      expect(sanitizeMcpServers([])).toBeNull();
      expect(Object.keys(sanitizeMcpServers(Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`s${i}`, { command: 'c' }])))!)).toHaveLength(64);
      expect(sanitizeMcpServers({ a: { command: 'c', args: Array.from({ length: 200 }, () => 'a') } })).toBeNull();
    });

    describe('reserved plugin:/ext: names (AC-14)', () => {
      const raw = {
        'plugin:x:y': { command: 'spoof' },
        'ext:x:y': { command: 'spoof' },
        'plugin:': { command: 'spoof' },
        plugin: { command: 'ok1' },
        'my-plugin:x': { command: 'ok2' },
        'Plugin:x:y': { command: 'ok3' },
        extension: { command: 'ok4' }
      };

      it('drops them in both seed copies with identical results (parity)', () => {
        const host = sanitizeMcpServers(raw);
        expect(host).toEqual(bridgeSanitizeMcpServers(raw));
        expect(Object.keys(host!).sort()).toEqual(['Plugin:x:y', 'extension', 'my-plugin:x', 'plugin']);
        for (const name of ['plugin:x:y', 'ext:x:y', 'plugin:', 'ext:a', 'plugin', 'a', '', 'Ext:a']) {
          expect(isReservedMcpName(name)).toBe(bridgeIsReservedMcpName(name));
        }
        expect(isReservedMcpName('plugin:x:y')).toBe(true);
        expect(isReservedMcpName('plugin')).toBe(false);
      });

      it('returns null when only reserved names are present', () => {
        expect(sanitizeMcpServers({ 'plugin:a:b': { command: 'c' } })).toBeNull();
        expect(bridgeSanitizeMcpServers({ 'ext:a:b': { command: 'c' } })).toBeNull();
      });

      it('collision precedence: a spoofed user key never reaches the leaf, so registry keys win', () => {
        writeFileSync(
          join(sourceDir, '.claude.json'),
          JSON.stringify({ mcpServers: { 'plugin:p:srv': { command: 'spoof' }, 'ext:e:srv': { command: 'spoof' }, mine: { command: 'c' } } })
        );
        const p = planAutomatedClaudeLaunch({ ownerId: 'collide', env: authEnv, dataDir, sourceConfigDir: sourceDir });
        const seeded = JSON.parse(readFileSync(join(p.configDir, '.claude.json'), 'utf8'));
        expect(seeded.mcpServers).toEqual({ mine: { command: 'c' } });
        // A required reserved name is unavailable: it cannot be satisfied by a user-scope spoof.
        expect(() =>
          planAutomatedClaudeLaunch({ ownerId: 'collide2', env: authEnv, dataDir, sourceConfigDir: sourceDir, requiredMcps: ['plugin:p:srv'] })
        ).toThrow(/Required MCP server not available.*plugin:p:srv/);
      });
    });

    it('seeds MCP servers and trust together even without settings, never authenticating', () => {
      writeFileSync(
        join(sourceDir, '.claude.json'),
        JSON.stringify({ mcpServers: { a: { command: 'c' } }, projects: { '/w': { hasTrustDialogAccepted: true } } })
      );
      const p = planAutomatedClaudeLaunch({ ownerId: 'm', env: authEnv, dataDir, sourceConfigDir: sourceDir, cwd: '/w' });
      expect(JSON.parse(readFileSync(join(p.configDir, '.claude.json'), 'utf8'))).toEqual({
        hasCompletedOnboarding: true,
        mcpServers: { a: { command: 'c' } },
        projects: { '/w': { hasTrustDialogAccepted: true } }
      });
      expect(JSON.parse(readFileSync(join(p.configDir, 'settings.json'), 'utf8'))).toEqual({});
      expect(statSync(join(p.configDir, '.claude.json')).mode & 0o777).toBe(0o600);
      expect(() => planAutomatedClaudeLaunch({ ownerId: 'n', env: {}, dataDir, sourceConfigDir: sourceDir }))
        .toThrow(/authentication-unavailable/);
    });

    it('ignores an oversized global config', () => {
      writeFileSync(join(sourceDir, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'c' } }, pad: 'x'.repeat(16 * 1024 * 1024) }));
      const p = planAutomatedClaudeLaunch({ ownerId: 'o', env: authEnv, dataDir, sourceConfigDir: sourceDir });
      expect(existsSync(join(p.configDir, '.claude.json'))).toBe(false);
    });

    it('keeps only string auth keys and allowlisted env', () => {
      expect(
        buildSeedSettings({
          apiKeyHelper: 5,
          awsAuthRefresh: 'refresh',
          env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_N: 3, CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_OTHER: 'x', HTTPS_PROXY: 'p' }
        })
      ).toEqual({
        awsAuthRefresh: 'refresh',
        env: { ANTHROPIC_BASE_URL: 'u', CLAUDE_CODE_USE_BEDROCK: '1', HTTPS_PROXY: 'p' }
      });
    });
  });

  // The bridge (SDK threads) and this module (PTY CLI) must seed identically.
  it('seeds byte-identically to the provider bridge', () => {
    writeFileSync(
      join(sourceDir, 'settings.json'),
      JSON.stringify({
        apiKeyHelper: 'h',
        forceLoginMethod: 'console',
        hooks: { a: 1 },
        skipDangerousModePermissionPrompt: true,
        env: { ANTHROPIC_BASE_URL: 'u', AWS_REGION: 'r', OTEL_X: '1', NODE_EXTRA_CA_CERTS: '/ca' }
      })
    );
    writeFileSync(
      join(sourceDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          fs: { type: 'stdio', command: 'npx', args: ['-y', 'fs'], env: { T: 'secret' } },
          web: { type: 'http', url: 'https://mcp.example/mcp', headers: { Authorization: 'secret' } },
          leaky: { command: 'x', args: ['--token=secret'] },
          bad: { url: 'https://u:p@h.example' }
        }
      })
    );
    const env = { ...authEnv, CLAUDE_CONFIG_DIR: sourceDir };
    const plan = planAutomatedClaudeLaunch({ ownerId: 's1', env, dataDir, sourceConfigDir: sourceDir })!;
    const bridgeData = mkdtempSync(join(tmpdir(), 'zcc-iso-bridge-'));
    try {
      const bridgeLeaf = createAutomatedConfigDir(bridgeData, 's1', { sourceConfigDir: sourceDir, env });
      expect(JSON.parse(readFileSync(join(plan.configDir, '.claude.json'), 'utf8')).mcpServers).toEqual({
        fs: { type: 'stdio', command: 'npx', args: ['-y', 'fs'] },
        web: { type: 'http', url: 'https://mcp.example/mcp' }
      });
      for (const file of ['settings.json', '.claude.json']) {
        expect(readFileSync(join(plan.configDir, file), 'utf8')).toBe(readFileSync(join(bridgeLeaf, file), 'utf8'));
      }
    } finally {
      rmSync(bridgeData, { recursive: true, force: true });
    }
  });

  describe('persona MCP allowlist (AC-13/15, D10, D12)', () => {
    const CRED_FIELDS = ['env', 'headers', 'headersHelper', 'oauth', 'auth', 'authorization'];
    const servers = {
      alpha: { command: 'a' },
      beta: { command: 'b' },
      'zcc-inbox': { command: 'z' },
      leaky: { command: 'x', args: ['--token=secret'] },
      cred: {
        type: 'http',
        url: 'https://c.example/mcp',
        env: { T: 'SECRET_ENV' },
        headers: { Authorization: 'SECRET_HDR' },
        oauth: { clientId: 'SECRET_OAUTH' },
        auth: { token: 'SECRET_AUTH' }
      }
    };
    beforeEach(() => {
      writeFileSync(join(sourceDir, 'settings.json'), JSON.stringify({ apiKeyHelper: 'h' }));
      writeFileSync(join(sourceDir, '.claude.json'), JSON.stringify({ mcpServers: servers }));
    });
    const env = () => ({ ...authEnv, CLAUDE_CONFIG_DIR: sourceDir });
    const hostPlan = (mcpAllowlist?: string[], extra: Record<string, unknown> = {}) =>
      planAutomatedClaudeLaunch({
        ownerId: 'al',
        env: env(),
        dataDir,
        sourceConfigDir: sourceDir,
        ...(mcpAllowlist ? { mcpAllowlist } : {}),
        ...extra
      });
    const carried = (leaf: string) =>
      Object.keys(JSON.parse(readFileSync(join(leaf, '.claude.json'), 'utf8')).mcpServers ?? {}).sort();

    it('unrestricted (absent) leaves the seed byte-identical and emits no warnings', () => {
      const plan = hostPlan();
      expect(plan.warnings).toEqual([]);
      expect(carried(plan.configDir)).toEqual(['alpha', 'beta', 'cred', 'zcc-inbox']);
      const before = readFileSync(join(plan.configDir, '.claude.json'), 'utf8');
      removeAutomatedConfigDir(dataDir, plan.configDir);
      expect(readFileSync(join(hostPlan().configDir, '.claude.json'), 'utf8')).toBe(before);
    });

    it('list: carries only covered servers plus zcc-inbox', () => {
      const plan = hostPlan(['alpha']);
      expect(carried(plan.configDir)).toEqual(['alpha', 'zcc-inbox']);
      expect(plan.warnings).toEqual([]);
    });

    it('[]: carries zcc-inbox only', () => {
      const plan = hostPlan([]);
      expect(carried(plan.configDir)).toEqual(['zcc-inbox']);
      expect(plan.warnings).toEqual([]);
    });

    it('[] without a zcc-inbox user server still seeds settings and carries no servers', () => {
      writeFileSync(join(sourceDir, '.claude.json'), JSON.stringify({ mcpServers: { alpha: { command: 'a' } } }));
      const plan = hostPlan([]);
      expect(JSON.parse(readFileSync(join(plan.configDir, '.claude.json'), 'utf8'))).toEqual({ hasCompletedOnboarding: true });
    });

    it('registry-keyed entries do not carry user servers and are not warned', () => {
      const plan = hostPlan(['plugin:p:alpha', 'ext:e:alpha', 'zcc-inbox']);
      expect(carried(plan.configDir)).toEqual(['zcc-inbox']);
      expect(plan.warnings).toEqual([]);
    });

    it('warns (non-fatal) for a missing allowlisted server, naming it', () => {
      const plan = hostPlan(['alpha', 'ghost']);
      expect(plan.warnings).toEqual([
        expect.objectContaining({ code: 'allowlisted-mcp-not-carried', server: 'ghost', reason: 'not-found' })
      ]);
      expect(plan.warnings[0]!.message).toContain('"ghost"');
    });

    it('warns when the sanitizer rejected an allowlisted server', () => {
      const plan = hostPlan(['leaky']);
      expect(plan.warnings).toEqual([
        expect.objectContaining({ server: 'leaky', reason: 'unsafe-config', code: 'allowlisted-mcp-not-carried' })
      ]);
      expect(carried(plan.configDir)).toEqual(['zcc-inbox']);
    });

    it('externally provided entries and duplicates are not warned', () => {
      const plan = hostPlan(['ghost', 'ghost', 'other'], { externallyProvidedMcps: ['ghost', 'other'] });
      expect(plan.warnings).toEqual([]);
    });

    it('AC-15: credential-stripped allowlisted server warns by name and no credential field reaches the leaf', () => {
      const plan = hostPlan(['cred']);
      expect(plan.warnings).toEqual([
        expect.objectContaining({ code: 'allowlisted-mcp-credentials-stripped', server: 'cred', reason: 'credentials-stripped' })
      ]);
      expect(plan.warnings[0]!.message).not.toMatch(/SECRET/);
      const raw = readFileSync(join(plan.configDir, '.claude.json'), 'utf8');
      const entry = JSON.parse(raw).mcpServers.cred;
      expect(entry).toEqual({ type: 'http', url: 'https://c.example/mcp' });
      for (const field of CRED_FIELDS) expect(entry).not.toHaveProperty(field);
      expect(raw).not.toMatch(/SECRET/);
    });

    it('D10: a required server the allowlist excludes stays the hard admission error', () => {
      let error: unknown;
      try {
        hostPlan(['alpha'], { requiredMcps: ['beta'] });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(AutomatedClaudeAdmissionError);
      expect((error as AutomatedClaudeAdmissionError).reason).toBe('required-mcp-unavailable');
      expect((error as AutomatedClaudeAdmissionError).missing).toEqual(['beta']);
    });

    it('a required server that is allowlisted is admitted', () => {
      expect(() => hostPlan(['alpha'], { requiredMcps: ['alpha'] })).not.toThrow();
    });

    describe('bridge parity', () => {
      const bridgeLeaf = (allowlist?: string[]) => {
        const data = mkdtempSync(join(tmpdir(), 'zcc-iso-bridge-'));
        try {
          const out = createAutomatedConfigDirWithWarnings(data, 'al', {
            sourceConfigDir: sourceDir,
            env: env(),
            ...(allowlist ? { mcpAllowlist: allowlist } : {})
          });
          return {
            warnings: out.warnings,
            files: ['settings.json', '.claude.json'].map((f) => readFileSync(join(out.configDir, f), 'utf8'))
          };
        } finally {
          rmSync(data, { recursive: true, force: true });
        }
      };
      it.each([
        [undefined],
        [[]],
        [['alpha']],
        [['alpha', 'cred', 'ghost', 'leaky']],
        [['plugin:p:alpha', 'zcc-inbox']]
      ] as Array<[string[] | undefined]>)('seed files and warnings are identical for allowlist %j', (allowlist) => {
        const host = hostPlan(allowlist);
        const bridge = bridgeLeaf(allowlist);
        expect(bridge.warnings).toEqual(host.warnings);
        expect(bridge.files).toEqual(['settings.json', '.claude.json'].map((f) => readFileSync(join(host.configDir, f), 'utf8')));
        removeAutomatedConfigDir(dataDir, host.configDir);
      });

      it('AC-15: bridge copy warns by name and carries no credential field', () => {
        const bridge = bridgeLeaf(['cred']);
        expect(bridge.warnings).toEqual([
          expect.objectContaining({ code: 'allowlisted-mcp-credentials-stripped', server: 'cred' })
        ]);
        expect(bridge.files[1]).not.toMatch(/SECRET/);
        const entry = JSON.parse(bridge.files[1]!).mcpServers.cred;
        for (const field of CRED_FIELDS) expect(entry).not.toHaveProperty(field);
      });

      it('bridge matcher equals mcpAllowlistCovers for user servers; filters agree', () => {
        for (const entry of ['a', 'plugin:p:a', 'ext:e:a', 'b', '', 'a:tool', 'zcc-inbox']) {
          for (const name of ['a', 'b', 'plugin:p:a']) {
            expect(userMcpAllowlistCovers(entry, name)).toBe(mcpAllowlistCovers(entry, { key: name, source: 'user', name }));
          }
        }
        const sanitized = sanitizeMcpServers({ a: { command: 'c' }, b: { command: 'c' }, 'zcc-inbox': { command: 'z' } });
        expect(bridgeFilter(sanitized, ['a'])).toEqual(filterMcpServersByAllowlist(sanitized, ['a']));
        expect(filterMcpServersByAllowlist(null, ['a'])).toBeNull();
        expect(bridgeFilter(null, ['a'])).toBeNull();
        expect(bridgeFilter(sanitized, [])).toEqual({ 'zcc-inbox': { command: 'z' } });
      });

      it('bridge: no servers in config with an allowlist yields warnings and a none seed', () => {
        rmSync(join(sourceDir, '.claude.json'));
        rmSync(join(sourceDir, 'settings.json'));
        const bridge = (() => {
          const data = mkdtempSync(join(tmpdir(), 'zcc-iso-bridge-'));
          try {
            return createAutomatedConfigDirWithWarnings(data, 'n', {
              sourceConfigDir: sourceDir,
              env: env(),
              mcpAllowlist: ['ghost']
            }).warnings;
          } finally {
            rmSync(data, { recursive: true, force: true });
          }
        })();
        expect(bridge).toEqual([expect.objectContaining({ server: 'ghost', reason: 'not-found' })]);
      });
    });
  });
});
