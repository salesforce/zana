import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHostAppConfig, resolveZccDataDir, ZCC_DATA_DIR_NAME } from './host-config.js';

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

  it('resolveZccDataDir prefers ZCC_DATA_DIR then ZCC_CENTER_DIR then HOME/.zcc', () => {
    expect(resolveZccDataDir({ ZCC_DATA_DIR: '/tmp/zcc-data', ZCC_CENTER_DIR: '/tmp/legacy' }, '/home/u')).toBe(
      '/tmp/zcc-data'
    );
    expect(resolveZccDataDir({ ZCC_CENTER_DIR: '/tmp/zcc-center' }, '/home/u')).toBe('/tmp/zcc-center');
    expect(resolveZccDataDir({}, '/home/u')).toBe(join('/home/u', ZCC_DATA_DIR_NAME));
  });
});
