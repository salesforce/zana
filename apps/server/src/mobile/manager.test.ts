import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MobileGatewayManager, type MobileGatewayManagerDeps } from './manager.js';
import { MobileDeviceStore } from './device-store.js';
import type { startMobileGateway } from './gateway.js';
import { MobileConnectionStore } from './connection.js';

const defaultRelay = vi.hoisted(() => vi.fn(() => ({ state: () => 'connected', close: vi.fn() })));
vi.mock('../../../../services/mobile-relay/client.mjs', async (orig) => ({ ...(await orig<object>()), connectRelay: defaultRelay }));

const connectConfig = { mode: 'connect' as const, publicUrl: 'https://computer.example', relayToken: 'a'.repeat(43), accountUrl: 'https://account.example', serverId: 'computer-1' };
function remoteManager(deps: MobileGatewayManagerDeps) {
  const store = new MobileConnectionStore(); void store.write(connectConfig);
  return new MobileGatewayManager({ connectionStore: store, connectRelay: () => ({ state: () => 'connected', close: vi.fn() }), ...deps });
}

function fakeHandle(port = 8785) {
  return {
    port,
    pair: vi.fn(() => ({ version: 1, serverUrl: 'http://x', code: 'code', expiresAt: 1 })),
    devices: vi.fn(() => [{ id: 'd1', label: 'Phone', createdAt: 0, expiresAt: 0 }]),
    revoke: vi.fn(() => true),
    close: vi.fn(async () => {})
  };
}

describe('MobileGatewayManager', () => {
  it('passes the main-owned queued-send signer to the authenticated gateway', async () => {
    const signer = vi.fn(() => 'private-proof');
    const start = vi.fn(async () => fakeHandle(8785));
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780',
      startGateway: start as unknown as typeof startMobileGateway, signQueuedSend: signer });
    try {
      await manager.start();
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ signQueuedSend: signer }));
      expect(signer).not.toHaveBeenCalled();
      expect(JSON.stringify(manager.status())).not.toContain('private-proof');
    } finally { await manager.close(); }
  });
  const make = (startGateway: typeof startMobileGateway) =>
    remoteManager({
      devices: new MobileDeviceStore(),
      upstream: 'http://127.0.0.1:8780',
      startGateway
    });

  it('starts once and reports a loopback tunnel; a second start is a no-op', async () => {
    const start = vi.fn(async () => fakeHandle(8785)) as unknown as typeof startMobileGateway;
    const manager = make(start);
    const status = await manager.start();
    expect(status).toEqual({
      running: true,
      publicUrl: 'https://computer.example',
      host: '127.0.0.1',
      port: 8785,
      boundLan: false,
      error: null,
      distribution: { testFlightUrl: null },
      readySessions: [],
      connection: { mode: 'connect', publicUrl: 'https://computer.example', hasRelayToken: true, accountUrl: 'https://account.example', serverId: 'computer-1' },
      relayState: 'connected'
    });
    await manager.start();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('stops and closes the underlying handle', async () => {
    const handle = fakeHandle();
    const manager = make((async () => handle) as unknown as typeof startMobileGateway);
    await manager.start();
    const status = await manager.stop();
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(status.running).toBe(false);
    expect(status.publicUrl).toBeNull();
  });

  it('surfaces a friendly message when the port is already in use', async () => {
    const start = vi.fn(async () => {
      throw Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    }) as unknown as typeof startMobileGateway;
    const manager = make(start);
    await expect(manager.start()).rejects.toThrow(/already in use by another process/);
    expect(manager.status().running).toBe(false);
    expect(manager.status().error).toMatch(/already in use/);
  });

  it('only pairs through Zana Connect, never the gateway handle', async () => {
    const handle = fakeHandle();
    const store = new MobileConnectionStore(); await store.write(connectConfig);
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', connectionStore: store,
      startGateway: (async () => handle) as unknown as typeof startMobileGateway });
    await manager.start();
    vi.spyOn(store, 'read').mockReturnValue({ mode: 'unconfigured' });
    expect(() => manager.pair()).toThrow('before pairing a device');
    expect(handle.pair).not.toHaveBeenCalled();
    await manager.close();
  });

  it('rejects pairing while stopped but still reads/revokes devices from the store', async () => {
    const devices = new MobileDeviceStore();
    const added = devices.add('Phone');
    const manager = new MobileGatewayManager({
      devices,
      upstream: 'http://127.0.0.1:8780',
      startGateway: (async () => fakeHandle()) as unknown as typeof startMobileGateway
    });
    expect(() => manager.pair()).toThrow(/Enable phone access/);
    expect(manager.devices().map((d) => d.id)).toContain(added.deviceId);
    expect(manager.revoke(added.deviceId)).toBe(true);
    expect(manager.devices()).toHaveLength(0);
  });
});

