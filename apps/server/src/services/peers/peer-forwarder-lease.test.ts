import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPeerForwarderLease, type PeerForwarderLease } from './peer-forwarder-lease.js';
import type { PeerSshTransport } from './peer-ssh-contract.js';

let dir: string;
let lease: PeerForwarderLease | undefined;
let blockers: Server[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'peer-lease-'));
});

afterEach(async () => {
  await lease?.close();
  lease = undefined;
  await Promise.all(blockers.map((s) => new Promise((r) => s.close(r))));
  blockers = [];
  await rm(dir, { recursive: true, force: true });
});

function probe(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' }).then(
    (r) => r.status === 403,
    () => false
  );
}

function occupy(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => {
      blockers.push(s);
      resolve();
    });
  });
}

describe('createPeerForwarderLease', () => {
  it('satisfies the PeerSshTransport forwarder member', () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    const forwarder: PeerSshTransport['forwarder'] = lease;
    expect(typeof forwarder.acquire).toBe('function');
    expect(typeof forwarder.release).toBe('function');
  });

  it('is lazy: nothing listens until the first acquire', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    expect(lease.port).toBeNull();
    await expect(readdir(join(dir, 'peer-ssh'))).rejects.toThrow();
  });

  it('refcounts: shares one listener and stops on the last release', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    const [a, b] = await Promise.all([lease.acquire('a'), lease.acquire('b')]);
    expect(a).toBe(b);
    expect(await probe(a)).toBe(true);
    await lease.release('a');
    expect(await probe(a)).toBe(true);
    await lease.release('unknown');
    expect(await probe(a)).toBe(true);
    await lease.release('b');
    expect(lease.port).toBeNull();
    expect(await probe(a)).toBe(false);
  });

  it('acquire is idempotent per link', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: () => 9 });
    const a = await lease.acquire('a');
    expect(await lease.acquire('a')).toBe(a);
    await lease.release('a');
    expect(lease.port).toBeNull();
  });

  it('persists F and reuses it after a restart', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    const first = await lease.acquire('a');
    await lease.close();
    const file = join(dir, 'peer-ssh', 'forwarder.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ port: first });
    expect((await readdir(join(dir, 'peer-ssh'))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    const onPortChanged = vi.fn();
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9, onPortChanged });
    expect(await lease.acquire('a')).toBe(first);
    expect(onPortChanged).not.toHaveBeenCalled();
  });

  it('picks a new F and fires onPortChanged on EADDRINUSE', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    const first = await lease.acquire('a');
    await lease.close();
    await occupy(first);
    const onPortChanged = vi.fn();
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9, onPortChanged });
    const second = await lease.acquire('a');
    expect(second).not.toBe(first);
    expect(onPortChanged).toHaveBeenCalledWith(second);
    expect(JSON.parse(await readFile(join(dir, 'peer-ssh', 'forwarder.json'), 'utf8'))).toEqual({ port: second });
  });

  it('fails closed when F is busy and a live link still depends on it', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    const first = await lease.acquire('a');
    await lease.close();
    await occupy(first);
    const onPortChanged = vi.fn();
    const canRebind = vi.fn(() => false);
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9, onPortChanged, canRebind });
    await expect(lease.acquire('a')).rejects.toThrow('peer forwarder port busy');
    expect(lease.port).toBeNull();
    expect(onPortChanged).not.toHaveBeenCalled();
    // The remembered F is untouched, so authorized_keys permitopen lines still name it.
    expect(JSON.parse(await readFile(join(dir, 'peer-ssh', 'forwarder.json'), 'utf8'))).toEqual({ port: first });
  });

  it('picks a new F once canRebind allows it', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    const first = await lease.acquire('a');
    await lease.close();
    await occupy(first);
    let dependents = true;
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9, canRebind: () => !dependents });
    await expect(lease.acquire('a')).rejects.toThrow('peer forwarder port busy');
    dependents = false;
    const second = await lease.acquire('a');
    expect(second).not.toBe(first);
    expect(JSON.parse(await readFile(join(dir, 'peer-ssh', 'forwarder.json'), 'utf8'))).toEqual({ port: second });
  });

  it('does not consult canRebind when the remembered F is free', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    const first = await lease.acquire('a');
    await lease.close();
    const canRebind = vi.fn(() => false);
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9, canRebind });
    expect(await lease.acquire('a')).toBe(first);
    expect(canRebind).not.toHaveBeenCalled();
  });

  it('ignores a corrupt or out-of-range persisted port without firing onPortChanged', async () => {
    await mkdir(join(dir, 'peer-ssh'));
    const onPortChanged = vi.fn();
    for (const body of ['not json', '{"port":80}', '{"port":"x"}']) {
      await writeFile(join(dir, 'peer-ssh', 'forwarder.json'), body);
      lease = createPeerForwarderLease({ dataDir: dir, productPort: 9, onPortChanged });
      expect(await lease.acquire('a')).toBeGreaterThan(1023);
      await lease.close();
    }
    expect(onPortChanged).not.toHaveBeenCalled();
  });

  it('propagates non-EADDRINUSE start errors and leaves no holder', async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ port: 40000, close: vi.fn(async () => undefined) });
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9, start });
    await expect(lease.acquire('a')).rejects.toThrow('boom');
    expect(lease.port).toBeNull();
    expect(await lease.acquire('b')).toBe(40000);
    expect(start).toHaveBeenLastCalledWith(9, expect.objectContaining({ allow: 'peer', port: 0 }));
  });

  it('closes the forwarder when persisting F fails', async () => {
    await writeFile(join(dir, 'peer-ssh'), 'a file, so mkdir fails');
    const close = vi.fn(async () => undefined);
    const start = vi.fn().mockResolvedValue({ port: 40001, close });
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9, start });
    await expect(lease.acquire('a')).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
    expect(lease.port).toBeNull();
  });

  it('close drops all leases', async () => {
    lease = createPeerForwarderLease({ dataDir: dir, productPort: 9 });
    const port = await lease.acquire('a');
    await lease.acquire('b');
    await lease.close();
    expect(lease.port).toBeNull();
    expect(await probe(port)).toBe(false);
    await lease.release('a');
  });
});
