// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { getNativeShell, installNativeShellEvents } from './native-shell.js';
import { fetchWithAppSurface } from './fetch-with-app-surface.js';
import { getAppSurface } from './app-surface.js';
import { buildBridgeInjectionScript, MOBILE_BRIDGE_VERSION } from '@zana-ai/zcc-mobile-bridge';
const windowRecord = window as unknown as Record<string, unknown>;
afterEach(() => {
  vi.unstubAllGlobals();
  delete windowRecord.zccMobile;
  delete windowRecord.ReactNativeWebView;
  delete windowRecord.cc;
});
it('recognizes only a complete validated native bridge, with desktop taking precedence', () => {
  expect(getNativeShell()).toBeNull();
  expect(getAppSurface()).toBe('web');
  windowRecord.zccMobile = { native: { post: 'bad' } };
  expect(getNativeShell()).toBeNull();
  windowRecord.zccMobile = { native: { post() {}, request() {}, subscribe() {} } };
  expect(getNativeShell()).toBeNull();
  const postMessage = vi.fn();
  windowRecord.ReactNativeWebView = { postMessage };
  new Function(
    'window',
    buildBridgeInjectionScript({
      bridgeVersion: MOBILE_BRIDGE_VERSION,
      appVersion: '0.1.0',
      platform: 'ios',
      profileMode: 'connect',
      secureContext: true,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      capabilities: ['badge']
    })
  )(window);
  expect(getNativeShell()?.platform).toBe('ios');
  expect(getAppSurface()).toBe('mobile');
  const resume = vi.fn();
  const off = installNativeShellEvents(resume);
  expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('ready'));
  const native = (windowRecord.zccMobile as { native: { __receive(event: unknown): void } }).native;
  native.__receive({ type: 'resume' });
  native.__receive({ type: 'bad' });
  expect(resume).toHaveBeenCalledOnce();
  off();
  native.__receive({ type: 'resume' });
  expect(resume).toHaveBeenCalledOnce();
  windowRecord.cc = {};
  expect(getAppSurface()).toBe('desktop');
});
it('has a harmless no-op subscription without a native bridge', () => {
  expect(() => installNativeShellEvents(vi.fn())()).not.toThrow();
});

it('reports expired browser authentication to the native shell', async () => {
  const post = vi.fn();
  windowRecord.zccMobile = {
    native: {
      bridgeVersion: 2,
      appVersion: '1',
      platform: 'ios',
      profileMode: 'connect',
      secureContext: true,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      capabilities: [],
      post,
      request() {},
      subscribe() {}
    }
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
  await fetchWithAppSurface('/api/v1/projects');
  expect(post).toHaveBeenCalledWith({ type: 'auth-required' });
});
