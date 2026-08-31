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
  it('prefers runtime ZCC_APP_URL over a compile-time bake', () => {
    expect(resolvePublicAppUrl({
      env: { ZCC_APP_URL: 'https://box.tailnet.ts.net/' },
      bundledUrl: 'https://baked.example'
    })).toBe('https://box.tailnet.ts.net');
  });

  it('uses the bake when env is empty and ignores Settings / the repo file', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-url-file-'));
    writeFileSync(
      join(cwd, 'public-app-url'),
      '# comment\nhttps://zcc-7808c5bc8f3d.herokuapp.com/\n'
    );
    expect(readPublicAppUrlFile(cwd)).toBe('https://zcc-7808c5bc8f3d.herokuapp.com/');
    expect(resolvePublicAppUrl({
      env: {},
      configUrl: 'https://box.tailnet.ts.net:443/',
      cwd,
      bundledUrl: 'https://baked.example/'
    })).toBe('https://baked.example');
    expect(resolvePublicAppUrl({ env: {}, configUrl: 'https://other.example', cwd })).toBeUndefined();
    expect(resolvePublicAppUrl({ env: {}, bundledUrl: 'not a url' })).toBeUndefined();
    expect(resolvePublicAppUrl({ env: {}, bundledUrl: 'ftp://x' })).toBeUndefined();
  });

  it('does not read the repo-root file during vitest unless cwd is passed', () => {
    expect(readPublicAppUrlFile()).toBeUndefined();
    expect(resolvePublicAppUrl({ env: {}, configUrl: undefined })).toBeUndefined();
  });

  it('presents the resolved public origin and strips a stored relay token', () => {
    expect(presentAppConfig({ theme: 'dark' }, {
      env: {},
      bundledUrl: 'https://zcc-7808c5bc8f3d.herokuapp.com'
    })).toEqual({
      theme: 'dark',
      publicAppUrl: 'https://zcc-7808c5bc8f3d.herokuapp.com',
      relayToken: undefined
    });
    expect(presentAppConfig(
      { publicAppUrl: 'https://box.tailnet.ts.net', relayToken: 'secret' },
      { env: { ZCC_APP_URL: 'https://from-env.example' } }
    )).toEqual({
      publicAppUrl: 'https://from-env.example',
      relayToken: undefined
    });
    const stored = { publicAppUrl: 'https://box.tailnet.ts.net' };
    expect(presentAppConfig(stored, { env: {}, bundledUrl: '' })).toEqual({
      publicAppUrl: undefined,
      relayToken: undefined
    });
    const bare = { theme: 'light' };
    expect(presentAppConfig(bare, { env: {}, bundledUrl: '' })).toBe(bare);
  });

  it('allowlists loopback or the configured public Host header', () => {
    const url = 'https://zcc-7808c5bc8f3d.herokuapp.com';
    expect(isAllowedHostInternalHost('127.0.0.1:8780')).toBe(true);
    expect(isAllowedHostInternalHost('localhost:8780', url)).toBe(true);
    expect(isAllowedHostInternalHost('zcc-7808c5bc8f3d.herokuapp.com', url)).toBe(true);
    expect(isAllowedHostInternalHost('ZCC-7808c5bc8f3d.herokuapp.com', url)).toBe(true);
    expect(isAllowedHostInternalHost('evil.example', url)).toBe(false);
    expect(isAllowedHostInternalHost('zcc-7808c5bc8f3d.herokuapp.com')).toBe(false);
    expect(publicOriginHost(url)).toBe('zcc-7808c5bc8f3d.herokuapp.com');
  });
});
