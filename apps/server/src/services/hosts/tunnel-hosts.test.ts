import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { destroyHost, getHost, openDatabase, updateHostSshIdentity, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { HostBootstrapEvent } from './host-bootstrap.js';
import {
  closeTunnelHost,
  createDbTunnelHostStore,
  createTunnelHostReopener,
  createTunnelHostStore,
  MAX_TUNNEL_HOST_ENTRIES,
  reopenTunnelHosts,
  tunnelHostsFile,
  type TunnelHostStore
} from './tunnel-hosts.js';

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-tunnel-hosts-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const portTaken = () => Object.assign(new Error('Error: remote port forwarding failed for listen port 28888'), { code: 'peer_tunnel_port_unavailable' });

function fixture() {
  const dataDir = tempDir();
  const db: ZccDatabase = openDatabase(join(dataDir, 'state.sqlite'));
  cleanup.unshift(() => db.close());
  const primary = upsertHost(db, { name: 'Primary', hostKeyHash: 'a'.repeat(64), isPrimary: true });
  const addRemote = (name: string, ssh?: { host: string; user?: string; proxyJump?: string }) => {
    const host = upsertHost(db, { name, hostKeyHash: name.padEnd(64, 'b'), isPrimary: false });
    if (ssh) updateHostSshIdentity(db, host.id, ssh);
    return host;
  };
  const rpc = vi.fn(async (_input: { hostId: string; command: any }): Promise<unknown> => ({ ok: true }));
  const ctx = { db, dataDir, hostHub: { callHostOnlineRpc: rpc } } as unknown as ProductHttpContext;
  const store = createDbTunnelHostStore(ctx);
  const repair = vi.fn(async (_hostId: string): Promise<HostBootstrapEvent[]> => [{ type: 'done', hostId: _hostId }]);
  const log = vi.fn();
  let localPort: number | null = 43210;
  const deps = { store, localPort: () => localPort, repair, log };
  return { db, dataDir, ctx, primary, addRemote, rpc, store, repair, log, deps, setLocalPort: (port: number | null) => { localPort = port; } };
}

describe('tunnel host store', () => {
  it('persists ports atomically with private permissions and no stray temp files', () => {
    const dir = tempDir();
    const file = join(dir, 'nested', 'tunnel-hosts.json');
    const store = createTunnelHostStore(file, () => true);
    expect(store.list()).toEqual([]);
    store.record('h1', 28888);
    store.record('h2', 29999);
    store.record('h1', 30001);
    expect(store.get('h1')).toEqual({ hostId: 'h1', remotePort: 30001 });
    expect(store.get('missing')).toBeNull();
    expect(createTunnelHostStore(file, () => true).list()).toEqual([
      { hostId: 'h2', remotePort: 29999 },
      { hostId: 'h1', remotePort: 30001 }
    ]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dir, 'nested'))).toEqual(['tunnel-hosts.json']);
    store.remove('h2');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, hosts: { h1: { remotePort: 30001 } } });
  });

  it('drops removed machines, malformed entries and unreadable files on read', () => {
    const dir = tempDir();
    const file = join(dir, 'tunnel-hosts.json');
    writeFileSync(file, JSON.stringify({ version: 1, hosts: { live: { remotePort: 28888 }, gone: { remotePort: 28889 }, bad: { remotePort: 0 }, odd: 7 } }));
    const store = createTunnelHostStore(file, (hostId) => hostId !== 'gone');
    expect(store.list()).toEqual([{ hostId: 'live', remotePort: 28888 }]);
    store.remove('nothing');
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).hosts)).toEqual(['live']);
    writeFileSync(file, '{not json');
    expect(store.list()).toEqual([]);
    writeFileSync(file, JSON.stringify({ hosts: 'nope' }));
    expect(store.list()).toEqual([]);
    writeFileSync(file, 'null');
    expect(store.list()).toEqual([]);
  });

  it('rejects invalid ports and bounds how many machines it keeps', () => {
    const store = createTunnelHostStore(join(tempDir(), 'tunnel-hosts.json'), () => true);
    for (const port of [0, 65536, 1.5, NaN]) expect(() => store.record('h', port)).toThrow('Invalid tunnel port');
    for (let index = 0; index < MAX_TUNNEL_HOST_ENTRIES; index++) store.record(`h${index}`, 20000 + index);
    expect(store.list()).toHaveLength(MAX_TUNNEL_HOST_ENTRIES);
    // A new machine past the cap is refused loudly, never silently dropped.
    expect(() => store.record('h-over', 30000)).toThrow(`Too many SSH tunnel hosts (limit ${MAX_TUNNEL_HOST_ENTRIES})`);
    expect(store.get('h-over')).toBeNull();
    // Updating a machine already stored still works at the cap.
    store.record('h0', 30001);
    expect(store.get('h0')).toEqual({ hostId: 'h0', remotePort: 30001 });
    // A file written past the cap is truncated on read.
    const big = Object.fromEntries(Array.from({ length: MAX_TUNNEL_HOST_ENTRIES + 4 }, (_, i) => [`x${i}`, { remotePort: 20000 + i }]));
    const file = join(tempDir(), 'tunnel-hosts.json');
    writeFileSync(file, JSON.stringify({ version: 1, hosts: big }));
    expect(createTunnelHostStore(file, () => true).list()).toHaveLength(MAX_TUNNEL_HOST_ENTRIES);
  });

  it('cleans its temp file when a write fails', () => {
    const dir = tempDir();
    const file = join(dir, 'tunnel-hosts.json');
    const store = createTunnelHostStore(file, () => true);
    // A directory in the target's place makes the rename fail after the temp write.
    rmSync(file, { force: true });
    mkdirSync(file);
    expect(() => store.record('h1', 28888)).toThrow();
    expect(readdirSync(dir)).toEqual(['tunnel-hosts.json']);
  });

  it('keeps only live, non-primary machines from the host table', () => {
    const f = fixture();
    const remote = f.addRemote('devbox', { host: 'devbox' });
    f.store.record(remote.id, 28888);
    f.store.record(f.primary.id, 28889);
    f.store.record('unknown', 28890);
    expect(f.store.list()).toEqual([{ hostId: remote.id, remotePort: 28888 }]);
    destroyHost(f.db, remote.id);
    expect(f.store.list()).toEqual([]);
    expect(tunnelHostsFile(f.dataDir)).toBe(join(f.dataDir, 'tunnel-hosts.json'));
  });
});

