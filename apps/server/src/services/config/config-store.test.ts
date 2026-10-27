import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPOSER_LAUNCH_SURFACES_REV, type AppConfig } from '@zana-ai/zcc-domain/product';
import { createConfigStore } from '@zana-ai/zcc-server';

describe('createConfigStore', () => {
  it('owns config persistence without Electron and preserves optional resets', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-config-store-'));
    const configFile = join(homeDir, '.zcc', 'config.json');
    const config = createConfigStore(
      { homeDir, configFile },
      {
        normalizeConfig: (input) => input,
        projectConfigCompatibility: (input) => input,
        canonicalConfigForWrite: (input) => input,
        harnessEnabled: (_input, id) => id === 'claude'
      }
    );

    expect(config.getConfig()).toMatchObject({
      version: 1,
      theme: 'dark',
      shell: process.env.SHELL || '/bin/zsh',
      autoModeEnabled: true,
      tmuxScope: 'all'
    });

    config.setConfig({ defaultHarness: 'claude', defaultExecutionState: 'plan' });
    expect(config.setConfig({ defaultExecutionState: undefined })).not.toHaveProperty('defaultExecutionState');
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      version: 1,
      defaultHarness: 'claude'
    });
  });

  it('defaults claim-recovery enforcement on and a 5-minute plan startup grace', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-config-store-durable-'));
    const configFile = join(homeDir, '.zcc', 'config.json');
    const config = createConfigStore(
      { homeDir, configFile },
      {
        normalizeConfig: (input) => input,
        projectConfigCompatibility: (input) => input,
        canonicalConfigForWrite: (input) => input,
        harnessEnabled: (_input, id) => id === 'claude'
      }
    );

    // Enforce-by-default is deliberate for this branch: durable claim fencing is
    // active on fresh installs, and a planless durable run is guarded after 5 min.
    expect(config.getConfig()).toMatchObject({
      executionClaimRecoveryEnforceEnabled: true,
      executionPlanStartupGraceMs: 300_000
    });
  });

  it('defaults composer launch surfaces on and migrates leftover CLI-only once', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-config-store-surfaces-'));
    const configFile = join(homeDir, '.zcc', 'config.json');
    const config = createConfigStore(
      { homeDir, configFile },
      {
        normalizeConfig: (input) => input,
        projectConfigCompatibility: (input) => input,
        canonicalConfigForWrite: (input) => input,
        harnessEnabled: (_input, id) => id === 'claude'
      }
    );

    expect(config.getConfig()).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: true,
      composerShowAutonomousTeam: true,
      teamJobLaunchEnabled: true
    });

    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      composerShowCliAgent: true,
      composerShowModern: false,
      composerShowAutonomousTeam: false,
      teamJobLaunchEnabled: false
    }));
    expect(config.getConfig()).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: true,
      composerShowAutonomousTeam: true,
      teamJobLaunchEnabled: true,
      composerLaunchSurfacesRev: COMPOSER_LAUNCH_SURFACES_REV
    });
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: true,
      composerShowAutonomousTeam: true,
      teamJobLaunchEnabled: true,
      composerLaunchSurfacesRev: COMPOSER_LAUNCH_SURFACES_REV
    });

    config.setConfig({ composerShowModern: false });
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: false,
      composerLaunchSurfacesRev: COMPOSER_LAUNCH_SURFACES_REV
    });

    config.setConfig({
      composerShowCliAgent: true,
      composerShowModern: false,
      composerShowAutonomousTeam: false,
      teamJobLaunchEnabled: false
    });
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: false,
      composerShowAutonomousTeam: false,
      teamJobLaunchEnabled: false,
      composerLaunchSurfacesRev: COMPOSER_LAUNCH_SURFACES_REV
    });

    config.setConfig({ composerShowCliAgent: false, composerShowModern: false });
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: true,
      composerShowAutonomousTeam: true,
      teamJobLaunchEnabled: true,
      composerLaunchSurfacesRev: COMPOSER_LAUNCH_SURFACES_REV
    });
  });

  it('exposes snapshot/replaceConfig CAS without overwriting unrelated fields', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-config-store-cas-'));
    const configFile = join(homeDir, '.zcc', 'config.json');
    const config = createConfigStore(
      { homeDir, configFile },
      {
        normalizeConfig: (input) => input,
        projectConfigCompatibility: (input) => input,
        canonicalConfigForWrite: (input) => input,
        harnessEnabled: (_input, id) => id === 'claude'
      }
    );

    config.setConfig({
      defaultHarness: 'claude',
      theme: 'light',
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: { modelTargetId: 'legacy-provider/old' },
          claude: { modelTargetId: 'keep-claude' }
        }
      }
    });
    const first = config.snapshot();
    expect(first.hash).toEqual(expect.any(String));

    const next = {
      ...first.config,
      harnessRouting: {
        schemaVersion: 1 as const,
        byAdapter: {
          opencode: { modelTargetId: 'fixture-provider/old' },
          claude: { modelTargetId: 'keep-claude' }
        }
      }
    };
    expect(config.replaceConfig(next, first.hash)).toMatchObject({
      theme: 'light',
      defaultHarness: 'claude',
      harnessRouting: { byAdapter: { opencode: { modelTargetId: 'fixture-provider/old' } } }
    });
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      theme: 'light',
      defaultHarness: 'claude',
      harnessRouting: {
        byAdapter: {
          opencode: { modelTargetId: 'fixture-provider/old' },
          claude: { modelTargetId: 'keep-claude' }
        }
      }
    });
  });

  it('rejects replaceConfig when the on-disk hash no longer matches', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-config-store-cas-stale-'));
    const configFile = join(homeDir, '.zcc', 'config.json');
    const config = createConfigStore(
      { homeDir, configFile },
      {
        normalizeConfig: (input) => input,
        projectConfigCompatibility: (input) => input,
        canonicalConfigForWrite: (input) => input,
        harnessEnabled: (_input, id) => id === 'claude'
      }
    );

    config.setConfig({ theme: 'light' });
    const stale = config.snapshot();
    config.setConfig({ fontSize: 18 });
    expect(() => config.replaceConfig({ ...stale.config, theme: 'dark' }, stale.hash)).toThrow(
      /Durable write rejected: file changed outside serialized transaction/
    );
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      theme: 'light',
      fontSize: 18
    });
  });
});