describe('remote phone connection lifecycle', () => {
  it.each(['tailscale', 'local'])('keeps a retired %s setup offline and recovers through explicit Connect enrollment', async mode => {
    const dir = mkdtempSync(join(tmpdir(), 'removed-mobile-connection-'));
    const file = join(dir, 'connection.json');
    const legacy = JSON.stringify({ mode, publicUrl: 'https://private-machine.example' });
    writeFileSync(file, legacy);
    const devices = new MobileDeviceStore();
    const phone = devices.add('Saved phone');
    const startGateway = vi.fn(async () => fakeHandle());
    const store = new MobileConnectionStore(file);
    const manager = remoteManager({
      devices, connectionStore: store, upstream: 'http://127.0.0.1:8780',
      startGateway: startGateway as unknown as typeof startMobileGateway,
      connectFetch: vi.fn(async () => Response.json({ accountUrl: 'https://account.example', serverUrl: 'https://computer.example', serverId: 'computer-1', credential: 'k'.repeat(43) }))
    });
    try {
      expect(manager.status()).toMatchObject({ running: false, connection: undefined, error: expect.stringContaining('Open Remote access') });
      await expect(manager.start()).rejects.toThrow('no longer supported');
      expect(startGateway).not.toHaveBeenCalled();
      expect(readFileSync(file, 'utf8')).toBe(legacy);
      expect(JSON.stringify(manager.status())).not.toContain('private-machine.example');
      await manager.redeemComputerCode('https://account.example', '0123456789ABCDEF');
      expect(manager.status()).toMatchObject({ running: false, error: null, connection: { mode: 'connect' } });
      expect(new MobileConnectionStore(file).read().mode).toBe('connect');
      expect(devices.list().map(device => device.id)).toContain(phone.deviceId);
      expect(startGateway).not.toHaveBeenCalled();
    } finally { await manager.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('loads a saved Heroku relay connection as unconfigured and stays offline until Connect sign-in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retired-relay-connection-'));
    const file = join(dir, 'connection.json');
    writeFileSync(file, JSON.stringify({ mode: 'relay', publicUrl: 'https://relay.example', relayToken: 'r'.repeat(43) }));
    const startGateway = vi.fn(async () => fakeHandle());
    const manager = new MobileGatewayManager({ devices: new MobileDeviceStore(), connectionStore: new MobileConnectionStore(file), upstream: 'http://127.0.0.1:8780',
      startGateway: startGateway as unknown as typeof startMobileGateway });
    try {
      expect(manager.status()).toMatchObject({ running: false, error: null, connection: { mode: 'unconfigured', hasRelayToken: false } });
      expect(JSON.stringify(manager.status())).not.toContain('r'.repeat(43));
      await expect(manager.start()).rejects.toThrow('Remote access');
      expect(startGateway).not.toHaveBeenCalled();
    } finally { await manager.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('starts and stops the outbound Connect tunnel and gates pairing on tunnel readiness', async () => {
    let state: 'connecting' | 'connected' = 'connecting';
    const close = vi.fn();
    const connect = vi.fn(() => ({ state: () => state, close }));
    const code = { version: 1, serverUrl: 'https://computer.example', code: 'c'.repeat(22), expiresAt: Date.now() + 60_000 };
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', startGateway: (async () => fakeHandle()) as unknown as typeof startMobileGateway,
      connectRelay: connect, connectFetch: vi.fn(async () => Response.json(code)) });
    await manager.start();
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ publicUrl: 'https://computer.example', token: 'a'.repeat(43), gatewayCredential: expect.any(String) }));
    expect(manager.status().relayState).toBe('connecting');
    expect(() => manager.pair()).toThrow(/Wait for the Zana Connect tunnel/);
    state = 'connected'; await expect(manager.pair()).resolves.toEqual(code);
    expect(JSON.stringify(manager.status())).not.toContain('a'.repeat(43));
    await manager.stop(); expect(close).toHaveBeenCalledOnce();
  });
  it('opens the default Connect tunnel with this product instance identity', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'mobile-instance-'));
    const startGateway = vi.fn(async () => fakeHandle());
    const store = new MobileConnectionStore(); void store.write(connectConfig);
    const manager = new MobileGatewayManager({ devices: new MobileDeviceStore(), connectionStore: store, upstream: 'http://127.0.0.1:8780', dataDir,
      startGateway: startGateway as unknown as typeof startMobileGateway });
    try {
      await manager.start();
      const instanceId = (startGateway.mock.calls[0] as unknown as [{ connectInstanceId: string }])[0].connectInstanceId;
      expect(instanceId).toEqual(expect.any(String));
      expect(defaultRelay).toHaveBeenCalledWith(expect.objectContaining({ publicUrl: 'https://computer.example', productInstanceId: instanceId }));
    } finally { await manager.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });
  it('serializes start/stop', async () => {
    const handle = fakeHandle();
    const start = vi.fn(async () => handle);
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', startGateway: start as unknown as typeof startMobileGateway });
    await Promise.all([manager.start(), manager.start()]);
    expect(start).toHaveBeenCalledOnce();
    await Promise.all([manager.stop(), manager.start(), manager.stop()]);
    expect(manager.status().running).toBe(false); expect(handle.close).toHaveBeenCalledTimes(2);
  });
  it('closes the gateway if creating the tunnel fails', async () => {
    const handle = fakeHandle();
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', startGateway: (async () => handle) as unknown as typeof startMobileGateway,
      connectRelay: () => { throw new Error('Unable to start relay'); } });
    await expect(manager.start()).rejects.toThrow('Unable to start relay');
    expect(handle.close).toHaveBeenCalledOnce(); expect(manager.status().running).toBe(false);
  });
});

it('resolves the actual product port when starting, after bootstrap and again after restart', async () => {
  let upstream = 'http://127.0.0.1:8780';
  const start = vi.fn(async () => fakeHandle());
  const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: () => upstream, startGateway: start as unknown as typeof startMobileGateway });
  upstream = 'http://127.0.0.1:48901';
  await manager.start();
  expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ upstream }));
  await manager.stop();
  upstream = 'http://127.0.0.1:48902';
  await manager.start();
  expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ upstream }));
  await manager.close();
});

it('keeps a fresh or disconnected desktop offline even when an old client enables phone access', async () => {
  const startGateway = vi.fn();
  const manager = new MobileGatewayManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', startGateway });
  expect(manager.status()).toMatchObject({ running: false, boundLan: false, connection: { mode: 'unconfigured' } });
  await expect(manager.start()).rejects.toThrow('Remote access');
  expect(startGateway).not.toHaveBeenCalled();
  await manager.disconnectAccount(true);
  expect(manager.status()).toMatchObject({ running: false, connection: { mode: 'unconfigured' } });
  expect(startGateway).not.toHaveBeenCalled();
});
