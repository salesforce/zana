import { describe, expect, it, vi } from 'vitest';
import {
  normalizeServerUrl,
  safePath,
  isSameServer,
  externalUrl,
  parsePairingPayload,
  nativeIntent
} from './urls';
import {
  EMPTY_STATE,
  ProfileStore,
  parseMobileState,
  saveProfile,
  removeProfile
} from './profiles';
import { pairServer, createSession, probeDirect, PairingRequired } from './client';
import { handleBridgeMessage } from './bridge-handler';
const profile = { id: 'one', label: 'Mac', serverUrl: 'https://mac.example' };
const response = (value: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': type } });

describe('mobile URLs and links', () => {
  it('parses native deep links independently of React Native’s incomplete global URL', () => {
    vi.stubGlobal(
      'URL',
      class {
        constructor() {
          throw new Error('Native fallback parser');
        }
      }
    );
    try {
      const payload = JSON.stringify({
        version: 1,
        serverUrl: profile.serverUrl,
        code: 'a'.repeat(22),
        expiresAt: Date.now() + 60_000
      });
      expect(nativeIntent(`zana://connect?payload=${encodeURIComponent(payload)}`)).toBe(
        `/connect?payload=${encodeURIComponent(payload)}`
      );
      expect(normalizeServerUrl('https://MAC.example/')).toBe(profile.serverUrl);
      expect(safePath('/threads/../internal/hosts')).toBe('/');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('accepts secure servers and explicit private network origins', () => {
    for (const raw of [
      'https://mac.example/',
      'http://127.0.0.1:8780',
      'http://localhost:8780',
      'http://[::1]:8780',
      'http://10.0.2.2:8785',
      'http://192.168.1.2',
      'http://172.16.0.2',
      'http://100.64.2.4',
      'http://mac.local'
    ])
      expect(normalizeServerUrl(raw)).toBe(new URL(raw).origin);
    for (const raw of [
      'http://evil.example',
      'http://10.evil.example',
      'http://127.evil.example',
      'https://a:b@mac.example',
      'https://mac.example/path',
      'https://mac.example?token=x',
      'https://mac.example#fragment',
      'file:///tmp'
    ])
      expect(() => normalizeServerUrl(raw)).toThrow();
  });
  it('confines page paths and external schemes', () => {
    for (const path of [
      '//evil.example',
      '/\\evil',
      'https://evil.example',
      '/api/v1/threads',
      '/internal/x',
      '/%2f%2fevil',
      '/x\n',
      'x'.repeat(3000)
    ])
      expect(safePath(path)).toBe('/');
    expect(safePath('/threads/t1?x=y#last')).toBe('/threads/t1?x=y#last');
    expect(isSameServer('https://mac.example/threads/1', profile.serverUrl)).toBe(true);
    expect(isSameServer('https://u:p@mac.example', profile.serverUrl)).toBe(false);
    expect(isSameServer('not a url', profile.serverUrl)).toBe(false);
    expect(externalUrl('mailto:user@example.com')).toBe(true);
    expect(externalUrl('javascript:alert(1)')).toBe(false);
    expect(externalUrl('not-url')).toBe(false);
  });
  it('validates pairing expiry and routes links without implicitly pairing', () => {
    const payload = {
      version: 1,
      serverUrl: profile.serverUrl,
      code: 'a'.repeat(22),
      expiresAt: Date.now() + 10_000
    };
    const raw = JSON.stringify(payload);
    expect(parsePairingPayload(raw)).toEqual(payload);
    const link = `zana://connect?payload=${encodeURIComponent(raw)}`;
    expect(parsePairingPayload(link)).toEqual(payload);
    expect(nativeIntent(link)).toContain('/connect?payload=');
    expect(() => parsePairingPayload(raw, payload.expiresAt + 1)).toThrow();
    expect(() => parsePairingPayload('x'.repeat(5000))).toThrow();
    expect(
      nativeIntent(`zana://open?server=${encodeURIComponent(profile.serverUrl)}&path=/threads/1`)
    ).toContain('path=%2Fthreads%2F1');
    expect(nativeIntent('https://mac.example/threads/t1')).toContain('server=https');
    expect(nativeIntent('javascript:x')).toBe('/');
    expect(nativeIntent('malformed')).toBe('/');
  });
  it('rejects malformed QR contents and lookalike pairing links with readable errors', () => {
    const raw = JSON.stringify({
      version: 1,
      serverUrl: profile.serverUrl,
      code: 'a'.repeat(22),
      expiresAt: Date.now() + 10_000
    });
    for (const prefix of [
      'zana://connect.evil',
      'zana://user@connect',
      'zana://connect:123',
      'zana://connect/other'
    ])
      expect(() => parsePairingPayload(`${prefix}?payload=${encodeURIComponent(raw)}`)).toThrow(
        'Scan a Zana pairing QR'
      );
    for (const raw of ['null', '[]', '123', '{}', '{"version":1,"code":"bad"}'])
      expect(() => parsePairingPayload(raw)).toThrow('invalid or expired');
    expect(() => parsePairingPayload('not JSON')).toThrow('Scan a Zana pairing QR');
    expect(() => parsePairingPayload('zana://connect')).toThrow('Scan a Zana pairing QR');
  });
});
describe('saved servers', () => {
  it('validates persisted data and preserves identity when pairing again', () => {
    expect(parseMobileState(null)).toEqual(EMPTY_STATE);
    const saved = saveProfile(EMPTY_STATE, profile);
    expect(parseMobileState(JSON.stringify(saved))).toEqual(saved);
    const repaired = saveProfile(saved, { ...profile, id: 'new', label: 'Renamed' });
    expect(repaired.profiles).toHaveLength(1);
    expect(repaired.activeId).toBe('one');
    expect(removeProfile(saved, 'one').activeId).toBe(null);
    const two = saveProfile(saved, { id: 'two', label: '', serverUrl: 'https://second.example' });
    expect(removeProfile(two, 'two').activeId).toBe('one');
    expect(removeProfile(two, 'one').activeId).toBe('two');
    for (const value of [
      {},
      { ...saved, activeId: 'missing' },
      { ...saved, appearance: 'invalid' },
      { ...saved, profiles: [profile, profile] },
      { ...saved, profiles: [{ ...profile, credential: 'bad' }] }
    ])
      expect(() => parseMobileState(JSON.stringify(value))).toThrow();
    expect(() => parseMobileState('x'.repeat(20_000))).toThrow();
  });
  it('serializes writes and retains the previous state after failed persistence', async () => {
    let disk: string | null = null;
    const storage = {
      getItemAsync: async () => disk,
      setItemAsync: vi.fn(async (_key, value) => {
        disk = value;
      })
    };
    const store = new ProfileStore(storage);
    await store.load();
    await Promise.all([
      store.update((s) => saveProfile(s, profile)),
      store.update((s) => ({ ...s, haptics: false }))
    ]);
    expect(parseMobileState(disk).profiles).toHaveLength(1);
    expect(parseMobileState(disk).haptics).toBe(false);
    storage.setItemAsync.mockRejectedValueOnce(new Error('disk full'));
    await expect(store.update((s) => removeProfile(s, 'one'))).rejects.toThrow('disk full');
    const next = await store.update((s) => ({ ...s, appearance: 'dark' }));
    expect(next.profiles).toHaveLength(1);
  });
});
describe('mobile client', () => {
  it('probes, pairs and validates the session cookie without exposing credentials in URLs', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ credential: 'c'.repeat(43), deviceId: 'device' }))
      .mockResolvedValueOnce(
        response({
          cookie: {
            name: 'zcc_mobile_session',
            value: 's'.repeat(43),
            path: '/',
            httpOnly: true,
            secure: true,
            expires: new Date(Date.now() + 60_000).toISOString()
          },
          expiresAt: Date.now() + 60_000
        })
      );
    await probeDirect(profile.serverUrl, fetcher);
    const credential = await pairServer(profile.serverUrl, 'code', 'Phone', fetcher);
    expect((await createSession({ ...profile, ...credential }, fetcher))?.cookie.httpOnly).toBe(
      true
    );
    expect(fetcher.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${credential.credential}`
    });
    expect(String(fetcher.mock.calls[2]?.[0])).not.toContain(credential.credential);
    expect(await createSession(profile, vi.fn().mockResolvedValue(response({ ok: true })))).toBe(
      null
    );
  });
  it('handles expired/revoked auth, HTML login redirects, malformed payloads and errors', async () => {
    await expect(
      probeDirect(profile.serverUrl, vi.fn().mockResolvedValue(response({}, 401)))
    ).rejects.toBeInstanceOf(PairingRequired);
    await expect(
      probeDirect(profile.serverUrl, vi.fn().mockResolvedValue(response({}, 429)))
    ).rejects.toThrow('Too many');
    await expect(
      probeDirect(profile.serverUrl, vi.fn().mockResolvedValue(response({}, 500)))
    ).rejects.toThrow('500');
    await expect(
      probeDirect(profile.serverUrl, vi.fn().mockResolvedValue(response({}, 200, 'text/html')))
    ).rejects.toThrow('not a Zana');
    await expect(
      probeDirect(profile.serverUrl, vi.fn().mockResolvedValue(response({ ok: false })))
    ).rejects.toThrow();
    await expect(
      pairServer(
        profile.serverUrl,
        'code',
        'Phone',
        vi.fn().mockResolvedValue(response({ credential: 'bad' }))
      )
    ).rejects.toThrow('Invalid');
    await expect(
      createSession(
        { ...profile, credential: 'c'.repeat(43) },
        vi.fn().mockResolvedValue(response({ cookie: {} }))
      )
    ).rejects.toThrow('Invalid');
    await expect(
      probeDirect(profile.serverUrl, vi.fn().mockResolvedValue(response('x'.repeat(20_000))))
    ).rejects.toThrow('too large');
    const redirect = response({ ok: true });
    Object.defineProperty(redirect, 'url', { value: 'https://other.example' });
    await expect(
      probeDirect(profile.serverUrl, vi.fn().mockResolvedValue(redirect))
    ).rejects.toThrow('redirected');
    await expect(
      probeDirect(profile.serverUrl, vi.fn().mockRejectedValue(new Error('offline')))
    ).rejects.toThrow('Could not reach your Zana server');
  });
  it('bounds an unresponsive connection and gives a readable timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('native timeout')), {
              once: true
            });
          })
      );
      const failed = expect(probeDirect(profile.serverUrl, fetcher)).rejects.toThrow(
        'connection timed out'
      );
      await vi.advanceTimersByTimeAsync(12_000);
      await failed;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
describe('native bridge dispatcher', () => {
  it('validates origin and messages before allowing phone actions, and answers share requests', async () => {
    const actions = {
      haptic: vi.fn().mockResolvedValue(undefined),
      badge: vi.fn().mockResolvedValue(undefined),
      share: vi.fn().mockResolvedValue('shared'),
      openExternal: vi.fn().mockResolvedValue(undefined),
      openSettings: vi.fn(),
      openMenu: vi.fn(),
      shellChrome: vi.fn(),
      authRequired: vi.fn(),
      ready: vi.fn(),
      inject: vi.fn()
    };
    const send = (value: unknown, origin = profile.serverUrl) =>
      handleBridgeMessage(JSON.stringify(value), origin, profile.serverUrl, actions);
    await send({ type: 'open-native', screen: 'device-settings' }, 'https://evil.example');
    expect(actions.openSettings).not.toHaveBeenCalled();
    await send({ type: 'open-native', screen: 'device-settings' });
    expect(actions.openSettings).toHaveBeenCalledOnce();
    await send({ type: 'open-native', screen: 'connection-menu' }, 'https://evil.example');
    await send({ type: 'shell-chrome', visible: true }, 'https://evil.example');
    expect(actions.openMenu).not.toHaveBeenCalled();
    expect(actions.shellChrome).not.toHaveBeenCalled();
    await send({ type: 'open-native', screen: 'connection-menu' });
    expect(actions.openMenu).toHaveBeenCalledOnce();
    expect(actions.openSettings).toHaveBeenCalledOnce();
    await send({ type: 'shell-chrome', visible: true });
    await send({ type: 'shell-chrome', visible: false });
    expect(actions.shellChrome.mock.calls).toEqual([[true], [false]]);
    await send({ type: 'auth-required' });
    expect(actions.authRequired).toHaveBeenCalledOnce();
    await send({ type: 'ready', path: '//evil' });
    expect(actions.ready).toHaveBeenCalledWith('/');
    await send({ type: 'title', title: 'Zana', path: '/' });
    await send({ type: 'haptic', kind: 'selection' });
    expect(actions.haptic).toHaveBeenCalledWith('selection');
    await send({ type: 'badge', count: 50_000 });
    expect(actions.badge).toHaveBeenCalledWith(9999);
    await send({ type: 'open-external', url: 'https://docs.example' });
    expect(actions.openExternal).toHaveBeenCalledOnce();
    await send({ type: 'open-external', url: 'javascript:alert(1)' });
    expect(actions.openExternal).toHaveBeenCalledOnce();
    await send({
      type: 'request',
      id: '1',
      request: { kind: 'share', payload: { text: 'Hello' } }
    });
    expect(actions.inject).toHaveBeenLastCalledWith(expect.stringContaining('shared'));
    actions.share.mockRejectedValueOnce(new Error('cancelled'));
    await send({
      type: 'request',
      id: '2',
      request: { kind: 'share', payload: { text: 'Hello' } }
    });
    expect(actions.inject).toHaveBeenLastCalledWith(expect.stringContaining('Could not open'));
    actions.haptic.mockRejectedValueOnce(new Error('unavailable'));
    await send({ type: 'haptic', kind: 'selection' });
    await handleBridgeMessage('bad JSON', profile.serverUrl, profile.serverUrl, actions);
    await handleBridgeMessage('x'.repeat(20_000), profile.serverUrl, profile.serverUrl, actions);
  });
});

describe('notification routes and registration', () => {
  it('opens only a known profile and a validated thread path', async () => {
    const { notificationRoute } = await import('./notification-route');
    expect(
      notificationRoute({ serverUrl: profile.serverUrl, path: '/threads/t1' }, [profile])
    ).toContain('path=%2Fthreads%2Ft1');
    for (const data of [
      null,
      {},
      { serverUrl: 'https://unknown.example', path: '/threads/t1' },
      { serverUrl: profile.serverUrl, path: '/internal/hosts' }
    ])
      expect(notificationRoute(data, [profile])).toBeNull();
  });
  it('registers and unregisters only using a paired credential', async () => {
    const { registerPush } = await import('./client');
    await expect(registerPush(profile, 'ExpoPushToken[token]')).rejects.toThrow('paired');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ enabled: true }));
    await registerPush({ ...profile, credential: 'c'.repeat(43) }, 'ExpoPushToken[token]', fetcher);
    await registerPush({ ...profile, credential: 'c'.repeat(43) }, null, fetcher);
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['PUT', 'DELETE']);
  });
});
