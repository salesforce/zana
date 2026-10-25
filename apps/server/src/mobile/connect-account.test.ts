import { expect, it, vi } from 'vitest';
import { ConnectEnrollment, connectRequest } from './connect-account.js';
import { MobileConnectionStore, validateMobileConnection } from './connection.js';
import { MobileGatewayManager } from './manager.js';
import { MobileDeviceStore } from './device-store.js';
import { CONNECT_ACCESS_REVOKED_MESSAGE } from '@zana-ai/zcc-domain/product';

const origin = 'https://example.com';
const serverUrl = 'https://s-aaaaaaaaaaaaaaaaaaaaaaaa.connect.example.com';
const start = () => ({ deviceCode: 'd'.repeat(43), verificationUrl: `${origin}/connect/?code=${'c'.repeat(22)}`, expiresAt: Date.now() + 600_000 });
const enrolled = { accountUrl: origin, serverUrl, serverId: 'computer-1', credential: 'k'.repeat(43) };
const reply = (value: unknown) => Response.json(value);
it('keeps enrollment credentials private, retries pending approvals and validates returned origins', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply(start())).mockResolvedValueOnce(reply({ pending: true })).mockResolvedValueOnce(reply(enrolled));
  const enrollment = new ConnectEnrollment(fetcher);
  const view = await enrollment.start(origin);
  expect(view).not.toHaveProperty('deviceCode');
  expect(await enrollment.poll()).toBeNull();
  expect(await enrollment.poll()).toEqual({ mode: 'connect', accountUrl: origin, publicUrl: serverUrl, serverId: 'computer-1', relayToken: enrolled.credential });
  enrollment.cancel(); await expect(enrollment.poll()).rejects.toThrow('expired');
  await expect(enrollment.start('http://example.com')).rejects.toThrow('HTTPS');
  await expect(enrollment.start('https://example.com/path')).rejects.toThrow('origin');
  const bad = new ConnectEnrollment(vi.fn(async () => reply({ ...start(), verificationUrl: 'https://evil.com/connect/' })));
  await expect(bad.start(origin)).rejects.toThrow('Invalid enrollment');
  expect(() => validateMobileConnection({ mode: 'connect', publicUrl: serverUrl, relayToken: enrolled.credential })).toThrow('Invalid Connect enrollment');
});
it('rejects redirects, malformed responses, errors and unbounded bodies', async () => {
  for (const result of [new Response('no', { status: 403 }), new Response('no', { status: 503 }), new Response('text'), reply([]), reply({ data: 'x'.repeat(262_145) })]) {
    await expect(connectRequest(origin, '/test', undefined, {}, vi.fn(async () => result))).rejects.toThrow();
  }
  const redirected = reply({}); Object.defineProperty(redirected, 'url', { value: 'https://evil.com/' });
  await expect(connectRequest(origin, '/test', undefined, undefined, vi.fn(async () => redirected))).rejects.toThrow('redirected');
});
it('raises the stable revoked message for 401/403 only', async () => {
  for (const status of [401, 403]) await expect(connectRequest(origin, '/test', 'tok', undefined, vi.fn(async () => new Response('no', { status })))).rejects.toThrow("This computer's access was revoked. Sign in again to reconnect.");
  await expect(connectRequest(origin, '/test', 'tok', undefined, vi.fn(async () => new Response('no', { status: 503 })))).rejects.toThrow('Connect returned 503');
});
it('wires enrollment, a local capability, cloud pairing, device revocation and disconnection', async () => {
  const store = new MobileConnectionStore();
  const fetcher = vi.fn(async (url: any) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/start')) return reply(start());
    if (path.endsWith('/poll')) return reply(enrolled);
    if (path.endsWith('/machine-code')) return reply({ version: 1, serverUrl, code: 'c'.repeat(22), expiresAt: Date.now() + 60_000 });
    if (path.endsWith('/devices')) return reply({ devices: [{ id: 'phone', label: 'Phone', createdAt: 123 }, { id: 'gone', revoked: true }] });
    return reply({ revoked: true });
  });
  const gateway = { port: 1234, pair: vi.fn(), devices: vi.fn(), revoke: vi.fn(), close: vi.fn(async () => {}) };
  const relay = { state: () => 'connected' as const, close: vi.fn() };
  const startGateway = vi.fn(async () => gateway);
  const connectRelay = vi.fn(() => relay);
  const manager = new MobileGatewayManager({ devices: new MobileDeviceStore(), connectionStore: store, upstream: 'http://127.0.0.1:123', connectFetch: fetcher, startGateway, connectRelay });
  await manager.enroll(origin); expect(await manager.pollEnrollment(true)).toEqual({ pending: false });
  expect(manager.status()).toMatchObject({ connection: { mode: 'connect', accountUrl: origin }, relayState: 'connected' });
  expect(JSON.stringify(manager.status())).not.toContain(enrolled.credential);
  expect(startGateway).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', connectGatewayCredential: expect.stringMatching(/^[\w-]{43}$/) }));
  expect(connectRelay).toHaveBeenCalledWith(expect.objectContaining({ gatewayCredential: startGateway.mock.calls[0][0].connectGatewayCredential, token: enrolled.credential }));
  expect(await manager.pair()).toHaveProperty('code');
  expect(await manager.devices()).toEqual([{ id: 'phone', label: 'Phone', createdAt: 123, expiresAt: 0 }]);
  expect(await manager.revoke('phone')).toBe(true);
  await manager.disconnectAccount(false); expect(manager.status().connection?.mode).toBe('unconfigured'); expect(relay.close).toHaveBeenCalledOnce();
  await manager.close();
});

