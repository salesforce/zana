import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAllowedHostInternalHost,
  presentAppConfig,
  publicOriginHost,
  readPublicAppUrlFile,
  resolvePublicAppUrl
} from './public-app-url.js';

describe('public app URL', () => {
  it.each([undefined, false, true])('presents the development startup default unless a saved preference exists (%s)', saved => {
    const config = { pluginDevelopmentEnabled: saved };
    expect(presentAppConfig(config, { env: { ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '1' }, bundledUrl: '' })
      .pluginDevelopmentEnabled).toBe(saved ?? true);
    expect(presentAppConfig(config, { env: {}, bundledUrl: '' })).toBe(config);
  });
  it('prefers runtime ZCC_APP_URL over a compile-time bake', () => {
    expect(resolvePublicAppUrl({
      env: { ZCC_APP_URL: 'https://machine.example.com/' },
      bundledUrl: 'https://baked.example'
    })).toBe('https://machine.example.com');
  });

  it('uses bake over Settings, then Settings over the repo file', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-url-file-'));
    writeFileSync(
      join(cwd, 'public-app-url'),
      '# comment\nhttps://zcc-7808c5bc8f3d.herokuapp.com/\n'
    );
    expect(readPublicAppUrlFile(cwd)).toBe('https://zcc-7808c5bc8f3d.herokuapp.com/');
    expect(resolvePublicAppUrl({
      env: {},
      configUrl: 'https://machine.example.com:443/',
      cwd,
      bundledUrl: 'https://baked.example/'
    })).toBe('https://baked.example');
    expect(resolvePublicAppUrl({
      env: {},
      configUrl: 'https://other.example',
      cwd
    })).toBe('https://other.example');
    expect(resolvePublicAppUrl({ env: {}, cwd })).toBe('https://zcc-7808c5bc8f3d.herokuapp.com');
    expect(resolvePublicAppUrl({ env: {}, bundledUrl: 'not a url' })).toBeUndefined();
    expect(resolvePublicAppUrl({ env: {}, bundledUrl: 'ftp://x' })).toBeUndefined();
  });

  it('skips a Docker Desktop join origin so bake or the repo file can win', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-url-docker-'));
    writeFileSync(join(cwd, 'public-app-url'), 'https://zcc-7808c5bc8f3d.herokuapp.com\n');
    expect(resolvePublicAppUrl({
      env: { ZCC_APP_URL: 'http://host.docker.internal:18781' },
      bundledUrl: 'https://baked.example',
      configUrl: 'http://host.docker.internal:18781',
      cwd
    })).toBe('https://baked.example');
    expect(resolvePublicAppUrl({
      env: {},
      configUrl: 'http://host.docker.internal:18781',
      cwd
    })).toBe('https://zcc-7808c5bc8f3d.herokuapp.com');
    expect(resolvePublicAppUrl({
      env: {},
      bundledUrl: '',
      configUrl: 'http://host.docker.internal:18781'
    })).toBeUndefined();
  });

  it('does not read the repo-root file during vitest unless cwd is passed', () => {
    expect(readPublicAppUrlFile()).toBeUndefined();
    expect(resolvePublicAppUrl({ env: {}, configUrl: undefined })).toBeUndefined();
  });

  it('presents the resolved public origin', () => {
    expect(presentAppConfig({ theme: 'dark' }, {
      env: {},
      bundledUrl: 'https://zcc-7808c5bc8f3d.herokuapp.com'
    })).toEqual({
      theme: 'dark',
      publicAppUrl: 'https://zcc-7808c5bc8f3d.herokuapp.com'
    });
    expect(presentAppConfig(
      { publicAppUrl: 'https://machine.example.com' },
      { env: { ZCC_APP_URL: 'https://from-env.example' } }
    )).toEqual({
      publicAppUrl: 'https://from-env.example'
    });
    const stored = { publicAppUrl: 'https://machine.example.com' };
    expect(presentAppConfig(stored, { env: {}, bundledUrl: '' })).toBe(stored);
    const bare = { theme: 'light' };
    expect(presentAppConfig(bare, { env: {}, bundledUrl: '' })).toBe(bare);
  });

  it('allowlists loopback or the configured public Host header', () => {
    const url = 'https://zcc-7808c5bc8f3d.herokuapp.com';
    expect(isAllowedHostInternalHost('127.0.0.1:8780')).toBe(true);
    expect(isAllowedHostInternalHost('host.docker.internal:18781', url)).toBe(true);
    expect(isAllowedHostInternalHost('localhost:8780', url)).toBe(true);
    expect(isAllowedHostInternalHost('zcc-7808c5bc8f3d.herokuapp.com', url)).toBe(true);
    expect(isAllowedHostInternalHost('ZCC-7808c5bc8f3d.herokuapp.com', url)).toBe(true);
    expect(isAllowedHostInternalHost('evil.example', url)).toBe(false);
    expect(isAllowedHostInternalHost('zcc-7808c5bc8f3d.herokuapp.com')).toBe(false);
    expect(publicOriginHost(url)).toBe('zcc-7808c5bc8f3d.herokuapp.com');
  });
});
