import { describe, expect, it } from 'vitest';
import { attachPairingRelay } from './pairing-relay-controller.js';
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
    handle.stop();
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
