import { describe, expect, it, vi } from 'vitest';
import { PairingTargetSchema } from '@zana-ai/zcc-contracts/runtime';
import type { PairingRelaySnapshot } from '../../http/pairing-session-url.js';
import {
  resolvePairingTarget,
  resolvePairingTargetForContext,
  selectPairingTarget,
  type PairingRelaySource,
  type PairingTargetInput
} from './pairing-target.js';

const RELAY = 'https://relay.example.com';
const SESSION = 'zcrs_abcdefghijklmnop';
const connected: PairingRelaySnapshot = { state: 'connected', sessionId: SESSION, joinUntil: Date.now() + 60_000 };

function input(overrides: Partial<PairingTargetInput> = {}): PairingTargetInput {
  return {
    publicOrigin: RELAY,
    relayOrigin: RELAY,
    relayTokenPresent: true,
    snapshot: connected,
    ...overrides
  };
}

describe('selectPairingTarget', () => {
  it.each<[string, Partial<PairingTargetInput>, ReturnType<typeof selectPairingTarget>]>([
    ['no public origin', { publicOrigin: null }, { kind: 'tunnel', reason: 'no_public_origin' }],
    ['empty public origin', { publicOrigin: '' }, { kind: 'tunnel', reason: 'no_public_origin' }],
    ['invalid public origin', { publicOrigin: 'not a url' }, { kind: 'tunnel', reason: 'no_public_origin' }],
    ['non-http public origin', { publicOrigin: 'ftp://relay.example.com' }, { kind: 'tunnel', reason: 'no_public_origin' }],
    ['loopback public origin', { publicOrigin: 'http://127.0.0.1:8780' }, { kind: 'tunnel', reason: 'no_public_origin' }],
    ['localhost public origin', { publicOrigin: 'http://localhost:8780' }, { kind: 'tunnel', reason: 'no_public_origin' }],
    ['ipv6 loopback public origin', { publicOrigin: 'http://[::1]:8780' }, { kind: 'tunnel', reason: 'no_public_origin' }],
    ['public origin differs from relay', { publicOrigin: 'https://zcc.corp.example/' }, { kind: 'direct', serverUrl: 'https://zcc.corp.example' }],
    ['no relay origin', { relayOrigin: null }, { kind: 'direct', serverUrl: RELAY }],
    ['invalid relay origin', { relayOrigin: '::nope' }, { kind: 'direct', serverUrl: RELAY }],
    ['same origin, no token', { relayTokenPresent: false }, { kind: 'tunnel', reason: 'relay_unconfigured' }],
    ['same origin, no snapshot', { snapshot: null }, { kind: 'tunnel', reason: 'relay_offline' }],
    ['relay offline', { snapshot: { state: 'offline' } }, { kind: 'tunnel', reason: 'relay_offline' }],
    ['relay unconfigured', { snapshot: { state: 'unconfigured' } }, { kind: 'tunnel', reason: 'relay_unconfigured' }],
    ['connected without session', { snapshot: { state: 'connected' } }, { kind: 'tunnel', reason: 'no_session' }],
    ['connected with malformed session', { snapshot: { state: 'connected', sessionId: 'zcrs_x' } }, { kind: 'tunnel', reason: 'no_session' }],
    ['connected with session', {}, { kind: 'relay', serverUrl: `${RELAY}/t/${SESSION}` }],
    ['origins equal after normalization', { publicOrigin: 'HTTPS://Relay.Example.com:443/', relayOrigin: `${RELAY}/` }, { kind: 'relay', serverUrl: `${RELAY}/t/${SESSION}` }]
  ])('%s', (_name, overrides, expected) => {
    const target = selectPairingTarget(input(overrides));
    expect(target).toEqual(expected);
    expect(PairingTargetSchema.parse(target)).toEqual(expected);
  });

  it('never prefixes the relay session onto a Settings URL that is not the relay', () => {
    const target = selectPairingTarget(input({ publicOrigin: 'https://settings.example.net' }));
    expect(target).toEqual({ kind: 'direct', serverUrl: 'https://settings.example.net' });
    expect(JSON.stringify(target)).not.toContain(SESSION);
  });
});

function relay(overrides: Partial<PairingRelaySource> & { snap?: PairingRelaySnapshot } = {}): PairingRelaySource {
  return {
    relayOrigin: () => RELAY,
    tokenPresent: () => true,
    snapshot: () => overrides.snap ?? connected,
    renewJoinWindow: vi.fn(async () => connected),
    ...overrides
  };
}

