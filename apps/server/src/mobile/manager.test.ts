import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MobileGatewayManager, type MobileGatewayManagerDeps } from './manager.js';
import { MobileDeviceStore } from './device-store.js';
import type { startMobileGateway } from './gateway.js';
import { MobileConnectionStore } from './connection.js';

const relayConfig = { mode: 'relay' as const, publicUrl: 'https://relay.example', relayToken: 'a'.repeat(43) };
function remoteManager(deps: MobileGatewayManagerDeps) {
  const store = new MobileConnectionStore(); void store.write(relayConfig);
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
      publicUrl: 'https://relay.example',
      host: '127.0.0.1',
      port: 8785,
      boundLan: false,
      error: null,
      distribution: { testFlightUrl: null },
      readySessions: [],
      connection: { mode: 'relay', publicUrl: 'https://relay.example', hasRelayToken: true },
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
    await expect(manager.start()).rejects.toThrow(/already in use.*mobile:serve/s);
    expect(manager.status().running).toBe(false);
    expect(manager.status().error).toMatch(/already in use/);
  });

  it('delegates pair/devices/revoke to the handle while running', async () => {
    const handle = fakeHandle();
    const manager = make((async () => handle) as unknown as typeof startMobileGateway);
    await manager.start();
    expect(manager.pair().code).toBe('code');
    expect(manager.devices()).toHaveLength(1);
    expect(manager.revoke('d1')).toBe(true);
    expect(handle.pair).toHaveBeenCalled();
    expect(handle.revoke).toHaveBeenCalledWith('d1');
  });

  it('rejects pairing while stopped but still reads/revokes devices from the store', async () => {
    const devices = new MobileDeviceStore();
    const added = devices.add('Phone');
    const manager = remoteManager({
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
  it('allows replacing damaged configuration without preserving an unreadable secret', async () => {
    const store = new MobileConnectionStore();
    const read = vi.spyOn(store, 'read').mockImplementation(() => { throw new Error('damaged file'); });
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', connectionStore: store });
    expect(manager.status().error).toContain('Could not read');
    await expect(manager.configure({ mode: 'relay', publicUrl: 'https://relay.example' }, false)).rejects.toThrow('relay secret');
    await manager.configure(relayConfig, false);
    read.mockRestore();
    expect(manager.status().connection?.mode).toBe('relay');
  });
  it('rejects switching an active tunnel to local access without disturbing it', async () => {
    const handle = fakeHandle(); const start = vi.fn(async () => handle);
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', startGateway: start });
    await manager.start();
    await expect(manager.configure({ mode: 'local' }, true)).rejects.toThrow('Local-network');
    expect(handle.close).not.toHaveBeenCalled();
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ host: '127.0.0.1', publicUrl: 'https://relay.example' }));
    await manager.close();
  });
  it('starts and stops the outbound relay and gates pairing on tunnel readiness', async () => {
    let state: 'connecting' | 'connected' = 'connecting';
    const close = vi.fn();
    const connect = vi.fn(() => ({ state: () => state, close }));
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', startGateway: (async () => fakeHandle()) as unknown as typeof startMobileGateway, connectRelay: connect });
    await manager.configure({ mode: 'relay', publicUrl: 'https://relay.example', relayToken: 'a'.repeat(43) }, true);
    expect(manager.status().relayState).toBe('connecting');
    expect(() => manager.pair()).toThrow(/Wait for the relay/);
    state = 'connected'; expect(manager.pair().code).toBe('code');
    expect(JSON.stringify(manager.status())).not.toContain('a'.repeat(43));
    await manager.stop(); expect(close).toHaveBeenCalledOnce();
  });
  it('serializes configure/start/stop and validates before disturbing an active connection', async () => {
    const handle = fakeHandle();
    const start = vi.fn(async () => handle);
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', startGateway: start as unknown as typeof startMobileGateway });
    await Promise.all([manager.start(), manager.start()]);
    expect(start).toHaveBeenCalledOnce();
    await expect(manager.configure({ mode: 'relay', publicUrl: 'http://bad' }, true)).rejects.toThrow();
    expect(manager.status().running).toBe(true); expect(handle.close).not.toHaveBeenCalled();
    await Promise.all([manager.configure({ mode: 'relay', publicUrl: 'https://relay.example', relayToken: 'a'.repeat(43) }, false), manager.stop()]);
    expect(manager.status().running).toBe(false); expect(handle.close).toHaveBeenCalledOnce();
  });
  it('closes the gateway if creating the tunnel fails', async () => {
    const handle = fakeHandle();
    const manager = remoteManager({ devices: new MobileDeviceStore(), upstream: 'http://127.0.0.1:8780', startGateway: (async () => handle) as unknown as typeof startMobileGateway,
      connectRelay: () => { throw new Error('Unable to start relay'); } });
    await expect(manager.configure({ mode: 'relay', publicUrl: 'https://relay.example', relayToken: 'a'.repeat(43) }, true)).rejects.toThrow('Unable to start relay');
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
