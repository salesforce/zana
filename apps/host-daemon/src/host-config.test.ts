import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHostAppConfig } from './host-config.js';

describe('loadHostAppConfig', () => {
  it('returns the default claude binary when no config file exists', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-config-'));
    expect(loadHostAppConfig(dataDir).claudeBinary).toBe('claude');
  });

  it('reads claudeBinary from the host data dir', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-config-'));
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
      version: 1,
      claudeBinary: '/tmp/fake-claude',
      defaultHarness: 'claude'
    }));
    expect(loadHostAppConfig(dataDir)).toMatchObject({
      claudeBinary: '/tmp/fake-claude',
      defaultHarness: 'claude',
      version: 1
    });
  });

  it('honors ZCC_DATA_DIR when no dataDir argument is passed', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-config-env-'));
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
      claudeBinary: '/tmp/env-claude'
    }));
    expect(loadHostAppConfig(undefined, { ZCC_DATA_DIR: dataDir })).toMatchObject({
      claudeBinary: '/tmp/env-claude'
    });
  });
});