describe('resolvePairingTarget', () => {
  it('uses an open join window without renewing', async () => {
    const source = relay();
    await expect(resolvePairingTarget({ publicOrigin: RELAY, relay: source })).resolves.toEqual({
      kind: 'relay',
      serverUrl: `${RELAY}/t/${SESSION}`
    });
    expect(source.renewJoinWindow).not.toHaveBeenCalled();
  });

  it('renews a closed join window before choosing the relay', async () => {
    const source = relay({ snap: { state: 'connected', sessionId: SESSION, joinUntil: 1 } });
    await expect(resolvePairingTarget({ publicOrigin: RELAY, relay: source, now: () => 1_000 })).resolves.toEqual({
      kind: 'relay',
      serverUrl: `${RELAY}/t/${SESSION}`
    });
    expect(source.renewJoinWindow).toHaveBeenCalledTimes(1);
  });

  it('renews when connected without a session and uses the new session', async () => {
    const fresh = 'zcrs_ZYXWVUTSRQPONMLK';
    const source = relay({
      snap: { state: 'connected' },
      renewJoinWindow: vi.fn(async () => ({ state: 'connected' as const, sessionId: fresh, joinUntil: Date.now() + 1_000 }))
    });
    await expect(resolvePairingTarget({ publicOrigin: RELAY, relay: source })).resolves.toEqual({
      kind: 'relay',
      serverUrl: `${RELAY}/t/${fresh}`
    });
  });

  it('falls back to a tunnel when renewal fails', async () => {
    const source = relay({
      snap: { state: 'connected', sessionId: SESSION },
      renewJoinWindow: vi.fn(async () => { throw new Error('relay closed'); })
    });
    await expect(resolvePairingTarget({ publicOrigin: RELAY, relay: source })).resolves.toEqual({
      kind: 'tunnel',
      reason: 'relay_offline'
    });
  });

  it('reports the renewed state when renewal goes offline', async () => {
    const source = relay({
      snap: { state: 'connected', sessionId: SESSION },
      renewJoinWindow: vi.fn(async () => ({ state: 'offline' as const }))
    });
    await expect(resolvePairingTarget({ publicOrigin: RELAY, relay: source })).resolves.toEqual({
      kind: 'tunnel',
      reason: 'relay_offline'
    });
  });

  it('does not renew for a direct origin or an offline relay', async () => {
    const direct = relay({ snap: { state: 'connected', sessionId: SESSION } });
    await expect(resolvePairingTarget({ publicOrigin: 'https://own.example', relay: direct })).resolves.toEqual({
      kind: 'direct',
      serverUrl: 'https://own.example'
    });
    const offline = relay({ snap: { state: 'offline' } });
    await expect(resolvePairingTarget({ publicOrigin: RELAY, relay: offline })).resolves.toEqual({
      kind: 'tunnel',
      reason: 'relay_offline'
    });
    expect(direct.renewJoinWindow).not.toHaveBeenCalled();
    expect(offline.renewJoinWindow).not.toHaveBeenCalled();
  });

  it('treats a missing relay handle as no relay', async () => {
    await expect(resolvePairingTarget({ publicOrigin: RELAY, relay: undefined })).resolves.toEqual({
      kind: 'direct',
      serverUrl: RELAY
    });
    await expect(resolvePairingTarget({ publicOrigin: null, relay: null })).resolves.toEqual({
      kind: 'tunnel',
      reason: 'no_public_origin'
    });
  });
});

describe('resolvePairingTargetForContext', () => {
  it('reads the public URL from Settings and the relay from the context', async () => {
    const ctx = {
      config: { getConfig: () => ({ publicAppUrl: 'https://settings.example.net/' }) },
      pairingRelay: relay()
    };
    const previous = process.env.ZCC_APP_URL;
    delete process.env.ZCC_APP_URL;
    try {
      await expect(resolvePairingTargetForContext(ctx as never)).resolves.toEqual({
        kind: 'direct',
        serverUrl: 'https://settings.example.net'
      });
    } finally {
      if (previous !== undefined) process.env.ZCC_APP_URL = previous;
    }
  });

  it('tunnels when no public URL resolves', async () => {
    const previous = process.env.ZCC_APP_URL;
    delete process.env.ZCC_APP_URL;
    try {
      await expect(resolvePairingTargetForContext({
        config: { getConfig: () => ({}) },
        pairingRelay: undefined
      } as never)).resolves.toEqual({ kind: 'tunnel', reason: 'no_public_origin' });
    } finally {
      if (previous !== undefined) process.env.ZCC_APP_URL = previous;
    }
  });
});
