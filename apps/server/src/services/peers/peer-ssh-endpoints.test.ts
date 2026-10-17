import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { LocalTunnel, PeerTunnels } from '@zana-ai/zcc-host-daemon/peer-tunnels';
import { PEER_SSH_MAX_ENDPOINTS, PeerSshEndpoints } from './peer-ssh-endpoints.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const run of cleanups.splice(0).reverse()) await run(); vi.useRealTimers(); });
const KEY = `ssh-ed25519 ${'A'.repeat(68)}`;
const provider = { getKey: async () => Buffer.alloc(32, 5) };

async function fixture(reconnectMs = 5) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-ssh-endpoints-')));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  let port = 41_000;
  const handles: Array<LocalTunnel & { onClose?: () => void; drop(): void }> = [];
  const openLocal = vi.fn(async (_endpoint: unknown, _remote: number, options: { localPort?: number; onClose?: () => void; signal?: AbortSignal }) => {
    const localPort = options.localPort ?? port++;
    const handle = { localPort, url: `http://127.0.0.1:${localPort}/`, closed: false, onClose: options.onClose,
      close: vi.fn(async () => { handle.closed = true; }), drop: () => { handle.closed = true; handle.onClose?.(); } };
    handles.push(handle);
    return handle;
  });
  const tunnels = { openLocal } as unknown as PeerTunnels;
  const self = randomUUID(), peer = randomUUID();
  const make = () => {
    const endpoints = new PeerSshEndpoints({ directory: join(root, 'peer-ssh'), instanceId: self, keyProvider: provider, tunnels, reconnectMs, openTimeoutMs: 1000 });
    cleanups.push(async () => { endpoints.dispose(); await endpoints.whenIdle(); });
    return endpoints;
  };
  const endpoint = { peerInstanceId: peer, host: 'peer.example.test', port: 2222, user: 'zcc', hostKey: KEY, remoteAppPort: 4100 };
  return { root, openLocal, handles, make, endpoint, self, peer };
}

it('stores only explicit pinned endpoints encrypted and opens one reusable tunnel per peer', async () => {
  const f = await fixture(), endpoints = f.make();
  expect(await endpoints.routeFor(f.peer)).toBeNull();
  expect(f.openLocal).not.toHaveBeenCalled(); // nothing is created implicitly
  await expect(endpoints.register(f.endpoint)).resolves.toEqual(f.endpoint);
  expect(await endpoints.list()).toEqual([f.endpoint]);
  const bytes = await readFile(join(f.root, 'peer-ssh', 'ssh-endpoints-v1.bin'));
  expect(bytes.includes(Buffer.from('peer.example.test'))).toBe(false);
  const [first, second] = await Promise.all([endpoints.routeFor(f.peer), endpoints.routeFor(f.peer)]);
  expect(first).toBe('http://127.0.0.1:41000/'); expect(second).toBe(first);
  expect(await endpoints.routeFor(f.peer)).toBe(first);
  expect(f.openLocal).toHaveBeenCalledTimes(1);
  expect(f.openLocal).toHaveBeenCalledWith(f.endpoint, 4100, expect.objectContaining({ timeoutMs: 1000 }));
  // Replacing the pin drops the old tunnel so the new key applies.
  const replaced = { ...f.endpoint, hostKey: `ssh-ed25519 ${'B'.repeat(68)}` };
  await endpoints.register(replaced);
  expect(f.handles[0]!.close).toHaveBeenCalled();
  expect(await endpoints.list()).toEqual([replaced]);
  expect(await endpoints.routeFor(f.peer)).toBe('http://127.0.0.1:41001/');
  // Survives restart.
  endpoints.dispose(); await endpoints.whenIdle();
  expect(f.handles[1]!.close).toHaveBeenCalled();
  expect(await f.make().list()).toEqual([replaced]);
});

