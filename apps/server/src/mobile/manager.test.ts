import { describe, expect, it, vi } from 'vitest';
import { MobileGatewayManager, resolveMobileBinding } from './manager.js';
import { MobileDeviceStore } from './device-store.js';
import type { startMobileGateway } from './gateway.js';

type NetInfoFn = typeof import('node:os').networkInterfaces;
const ifaces = (address: string, opts: Partial<{ family: string; internal: boolean }> = {}) =>
  (() => ({
    en0: [{ family: 'IPv4', internal: false, address, ...opts } as never]
  })) as unknown as NetInfoFn;

function fakeHandle(port = 8785) {
  return {
    port,
    pair: vi.fn(() => ({ version: 1, serverUrl: 'http://x', code: 'code', expiresAt: 1 })),
    devices: vi.fn(() => [{ id: 'd1', label: 'Phone', createdAt: 0, expiresAt: 0 }]),
    revoke: vi.fn(() => true),
    close: vi.fn(async () => {})
  };
}

describe('resolveMobileBinding', () => {
  it('prefers a private LAN IPv4 and marks it LAN-bound', () => {
    expect(resolveMobileBinding(8785, ifaces('192.168.1.42'))).toEqual({
      host: '192.168.1.42',
      publicUrl: 'http://192.168.1.42:8785',
      boundLan: true
    });
  });

  it('falls back to loopback when no private IPv4 exists', () => {
    expect(resolveMobileBinding(8785, ifaces('8.8.8.8'))).toEqual({
      host: '127.0.0.1',
      publicUrl: 'http://127.0.0.1:8785',
      boundLan: false
    });
  });

  it('recognises 172.16–31 as private but not 172.32', () => {
    expect(resolveMobileBinding(1, ifaces('172.16.0.1')).boundLan).toBe(true);
    expect(resolveMobileBinding(1, ifaces('172.31.255.1')).boundLan).toBe(true);
    expect(resolveMobileBinding(1, ifaces('172.32.0.1')).boundLan).toBe(false);
  });
});

describe('MobileGatewayManager', () => {
  const binding = { host: '192.168.1.42', publicUrl: 'http://192.168.1.42:8785', boundLan: true };
  const make = (startGateway: typeof startMobileGateway) =>
    new MobileGatewayManager({
      devices: new MobileDeviceStore(),
      upstream: 'http://127.0.0.1:8780',
      startGateway,
      resolveBinding: () => binding
    });

  it('starts once and reports LAN status; a second start is a no-op', async () => {
    const start = vi.fn(async () => fakeHandle(8785)) as unknown as typeof startMobileGateway;
    const manager = make(start);
    const status = await manager.start();
    expect(status).toEqual({
      running: true,
      publicUrl: 'http://192.168.1.42:8785',
      host: '192.168.1.42',
      port: 8785,
      boundLan: true,
      error: null
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
    const manager = new MobileGatewayManager({
      devices,
      upstream: 'http://127.0.0.1:8780',
      startGateway: (async () => fakeHandle()) as unknown as typeof startMobileGateway,
      resolveBinding: () => binding
    });
    expect(() => manager.pair()).toThrow(/Enable phone access/);
    expect(manager.devices().map((d) => d.id)).toContain(added.deviceId);
    expect(manager.revoke(added.deviceId)).toBe(true);
    expect(manager.devices()).toHaveLength(0);
  });
});