it.each([401, 403, 503, 0])('recovers an already revoked computer but preserves credentials on transient errors (%s)', async status => {
  const store = new MobileConnectionStore();
  const connection = validateMobileConnection({ mode: 'connect', accountUrl: origin, publicUrl: serverUrl, serverId: enrolled.serverId, relayToken: enrolled.credential });
  await store.write(connection);
  const manager = new MobileGatewayManager({ devices: new MobileDeviceStore(), connectionStore: store, upstream: 'http://127.0.0.1:123', connectFetch: vi.fn(async () => {
    if (!status) throw new Error('Network unavailable');
    return new Response(null, { status });
  }) });
  if (status === 401 || status === 403) {
    await manager.disconnectAccount(false);
    expect(store.read()).toEqual({ mode: 'unconfigured' });
  } else {
    await expect(manager.disconnectAccount(false)).rejects.toThrow();
    expect(store.read()).toEqual(connection);
  }
  await manager.close();
});

it('resolves only the enrolled computer browser address without exposing its credential', async () => {
  const store = new MobileConnectionStore();
  const connection = validateMobileConnection({ mode: 'connect', accountUrl: origin, publicUrl: serverUrl, serverId: enrolled.serverId, relayToken: enrolled.credential });
  let value: unknown = { servers: [{ id: 'another', browserUrl: 'https://another.example.com' }, { id: enrolled.serverId, serverUrl, browserUrl: 'https://mine.example.com' }] };
  const fetcher = vi.fn(async () => reply(value));
  const manager = new MobileGatewayManager({ devices: new MobileDeviceStore(), connectionStore: store, upstream: 'http://127.0.0.1:123', connectFetch: fetcher });
  expect(await manager.browserAddress()).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  await store.write(connection);
  expect(await manager.browserAddress()).toBe('https://mine.example.com');
  expect(fetcher).toHaveBeenCalledWith(`${origin}/api/connect/servers`, expect.objectContaining({ headers: { Authorization: `Bearer ${enrolled.credential}` }, redirect: 'error' }));
  value = { servers: [{ id: enrolled.serverId, serverUrl, browserUrl: null }] };
  expect(await manager.browserAddress()).toBeNull();
  for (const servers of [null, Array(501).fill({}), [], [{ id: enrolled.serverId, revoked: true }], [{ id: enrolled.serverId, serverUrl: 'https://wrong.example.com' }]]) {
    value = { servers }; await expect(manager.browserAddress()).rejects.toThrow();
  }
  for (const servers of [[], [{ id: enrolled.serverId, revoked: true }]]) {
    value = { servers }; await expect(manager.browserAddress()).rejects.toThrow(CONNECT_ACCESS_REVOKED_MESSAGE);
  }
  for (const browserUrl of [42, 'x'.repeat(2049), 'not a URL', 'http://mine.example.com', 'javascript:alert(1)', 'https://user:secret@mine.example.com', 'https://mine.example.com/path', 'https://mine.example.com/?secret=yes', 'https://mine.example.com/#hash']) {
    value = { servers: [{ id: enrolled.serverId, serverUrl, browserUrl }] };
    await expect(manager.browserAddress()).rejects.toThrow();
  }
  fetcher.mockImplementationOnce(async () => { await store.write({ mode: 'unconfigured' }); return reply({ servers: [] }); });
  await expect(manager.browserAddress()).rejects.toThrow('Connection changed');
  await manager.close();
});

