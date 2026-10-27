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
  planAutomatedClaudeLaunch,
  removeAutomatedConfigDir,
  sweepStaleAutomatedConfigDirs
} from '../automated-isolation.js';
import { createAutomatedConfigDir } from '../../../../../../plugins/provider-claude-code/src/bridge/automated-config-dir.js';

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

    it('falls back to a null plan and removes the leaf for an OAuth-only home', () => {
      writeFileSync(join(sourceDir, 'settings.json'), JSON.stringify({ hooks: { a: 1 }, env: { OTEL_X: '1' } }));
      writeFileSync(join(sourceDir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }));
      expect(planAutomatedClaudeLaunch({ ownerId: 'oauth', env: {}, dataDir, sourceConfigDir: sourceDir })).toBeNull();
      expect(existsSync(join(dataDir, 'claude-automated-config', 'oauth'))).toBe(false);
    });

    it('falls back to a null plan when the real settings are missing and no env auth is set', () => {
      expect(planAutomatedClaudeLaunch({ ownerId: 's1', env: {}, dataDir, sourceConfigDir: sourceDir })).toBeNull();
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
      planAutomatedClaudeLaunch({ ownerId: 's1', env: {}, dataDir, sourceConfigDir: missing });
      expect(existsSync(missing)).toBe(false);
    });

    it('falls back to a null plan (launch unchanged) for a hostile owner id', () => {
      expect(planAutomatedClaudeLaunch({ ownerId: '..', env: {}, dataDir, sourceConfigDir: sourceDir })).toBeNull();
      expect(planAutomatedClaudeLaunch({ ownerId: '', env: {}, dataDir, sourceConfigDir: sourceDir })).toBeNull();
    });

    it('sanitizes path separators in the owner id', () => {
      const plan = planAutomatedClaudeLaunch({ ownerId: '../../x', env: authEnv, dataDir, sourceConfigDir: sourceDir })!;
      expect(plan.configDir.startsWith(join(dataDir, 'claude-automated-config'))).toBe(true);
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
        env: { ANTHROPIC_BASE_URL: 'u', AWS_REGION: 'r', OTEL_X: '1', NODE_EXTRA_CA_CERTS: '/ca' }
      })
    );
    const plan = planAutomatedClaudeLaunch({ ownerId: 's1', env: authEnv, dataDir, sourceConfigDir: sourceDir })!;
    const bridgeData = mkdtempSync(join(tmpdir(), 'zcc-iso-bridge-'));
    try {
      const bridgeLeaf = createAutomatedConfigDir(bridgeData, 's1', { sourceConfigDir: sourceDir });
      for (const file of ['settings.json', '.claude.json']) {
        expect(readFileSync(join(plan.configDir, file), 'utf8')).toBe(readFileSync(join(bridgeLeaf, file), 'utf8'));
      }
    } finally {
      rmSync(bridgeData, { recursive: true, force: true });
    }
  });
});
