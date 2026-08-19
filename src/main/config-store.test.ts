import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../shared/types.js';
import { createConfigStore } from './config-store.js';

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
});
