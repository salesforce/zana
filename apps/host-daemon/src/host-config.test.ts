import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hostFallbackShell, loadHostAppConfig, resolveZccDataDir, ZCC_DATA_DIR_NAME } from './host-config.js';

describe('loadHostAppConfig', () => {
  it('projects the canonical persisted harness settings instead of probing stale legacy binaries', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-canonical-config-'));
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
      claudeBinary: '/old/claude', harnesses: { byId: {
        claude: { binary: '/selected/claude', compatibility: { permissionMode: 'plan' } },
        opencode: { binary: '/selected/opencode', enabled: false }
      } }
    }));
    expect(loadHostAppConfig(dataDir)).toMatchObject({ claudeBinary: '/selected/claude', opencodeBinary: '/selected/opencode', harnessOpenCodeEnabled: false, defaultPermissionMode: 'plan' });
    writeFileSync(join(dataDir, 'config.json'), '{incomplete');
    expect(loadHostAppConfig(dataDir).claudeBinary).toBe('claude');
  });
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

describe('host default shell', () => {
  const only = (...present: string[]) => (path: string) => present.includes(path);

  it('uses SHELL when it exists', () => {
    expect(hostFallbackShell({ platform: 'linux', env: { SHELL: '/usr/bin/fish' }, loginShell: () => '/bin/zsh', isExecutable: only('/usr/bin/fish', '/bin/zsh') }))
      .toBe('/usr/bin/fish');
  });

  it('takes the passwd login shell when SHELL is set but missing', () => {
    expect(hostFallbackShell({ platform: 'linux', env: { SHELL: '/bin/zsh' }, loginShell: () => '/bin/bash', isExecutable: only('/bin/bash', '/bin/sh') }))
      .toBe('/bin/bash');
  });

  it('keeps zsh on macOS through the login shell when SHELL is unset', () => {
    expect(hostFallbackShell({ platform: 'darwin', env: {}, loginShell: () => '/bin/zsh', isExecutable: only('/bin/zsh', '/bin/bash', '/bin/sh') }))
      .toBe('/bin/zsh');
  });

  it('falls back to /bin/sh when it is the only shell', () => {
    expect(hostFallbackShell({ platform: 'linux', env: {}, loginShell: () => null, isExecutable: only('/bin/sh') })).toBe('/bin/sh');
  });

  it('logs a clear error and still returns a value when no shell exists', () => {
    const warn = vi.fn();
    expect(hostFallbackShell({ platform: 'linux', env: {}, loginShell: () => null, isExecutable: () => false, warn })).toBe('/bin/sh');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No usable shell found. Tried /bin/bash, /bin/sh.'));
  });

  it('keeps the previous /bin/zsh value on Windows', () => {
    expect(hostFallbackShell({ platform: 'win32', env: { SHELL: '/bin/bash' }, isExecutable: () => true })).toBe('/bin/zsh');
  });

  it('loadHostAppConfig fills a missing shell from the lookup and keeps a saved one', () => {
    const expected = hostFallbackShell();
    expect(hostFallbackShell()).toBe(expected);
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-shell-'));
    expect(loadHostAppConfig(dataDir).shell).toBe(expected);
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ claudeBinary: 'claude' }));
    expect(loadHostAppConfig(dataDir).shell).toBe(expected);
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ shell: '/opt/custom/sh' }));
    expect(loadHostAppConfig(dataDir).shell).toBe('/opt/custom/sh');
    writeFileSync(join(dataDir, 'config.json'), '{broken');
    expect(loadHostAppConfig(dataDir).shell).toBe(expected);
    if (process.platform === 'win32') expect(expected).toBe('/bin/zsh');
  });
});
