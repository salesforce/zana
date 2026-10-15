import { describe, expect, it } from 'vitest';
import { attachPairingRelay, relayOriginFromEnv } from './pairing-relay-controller.js';
import { pairingRelayTargets, resolveRelayToken } from './pairing-relay-client.js';

describe('pairing relay controller', () => {
  it('stays unconfigured until a public origin and token are both set', () => {
    const emitted: unknown[] = [];
    const ctx = {
      config: { getConfig: () => ({}) },
      hub: { emit: (_type: string, payload: unknown) => emitted.push(payload) }
    };
    const handle = attachPairingRelay(ctx as never, 9);
    expect(handle.state()).toBe('unconfigured');
    expect(ctx).toMatchObject({ pairingRelay: handle });
    expect(handle.relayOrigin()).toBeNull();
    expect(handle.tokenPresent()).toBe(false);
    handle.stop();
  });

  it('exposes the relay origin and token presence from env, never Settings', () => {
    const previous = { url: process.env.ZCC_APP_URL, token: process.env.ZCC_RELAY_TOKEN };
    process.env.ZCC_APP_URL = 'https://relay.example.com/';
    delete process.env.ZCC_RELAY_TOKEN;
    const ctx = {
      config: { getConfig: () => ({ publicAppUrl: 'https://settings.example.net', relayToken: 'from-settings' }) },
      hub: { emit: () => {} }
    };
    const handle = attachPairingRelay(ctx as never, 9);
    try {
      expect(handle.relayOrigin()).toBe('https://relay.example.com');
      expect(handle.tokenPresent()).toBe(false);
    } finally {
      handle.stop();
      if (previous.url === undefined) delete process.env.ZCC_APP_URL;
      else process.env.ZCC_APP_URL = previous.url;
      if (previous.token !== undefined) process.env.ZCC_RELAY_TOKEN = previous.token;
    }
  });

  it('reports unconfigured accessors before and after stop', async () => {
    const emitted: unknown[] = [];
    const setConfig: unknown[] = [];
    const ctx = {
      config: { getConfig: () => ({ relaySessionId: 'zcrs_abcdefghijklmnop' }), setConfig: (patch: unknown) => setConfig.push(patch) },
      hub: { emit: (_type: string, payload: unknown) => emitted.push(payload) }
    };
    const handle = attachPairingRelay(ctx as never, 9);
    expect(setConfig).toEqual([{ relaySessionId: undefined }]);
    expect(handle.snapshot()).toMatchObject({ state: 'unconfigured' });
    expect(handle.joinUntil()).toBeUndefined();
    await expect(handle.renewJoinWindow()).resolves.toMatchObject({ state: 'unconfigured' });
    handle.refresh();
    handle.stop();
    expect(handle.state()).toBe('unconfigured');
    expect(handle.snapshot()).toEqual({ state: 'unconfigured' });
    expect(handle.sessionId()).toBeUndefined();
    expect(handle.joinUntil()).toBeUndefined();
    await expect(handle.renewJoinWindow()).resolves.toEqual({ state: 'unconfigured' });
    expect(emitted.length).toBeGreaterThan(0);
  });

  it('resolves the relay origin without a token and drops loopback', () => {
    expect(relayOriginFromEnv({ ZCC_APP_URL: 'https://zcc.herokuapp.com' }, null)).toBe('https://zcc.herokuapp.com');
    expect(relayOriginFromEnv({ ZCC_APP_URL: 'http://127.0.0.1:8780' }, null)).toBeNull();
    expect(relayOriginFromEnv({}, 'https://baked.example')).toBe('https://baked.example');
    expect(relayOriginFromEnv({}, null)).toBeNull();
  });
});

describe('pairing relay targets', () => {
  it('prefers env token over a bake and ignores Settings', () => {
    expect(resolveRelayToken({ env: { ZCC_RELAY_TOKEN: ' from-env ' }, bundledToken: 'baked' })).toBe(
      'from-env'
    );
    expect(resolveRelayToken({ env: {}, bundledToken: ' baked-token ' })).toBe('baked-token');
    expect(resolveRelayToken({ env: {}, configToken: 'from-config' })).toBeUndefined();
    expect(pairingRelayTargets({
      env: { ZCC_APP_URL: 'http://127.0.0.1:8780', ZCC_RELAY_TOKEN: 'abc' }
    })).toEqual({});
    expect(pairingRelayTargets({
      env: { ZCC_APP_URL: 'https://zcc.herokuapp.com', ZCC_RELAY_TOKEN: 'abc' }
    })).toEqual({
      origin: 'https://zcc.herokuapp.com',
      token: 'abc'
    });
    expect(pairingRelayTargets({
      env: {},
      configUrl: 'https://zcc.herokuapp.com',
      configToken: 'from-config',
      bundledUrl: 'https://baked.example',
      bundledToken: 'baked-token'
    })).toEqual({
      origin: 'https://baked.example',
      token: 'baked-token'
    });
  });
});