it('redeems account-issued codes through bounded HTTPS and validates all renderer inputs', async () => {
  const fetcher = vi.fn(async () => reply(enrolled));
  const enrollment = new ConnectEnrollment(fetcher);
  for (const address of [undefined, 'x'.repeat(2049), 'http://example.com', 'https://example.com/path', 'https://user:pass@example.com', 'https://example.com/?q=1', 'https://example.com/#fragment']) {
    await expect(enrollment.redeem(address, '0123456789ABCDEF')).rejects.toThrow();
  }
  for (const code of [undefined, 'x'.repeat(81), 'ZZZZZZZZZZZZZZZZ', 'short']) await expect(enrollment.redeem(origin, code)).rejects.toThrow('complete connect code');
  expect(fetcher).not.toHaveBeenCalled();
  expect(await enrollment.redeem(origin, '0123-4567-89ab-cdef')).toMatchObject({ mode: 'connect', relayToken: enrolled.credential });
  expect(fetcher).toHaveBeenCalledWith(`${origin}/api/connect/computer/redeem`, expect.objectContaining({ method: 'POST', redirect: 'error', body: expect.stringContaining('0123-4567-89ab-cdef') }));
  for (const status of [409, 410]) {
    const failed = new ConnectEnrollment(vi.fn(async () => new Response(null, { status })));
    await expect(failed.redeem(origin, '0123456789ABCDEF')).rejects.toThrow('get a new code');
  }
  const offline = new ConnectEnrollment(vi.fn(async () => { throw new Error('Offline'); }));
  await expect(offline.redeem(origin, '0123456789ABCDEF')).rejects.toThrow('Offline');
  const wrong = new ConnectEnrollment(vi.fn(async () => reply({ ...enrolled, accountUrl: 'https://evil.com' })));
  await expect(wrong.redeem(origin, '0123456789ABCDEF')).rejects.toThrow('Invalid Connect account');
});
it('persists code enrollment privately, stays offline until configured, and requires disconnect before re-pairing', async () => {
  const store = new MobileConnectionStore();
  const handle = { port: 1234, pair: vi.fn(), devices: vi.fn(), revoke: vi.fn(), close: vi.fn(async () => {}) };
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(reply(enrolled));
  const manager = new MobileGatewayManager({ devices: new MobileDeviceStore(), connectionStore: store, upstream: 'http://127.0.0.1:123', connectFetch: fetcher, startGateway: vi.fn(async () => handle) });
  await expect(manager.start()).rejects.toThrow('Remote access');
  await expect(manager.redeemComputerCode(origin, '0123456789ABCDEF')).rejects.toThrow('Offline');
  expect(manager.status().running).toBe(false); expect(store.read().mode).toBe('unconfigured'); expect(handle.close).not.toHaveBeenCalled();
  expect(await manager.redeemComputerCode(origin, '0123456789ABCDEF')).toBeUndefined();
  expect(store.read()).toMatchObject({ mode: 'connect', relayToken: enrolled.credential });
  expect(manager.status()).toMatchObject({ running: false, connection: { mode: 'connect' } });
  expect(JSON.stringify(manager.status())).not.toContain(enrolled.credential);
  expect(handle.close).not.toHaveBeenCalled();
  await expect(manager.redeemComputerCode(origin, '0123456789ABCDEF')).rejects.toThrow('Disconnect');
  expect(fetcher).toHaveBeenCalledTimes(2); await manager.close();
});