describe('reopening tunnels', () => {
  it('reopens each stored tunnel through the primary with the current local port', async () => {
    const f = fixture();
    const one = f.addRemote('one', { host: 'one', user: 'me', proxyJump: 'bastion' });
    const two = f.addRemote('two', { host: 'two' });
    f.store.record(one.id, 28888);
    f.store.record(two.id, 29999);
    f.setLocalPort(51234);
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.rpc.mock.calls.map(([input]) => input)).toEqual([
      { hostId: f.primary.id, command: { type: 'peer_tunnel.open', remote: { host: 'one', user: 'me', proxyJump: 'bastion' }, localPort: 51234, remotePort: 28888 } },
      { hostId: f.primary.id, command: { type: 'peer_tunnel.open', remote: { host: 'two' }, localPort: 51234, remotePort: 29999 } }
    ]);
    expect(f.repair).not.toHaveBeenCalled();
  });

  it('does not reopen removed machines and forgets ones without an SSH identity', async () => {
    const f = fixture();
    const removed = f.addRemote('removed', { host: 'removed' });
    const anonymous = f.addRemote('anonymous');
    f.store.record(removed.id, 28888);
    f.store.record(anonymous.id, 28889);
    destroyHost(f.db, removed.id);
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(tunnelHostsFile(f.dataDir), 'utf8')).hosts).toEqual({});
  });

  it('does nothing without a primary', async () => {
    const f = fixture();
    const remote = f.addRemote('one', { host: 'one' });
    f.store.record(remote.id, 28888);
    f.db.sqlite.prepare('UPDATE hosts SET is_primary = 0').run();
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('reinstalls on a taken remote port and keeps the port the reinstall recorded', async () => {
    const f = fixture();
    const remote = f.addRemote('one', { host: 'one' });
    f.store.record(remote.id, 28888);
    f.rpc.mockRejectedValueOnce(portTaken());
    f.repair.mockImplementationOnce(async (hostId) => {
      f.store.record(hostId, 31313);
      return [{ type: 'done', hostId }];
    });
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.repair).toHaveBeenCalledWith(remote.id);
    expect(f.store.get(remote.id)).toEqual({ hostId: remote.id, remotePort: 31313 });
    expect(f.log).toHaveBeenCalledWith('Remote port for one is taken; reinstalling over a new SSH tunnel');
  });

  it('forgets the port when the reinstall moved the machine to another route', async () => {
    const f = fixture();
    const remote = f.addRemote('one', { host: 'one' });
    f.store.record(remote.id, 28888);
    f.rpc.mockRejectedValueOnce(portTaken());
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.store.get(remote.id)).toBeNull();
  });

  it('keeps the port when the reinstall fails, for the next primary connect', async () => {
    const f = fixture();
    const one = f.addRemote('one', { host: 'one' });
    const two = f.addRemote('two', { host: 'two' });
    f.store.record(one.id, 28888);
    f.store.record(two.id, 29999);
    f.rpc.mockRejectedValue(portTaken());
    f.repair.mockResolvedValueOnce([{ type: 'error', code: 'install_failed', message: 'no' }]);
    f.repair.mockRejectedValueOnce(new Error('boom'));
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.store.list()).toHaveLength(2);
    expect(f.log).toHaveBeenCalledWith('Reinstall for two threw: boom');
    expect(f.log).toHaveBeenCalledWith('Reinstalling one over SSH failed');
    expect(f.log).toHaveBeenCalledWith('Reinstalling two over SSH failed');
  });

  it('keeps going past other failures without reinstalling', async () => {
    const f = fixture();
    const one = f.addRemote('one', { host: 'one' });
    const two = f.addRemote('two', { host: 'two' });
    f.store.record(one.id, 28888);
    f.store.record(two.id, 29999);
    f.rpc.mockRejectedValueOnce(Object.assign(new Error('ssh: connect refused'), { code: 'peer_tunnel_failed' }));
    f.rpc.mockRejectedValueOnce('opaque');
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.repair).not.toHaveBeenCalled();
    expect(f.store.list()).toHaveLength(2);
    expect(f.log).toHaveBeenCalledWith('SSH tunnel for one did not reopen; it will retry when the primary reconnects (ssh: connect refused)');
    expect(f.log).toHaveBeenCalledWith('SSH tunnel for two did not reopen; it will retry when the primary reconnects (opaque)');
  });

  it('stops between machines and after a failure once cancelled', async () => {
    const f = fixture();
    f.store.record(f.addRemote('one', { host: 'one' }).id, 28888);
    f.store.record(f.addRemote('two', { host: 'two' }).id, 29999);
    let cancelled = false;
    f.rpc.mockImplementationOnce(async () => { cancelled = true; throw portTaken(); });
    await reopenTunnelHosts(f.ctx, f.deps, () => cancelled);
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.repair).not.toHaveBeenCalled();
    await reopenTunnelHosts(f.ctx, f.deps, () => true);
    expect(f.rpc).toHaveBeenCalledOnce();
  });
});

