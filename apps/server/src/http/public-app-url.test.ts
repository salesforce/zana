import { describe, expect, it } from 'vitest';
import {
  isAllowedHostInternalHost,
  publicOriginHost,
  resolvePublicAppUrl
} from './public-app-url.js';

describe('public app URL', () => {
  it('prefers ZCC_APP_URL over config and strips a trailing slash', () => {
    expect(resolvePublicAppUrl({
      env: { ZCC_APP_URL: 'https://box.tailnet.ts.net/' },
      configUrl: 'https://other.example'
    })).toBe('https://box.tailnet.ts.net');
    expect(resolvePublicAppUrl({
      env: {},
      configUrl: 'https://box.tailnet.ts.net:443/'
    })).toBe('https://box.tailnet.ts.net');
    expect(resolvePublicAppUrl({ env: {}, configUrl: 'not a url' })).toBeUndefined();
    expect(resolvePublicAppUrl({ env: {}, configUrl: 'ftp://x' })).toBeUndefined();
  });

  it('allowlists loopback or the configured public Host header', () => {
    const url = 'https://box.tailnet.ts.net';
    expect(isAllowedHostInternalHost('127.0.0.1:8780')).toBe(true);
    expect(isAllowedHostInternalHost('localhost:8780', url)).toBe(true);
    expect(isAllowedHostInternalHost('box.tailnet.ts.net', url)).toBe(true);
    expect(isAllowedHostInternalHost('BOX.tailnet.ts.net', url)).toBe(true);
    expect(isAllowedHostInternalHost('evil.example', url)).toBe(false);
    expect(isAllowedHostInternalHost('box.tailnet.ts.net')).toBe(false);
    expect(publicOriginHost(url)).toBe('box.tailnet.ts.net');
  });
});