describe('createConfigStore plugin harness routing', () => {
  const routing = (model: string) => ({ schemaVersion: 1 as const, byAdapter: { codex: { modelTargetId: model } } });
  // Mirror main's normalizer: unknown keys are dropped.
  const make = () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-config-store-plugin-'));
    const configFile = join(homeDir, '.zcc', 'config.json');
    const dropUnknown = (input: Partial<AppConfig>) => {
      const { pluginHarnessRouting: _drop, ...rest } = input as Partial<AppConfig> & { pluginHarnessRouting?: unknown };
      return rest as Partial<AppConfig>;
    };
    const store = createConfigStore(
      { homeDir, configFile },
      {
        normalizeConfig: dropUnknown,
        projectConfigCompatibility: (input) => input,
        canonicalConfigForWrite: (input) => dropUnknown(input) as AppConfig,
        harnessEnabled: () => true
      }
    );
    return { store, configFile, raw: () => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown> };
  };

  it('stores per plugin, survives Core writes, and clears', () => {
    const { store, raw } = make();
    expect(store.getPluginHarnessRouting('a')).toBeNull();
    store.setPluginHarnessRouting('a', routing('gpt-5.4'));
    store.setPluginHarnessRouting('b', routing('gpt-5.4-mini'));
    store.setConfig({ theme: 'light' });
    const snap = store.snapshot();
    store.replaceConfig({ ...snap.config, fontSize: 15 }, snap.hash);
    expect(store.getConfig()).not.toHaveProperty('pluginHarnessRouting');
    expect(raw()).toMatchObject({ theme: 'light', fontSize: 15 });
    expect(store.getPluginHarnessRouting('a')).toEqual(routing('gpt-5.4'));
    expect(store.getPluginHarnessRouting('b')).toEqual(routing('gpt-5.4-mini'));
    store.setPluginHarnessRouting('a', null);
    store.setPluginHarnessRouting('b', null);
    expect(raw()).not.toHaveProperty('pluginHarnessRouting');
    expect(raw()).toMatchObject({ theme: 'light' });
  });

  it('keeps plugin overrides through the composer-surface heal write', () => {
    const { store, configFile, raw } = make();
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(configFile, JSON.stringify({
      version: 1, composerShowCliAgent: false, composerShowModern: false,
      pluginHarnessRouting: {
        a: routing('gpt-5.4'),
        junk: { schemaVersion: 2 },
        // A well-shaped entry with an invalid field is dropped too, not only bad schema versions.
        badHarness: { schemaVersion: 1, byAdapter: {}, defaultHarness: 'not-a-harness' }
      }
    }));
    expect(store.getConfig().composerShowModern).toBe(true);
    expect(raw().pluginHarnessRouting).toEqual({ a: routing('gpt-5.4') });
  });

  it('gives up after retrying a file it cannot read, leaving the file as it was', () => {
    const { store, configFile } = make();
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(configFile, '{not json');
    expect(() => store.setPluginHarnessRouting('a', routing('x'))).toThrow(/Durable write rejected/);
    expect(readFileSync(configFile, 'utf8')).toBe('{not json');
  });

  it('rethrows a write failure that is not a conflict without retrying', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-config-store-plugin-'));
    const notADirectory = join(homeDir, 'file');
    writeFileSync(notADirectory, '');
    const store = createConfigStore(
      { homeDir, configFile: join(notADirectory, 'config.json') },
      { normalizeConfig: (input) => input, projectConfigCompatibility: (input) => input, canonicalConfigForWrite: (input) => input as AppConfig, harnessEnabled: () => true }
    );
    expect(() => store.setPluginHarnessRouting('a', routing('x'))).toThrow(/ENOTDIR|EEXIST/);
  });

  it('rejects a non-object config file instead of overwriting it', () => {
    const { store, configFile } = make();
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(configFile, '[1]');
    expect(() => store.setPluginHarnessRouting('a', routing('x'))).toThrow('config file is not a JSON object');
    expect(readFileSync(configFile, 'utf8')).toBe('[1]');
  });
});