describe('reopening tunnels without a pairing listener', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('fails closed: skips every reopen, keeps the stored routes, and warns once', async () => {
    const f = fixture();
    const one = f.addRemote('one', { host: 'one' });
    f.store.record(one.id, 28888);
    f.setLocalPort(null);
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.repair).not.toHaveBeenCalled();
    expect(f.store.get(one.id)).toEqual({ hostId: one.id, remotePort: 28888 });
    expect(f.log).toHaveBeenCalledTimes(1);
    expect(f.log).toHaveBeenCalledWith('SSH tunnels not reopened: the pairing listener is not running');
  });

  it('stays quiet when nothing is stored', async () => {
    const f = fixture();
    f.setLocalPort(null);
    await reopenTunnelHosts(f.ctx, f.deps);
    expect(f.log).not.toHaveBeenCalled();
  });

  it('reopens on a later connect once the listener is back', async () => {
    const f = fixture();
    const one = f.addRemote('one', { host: 'one' });
    f.store.record(one.id, 28888);
    f.setLocalPort(null);
    const reopener = createTunnelHostReopener(() => f.ctx, f.deps);
    reopener.hostConnected(f.primary.id);
    await flush();
    expect(f.rpc).not.toHaveBeenCalled();
    f.setLocalPort(40404);
    reopener.hostConnected(f.primary.id);
    await flush();
    expect(f.rpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ type: 'peer_tunnel.open', localPort: 40404, remotePort: 28888 })
    }));
    reopener.dispose();
  });
});