it('rejects unpinned, malformed, self and over-capacity endpoints', async () => {
  const f = await fixture(), endpoints = f.make();
  for (const bad of [{}, { ...f.endpoint, hostKey: 'ssh-ed25519' }, { ...f.endpoint, host: '-oProxyCommand=x' }, { ...f.endpoint, user: 'a b' },
    { ...f.endpoint, port: 0 }, { ...f.endpoint, identityFile: '../key' }, { ...f.endpoint, identityFile: 'relative' }, { ...f.endpoint, extra: true },
    { ...f.endpoint, peerInstanceId: f.self }]) {
    await expect(endpoints.register(bad)).rejects.toThrow('invalid pinned SSH endpoint');
  }
  await expect(endpoints.register({ ...f.endpoint, identityFile: '/home/zcc/.ssh/id_ed25519' })).resolves.toMatchObject({ identityFile: '/home/zcc/.ssh/id_ed25519' });
  for (let index = 1; index < PEER_SSH_MAX_ENDPOINTS; index++) await endpoints.register({ ...f.endpoint, peerInstanceId: randomUUID() });
  await expect(endpoints.register({ ...f.endpoint, peerInstanceId: randomUUID() })).rejects.toThrow('capacity');
  expect(await endpoints.list()).toHaveLength(PEER_SSH_MAX_ENDPOINTS);
});

it('remove drops the tunnel and the route; unknown peers report false', async () => {
  const f = await fixture(), endpoints = f.make();
  await endpoints.register(f.endpoint);
  await endpoints.routeFor(f.peer);
  await expect(endpoints.remove(randomUUID())).resolves.toBe(false);
  await expect(endpoints.remove(f.peer)).resolves.toBe(true);
  expect(f.handles[0]!.close).toHaveBeenCalled();
  expect(await endpoints.routeFor(f.peer)).toBeNull();
});

it('reopens a dropped tunnel on the same local port with bounded backoff, and stops after removal', async () => {
  const f = await fixture(), endpoints = f.make();
  await endpoints.register(f.endpoint);
  const url = await endpoints.routeFor(f.peer);
  f.openLocal.mockRejectedValueOnce(new Error('ssh exited'));
  f.handles[0]!.drop();
  // First reopen fails, the next scheduled one succeeds on the same port.
  await vi.waitFor(() => expect(f.openLocal).toHaveBeenCalledTimes(3));
  expect(f.openLocal.mock.calls.slice(1).every(call => call[2].localPort === 41000)).toBe(true);
  await vi.waitFor(async () => expect(await endpoints.routeFor(f.peer)).toBe(url));
  expect(f.openLocal).toHaveBeenCalledTimes(3);
  await endpoints.remove(f.peer);
  f.handles.at(-1)!.drop();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(f.openLocal).toHaveBeenCalledTimes(3);
});

it('a first open failure surfaces without retries, and dispose closes late tunnels and rejects calls', async () => {
  const f = await fixture(), endpoints = f.make();
  await endpoints.register(f.endpoint);
  f.openLocal.mockRejectedValueOnce(new Error('SSH tunnel failed'));
  await expect(endpoints.routeFor(f.peer)).rejects.toThrow('SSH tunnel failed');
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(f.openLocal).toHaveBeenCalledTimes(1);
  let release!: () => void;
  f.openLocal.mockImplementationOnce(async (_e, _r, options) => {
    await new Promise<void>(resolve => { release = resolve; });
    const handle = { localPort: 42_000, url: 'http://127.0.0.1:42000/', closed: false, onClose: options.onClose,
      close: vi.fn(async () => { handle.closed = true; }), drop() {} };
    f.handles.push(handle); return handle;
  });
  const pending = endpoints.routeFor(f.peer);
  await vi.waitFor(() => expect(f.openLocal).toHaveBeenCalledTimes(2));
  endpoints.dispose(); endpoints.dispose();
  release(); await pending;
  await vi.waitFor(() => expect(f.handles.at(-1)!.close).toHaveBeenCalled());
  await expect(endpoints.list()).rejects.toThrow('disposed');
  await expect(endpoints.register(f.endpoint)).rejects.toThrow('disposed');
  await expect(endpoints.remove(f.peer)).rejects.toThrow('disposed');
  await expect(endpoints.routeFor(f.peer)).rejects.toThrow('disposed');
  expect(await readdir(join(f.root, 'peer-ssh'))).toEqual(expect.arrayContaining(['ssh-endpoints-v1.bin']));
});

it('dispose during a scheduled reconnect cancels it', async () => {
  const f = await fixture(20), endpoints = f.make();
  await endpoints.register(f.endpoint);
  await endpoints.routeFor(f.peer);
  f.handles[0]!.drop();
  endpoints.dispose();
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(f.openLocal).toHaveBeenCalledTimes(1);
});
