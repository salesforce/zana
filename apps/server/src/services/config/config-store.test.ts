import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
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

  it('defaults composer launch surfaces on and refuses a both-off pair', () => {
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
      composerShowCliAgent: false,
      composerShowModern: false,
      composerShowAutonomousTeam: false
    }));
    expect(config.getConfig()).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: false
    });

    config.setConfig({ composerShowCliAgent: false, composerShowModern: false });
    expect(JSON.parse(readFileSync(configFile, 'utf8')) as AppConfig).toMatchObject({
      composerShowCliAgent: true,
      composerShowModern: false
    });
  });
});
