import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductServer } from './product-server.js';

const mocks = vi.hoisted(() => ({
  forwarderFailure: undefined as unknown,
  forwarderOptions: [] as Array<{ productHost?: string } | undefined>,
  reopenerDeps: [] as Array<{ localPort: () => number | null; repair: (hostId: string) => Promise<unknown>; log?: (text: string) => void }>,
  reconcile: vi.fn(async () => 0),
  repairHost: vi.fn(async () => [])
}));

vi.mock('./pairing-forwarder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pairing-forwarder.js')>();
  return {
    ...actual,
    startPairingForwarder: async (port: number, options?: { productHost?: string }) => {
      mocks.forwarderOptions.push(options);
      if (mocks.forwarderFailure !== undefined) throw mocks.forwarderFailure;
      return actual.startPairingForwarder(port, options);
    }
  };
});
vi.mock('../services/hosts/host-bootstrap.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/hosts/host-bootstrap.js')>(),
  reconcileRemoteProjectBindings: mocks.reconcile,
  repairHost: mocks.repairHost
}));
vi.mock('../services/hosts/tunnel-hosts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/hosts/tunnel-hosts.js')>();
  return {
    ...actual,
    createTunnelHostReopener: (...args: Parameters<typeof actual.createTunnelHostReopener>) => {
      mocks.reopenerDeps.push(args[1] as never);
      return actual.createTunnelHostReopener(...args);
    }
  };
});

const { startProductServer } = await import('./product-server.js');

let server: ProductServer | undefined;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-wiring-'));
  mocks.forwarderFailure = undefined;
  mocks.forwarderOptions.length = 0;
  mocks.reopenerDeps.length = 0;
  mocks.reconcile.mockReset().mockResolvedValue(0);
  mocks.repairHost.mockReset().mockResolvedValue([]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('startProductServer pairing forwarder failure', () => {
  it.each([
    ['an Error', new Error('port busy'), 'port busy'],
    ['a non-Error value', 'plain failure', 'plain failure']
  ])('warns and boots without a pairing port when the forwarder rejects with %s', async (_name, failure, text) => {
    mocks.forwarderFailure = failure;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    expect(server.ctx.origins.pairingPort).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(`[zcc] pairing forwarder failed to start: ${text}`);
    const res = await fetch(`${server.url}api/v1/projects`);
    expect(res.status).toBe(200);
  });

  it('binds the forwarder to the product host and keeps a foreign pairingPort on close', async () => {
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    expect(mocks.forwarderOptions[0]).toEqual({ productHost: '127.0.0.1' });
    const ctx = server.ctx;
    ctx.origins.pairingPort = 1;
    await server.close();
    server = undefined;
    expect(ctx.origins.pairingPort).toBe(1);
  });

  it('passes an IPv6 loopback product host to the forwarder', async () => {
    mocks.forwarderFailure = new Error('stop here');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      server = await startProductServer({ dataDir, origins: { serverPort: 0 }, host: '::1' });
    } catch {
      return; // host without IPv6 loopback cannot bind
    }
    expect(mocks.forwarderOptions[0]).toEqual({ productHost: '::1' });
  });
});

describe('product context tunnel reopener wiring', () => {
  it('feeds the reopener the live pairing port, repair, and a warning logger', async () => {
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    const deps = mocks.reopenerDeps[0]!;
    expect(deps.localPort()).toBe(server.ctx.origins.pairingPort);
    await deps.repair('host-1');
    expect(mocks.repairHost).toHaveBeenCalledWith(server.ctx, 'host-1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    deps.log?.('Reopening SSH tunnels failed');
    expect(warn).toHaveBeenCalledWith('[zcc] Reopening SSH tunnels failed');
  });

  it('gives the reopener no port (never the product port) when the forwarder fails to start', async () => {
    mocks.forwarderFailure = new Error('port busy');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    const deps = mocks.reopenerDeps[0]!;
    expect(server.ctx.origins.serverPort).toBeGreaterThan(0);
    expect(deps.localPort()).toBeNull();
  });

  it('drops the port once the server closes', async () => {
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    const deps = mocks.reopenerDeps[0]!;
    expect(deps.localPort()).toEqual(expect.any(Number));
    await server.close();
    server = undefined;
    expect(deps.localPort()).toBeNull();
  });
});

describe('GET /api/v1/projects remote binding reconcile', () => {
  it('reconciles before listing and still answers when reconcile rejects', async () => {
    server = await startProductServer({ dataDir, origins: { serverPort: 0 } });
    const ok = await fetch(`${server.url}api/v1/projects`);
    expect(ok.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    mocks.reconcile.mockRejectedValueOnce(new Error('ssh down'));
    const failed = await fetch(`${server.url}api/v1/projects`);
    expect(failed.status).toBe(200);
    expect(await failed.json()).toHaveProperty('projects');
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  });
});