describe('reopening tunnels with an unwritable store', () => {
  const brokenRemove = (store: TunnelHostStore): TunnelHostStore => ({
    ...store,
    remove: () => { throw new Error('read-only'); }
  });

  it('logs and continues when forgetting a machine without an SSH identity fails', async () => {
    const f = fixture();
    const anonymous = f.addRemote('anonymous');
    const two = f.addRemote('two', { host: 'two' });
    f.store.record(anonymous.id, 28889);
    f.store.record(two.id, 29999);
    await reopenTunnelHosts(f.ctx, { ...f.deps, store: brokenRemove(f.store) });
    expect(f.log).toHaveBeenCalledWith('Could not forget the SSH tunnel route: read-only');
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });

  it('logs when forgetting a port the reinstall abandoned fails', async () => {
    const f = fixture();
    const remote = f.addRemote('one', { host: 'one' });
    f.store.record(remote.id, 28888);
    f.rpc.mockRejectedValueOnce(portTaken());
    await expect(reopenTunnelHosts(f.ctx, { ...f.deps, store: brokenRemove(f.store) })).resolves.toBeUndefined();
    expect(f.log).toHaveBeenCalledWith('Could not forget the SSH tunnel route: read-only');
  });
});

describe('primary connect reopener', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('reacts only to the primary and coalesces connects during a pass', async () => {
    const f = fixture();
    const remote = f.addRemote('one', { host: 'one' });
    f.store.record(remote.id, 28888);
    let release!: () => void;
    f.rpc.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
    const reopener = createTunnelHostReopener(() => f.ctx, f.deps);
    reopener.hostConnected(remote.id);
    expect(f.rpc).not.toHaveBeenCalled();
    reopener.hostConnected(f.primary.id);
    await flush();
    f.setLocalPort(50000);
    reopener.hostConnected(f.primary.id);
    reopener.hostConnected(f.primary.id);
    expect(f.rpc).toHaveBeenCalledOnce();
    release();
    await flush(); await flush();
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.rpc.mock.calls[1]![0].command.localPort).toBe(50000);
    reopener.dispose();
  });

  it('ignores connects without a context or after dispose, and drops a queued pass', async () => {
    const f = fixture();
    f.store.record(f.addRemote('one', { host: 'one' }).id, 28888);
    createTunnelHostReopener(() => undefined, f.deps).hostConnected(f.primary.id);
    let release!: () => void;
    f.rpc.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
    const reopener = createTunnelHostReopener(() => f.ctx, f.deps);
    reopener.hostConnected(f.primary.id);
    await flush();
    reopener.hostConnected(f.primary.id);
    reopener.dispose();
    release();
    await flush(); await flush();
    reopener.hostConnected(f.primary.id);
    await flush();
    expect(f.rpc).toHaveBeenCalledOnce();
  });

  it('logs and recovers when a pass throws', async () => {
    const f = fixture();
    const store: TunnelHostStore = { ...f.store, list: () => { throw new Error('disk'); } };
    const reopener = createTunnelHostReopener(() => f.ctx, { ...f.deps, store });
    reopener.hostConnected(f.primary.id);
    await flush();
    expect(f.log).toHaveBeenCalledWith('Reopening SSH tunnels failed: disk');
    reopener.hostConnected(f.primary.id);
    await flush();
    expect(f.log).toHaveBeenCalledTimes(2);
    reopener.dispose();
  });
});

