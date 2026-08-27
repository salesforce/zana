import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAllowedHostInternalHost,
  publicOriginHost,
  readPublicAppUrlFile,
  resolvePublicAppUrl
} from './public-app-url.js';

describe('public app URL', () => {
  it('prefers ZCC_APP_URL over config and strips a trailing slash', () => {
    expect(resolvePublicAppUrl({
      env: { ZCC_APP_URL: 'https://box.tailnet.ts.net/' },
      configUrl: 'https://other.example',
      cwd: mkdtempSync(join(tmpdir(), 'zcc-url-'))
    })).toBe('https://box.tailnet.ts.net');
    expect(resolvePublicAppUrl({
      env: {},
      configUrl: 'https://box.tailnet.ts.net:443/',
      cwd: mkdtempSync(join(tmpdir(), 'zcc-url-'))
    })).toBe('https://box.tailnet.ts.net');
    expect(resolvePublicAppUrl({ env: {}, configUrl: 'not a url', cwd: mkdtempSync(join(tmpdir(), 'zcc-url-')) })).toBeUndefined();
    expect(resolvePublicAppUrl({ env: {}, configUrl: 'ftp://x', cwd: mkdtempSync(join(tmpdir(), 'zcc-url-')) })).toBeUndefined();
  });

  it('does not read the repo-root file during vitest unless cwd is passed', () => {
    expect(readPublicAppUrlFile()).toBeUndefined();
    expect(resolvePublicAppUrl({ env: {}, configUrl: undefined })).toBeUndefined();
  });

  it('falls back to the repo public-app-url file and skips comments', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-url-file-'));
    writeFileSync(
      join(cwd, 'public-app-url'),
      '# comment\nhttps://zcc-7808c5bc8f3d.herokuapp.com/\n'
    );
    expect(readPublicAppUrlFile(cwd)).toBe('https://zcc-7808c5bc8f3d.herokuapp.com/');
    expect(resolvePublicAppUrl({ env: {}, cwd })).toBe('https://zcc-7808c5bc8f3d.herokuapp.com');
    expect(resolvePublicAppUrl({
      env: {},
      configUrl: 'https://box.tailnet.ts.net',
      cwd
    })).toBe('https://box.tailnet.ts.net');
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
