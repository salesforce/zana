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
      executionPlanStartupGraceMs: 300_000,
      // Denylist ships empty = OFF: a fresh orchestrator sees every MCP server.
      orchestratorMcpServerDenylist: []
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
          opencode: { modelTargetId: 'aisuite/old' },
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
          opencode: { modelTargetId: 'llmgw/old' },
          claude: { modelTargetId: 'keep-claude' }
        }
      }
    };
    expect(config.replaceConfig(next, first.hash)).toMatchObject({
      theme: 'light',
      defaultHarness: 'claude',
      harnessRouting: { byAdapter: { opencode: { modelTargetId: 'llmgw/old' } } }
    });
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      theme: 'light',
      defaultHarness: 'claude',
      harnessRouting: {
        byAdapter: {
          opencode: { modelTargetId: 'llmgw/old' },
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