describe('closing a removed machine tunnel', () => {
  it('asks the primary to close the tunnel by SSH identity, then forgets the port', async () => {
    const f = fixture();
    const remote = f.addRemote('one', { host: 'one', user: 'me', proxyJump: 'bastion' });
    f.store.record(remote.id, 28888);
    const ctx = { ...f.ctx, tunnelHosts: f.store } as ProductHttpContext;
    await closeTunnelHost(ctx, getHost(f.db, remote.id)!, f.log);
    expect(f.rpc).toHaveBeenCalledWith({
      hostId: f.primary.id,
      command: { type: 'peer_tunnel.close', remote: { host: 'one', user: 'me', proxyJump: 'bastion' } },
      timeoutMs: 5000
    });
    expect(f.store.get(remote.id)).toBeNull();
    expect(f.log).not.toHaveBeenCalled();
  });

  it('still forgets the port when the primary is offline', async () => {
    const f = fixture();
    const remote = f.addRemote('one', { host: 'one' });
    f.store.record(remote.id, 28888);
    f.rpc.mockRejectedValueOnce(new Error('host offline'));
    await closeTunnelHost({ ...f.ctx, tunnelHosts: f.store } as ProductHttpContext, getHost(f.db, remote.id)!, f.log);
    expect(f.store.get(remote.id)).toBeNull();
    expect(f.log).toHaveBeenCalledWith("SSH tunnel for one did not close; it stops when this app's machine restarts (host offline)");
  });

  it('skips the primary call without a stored tunnel, an SSH identity or a store', async () => {
    const f = fixture();
    const relayed = f.addRemote('relayed', { host: 'relayed' });
    const noSsh = f.addRemote('plain');
    f.store.record(noSsh.id, 28888);
    const ctx = { ...f.ctx, tunnelHosts: f.store } as ProductHttpContext;
    await closeTunnelHost(ctx, getHost(f.db, relayed.id)!);
    await closeTunnelHost(ctx, getHost(f.db, noSsh.id)!);
    await closeTunnelHost(f.ctx, getHost(f.db, relayed.id)!);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.store.get(noSsh.id)).toBeNull();
  });

  it('tolerates an unreadable or unwritable store', async () => {
    const f = fixture();
    const remote = f.addRemote('one', { host: 'one' });
    const broken: TunnelHostStore = {
      get: () => { throw new Error('read'); },
      list: () => [],
      record: () => {},
      remove: () => { throw new Error('write'); }
    };
    await expect(closeTunnelHost({ ...f.ctx, tunnelHosts: broken } as ProductHttpContext, getHost(f.db, remote.id)!)).resolves.toBeUndefined();
    expect(f.rpc).not.toHaveBeenCalled();
    await closeTunnelHost({ ...f.ctx, tunnelHosts: broken } as ProductHttpContext, getHost(f.db, remote.id)!, f.log);
    expect(f.log).toHaveBeenCalledWith('Could not forget the SSH tunnel route: write');
  });
});
