import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin from './server.js';
import { DesignDocPeerService } from './src/server/peer-service.js';
import { createTestDatabase } from './src/server/test-db.js';

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function wired() {
  const database = createTestDatabase();
  const host = createFakePluginHost({ pluginId: 'design-docs', database });
  hosts.push(host);
  host.harness.sdk.stub('peers.localIdentity', async () => ({ id: 'app-a' }));
  host.harness.sdk.stub('peers.list', async () => []);
  const warn = vi.fn();
  host.zcc.log.warn = warn;
  const start = vi.spyOn(DesignDocPeerService.prototype, 'start');
  return { host, database, warn, start };
}

async function settled() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('server fail-closed restore fencing', () => {
  // A host whose peers SDK predates storage epochs can't arm the strong rollback fence; rather than disabling
  // sync it degrades to plugin-folder evidence only and keeps running (HEAD contract; see backup.test.ts).
  it.each(['storageEpoch', 'advanceStorageEpoch'] as const)('degrades the fence but keeps sync without %s', async (method) => {
    const { host, start, warn } = wired();
    delete (host.zcc.sdk.peers as Partial<typeof host.zcc.sdk.peers>)[method];
    plugin(host.zcc);
    await settled();
    expect(start).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('restore fence degraded'));
  });

  it('degrades but keeps sync when the host returns no storage epoch', async () => {
    const { host, start, warn } = wired();
    host.harness.storageEpoch = null;
    plugin(host.zcc);
    await settled();
    expect(start).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('restore fence degraded'));
  });

  it('keeps backup available before asynchronous fence verification finishes', async () => {
    const { host } = wired();
    plugin(host.zcc);
    await expect(host.harness.callRpc('backupDatabase', {})).resolves.toMatchObject({ backupId: expect.any(String) });
  });

  it('still serves manual sync on a paired database under a degraded fence', async () => {
    const { host, database } = wired();
    delete (host.zcc.sdk.peers as Partial<typeof host.zcc.sdk.peers>).storageEpoch;
    plugin(host.zcc);
    await settled();
    database.prepare("UPDATE sync_repositories SET group_id = 'group-a', roster_epoch = 1").run();
    const prepare = vi.spyOn(DesignDocPeerService.prototype, 'syncNow');
    // Degraded (folder-evidence) fence keeps sync enabled: the call reaches syncNow and is not fence-blocked.
    await host.harness.callRpc('syncNow', {}).catch(() => {});
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('halts sync timers and blocks delivery when re-fencing fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { host, database, start, warn } = wired();
    plugin(host.zcc);
    await settled();
    expect(start).toHaveBeenCalledTimes(1);
    const delivery = vi.spyOn(DesignDocPeerService.prototype, 'deliverPending');
    host.harness.storageEpoch = 40;
    database.runScript('CREATE TABLE fence_probe (x); INSERT INTO fence_probe VALUES (1);');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('restore fence lost: storage epoch mismatch'));
    expect(vi.getTimerCount()).toBe(0);
    delivery.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(delivery).not.toHaveBeenCalled();
    await expect(host.harness.callRpc('syncNow', {})).rejects.toThrow(/fence|disabled/);
  });

  it('rejects sequence reuse after rollback inside the poll window', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { host, database, start, warn } = wired();
    plugin(host.zcc);
    await settled();
    expect(start).toHaveBeenCalledTimes(1);
    const local = database.prepare('SELECT repo_id, replica_id FROM sync_repositories LIMIT 1').get() as { repo_id: string; replica_id: string };
    database.prepare("UPDATE sync_repositories SET group_id = 'group-a', roster_epoch = 1").run();
    await host.harness.callRpc('create', { title: 'Before rollback', template: 'blank' });
    expect(database.prepare('SELECT MAX(sequence) AS top FROM sync_operations').get()).toEqual({ top: 1 });
    // Restore the same generation and epoch but an older operation frontier, before any poll runs.
    database.prepare('DELETE FROM sync_operations WHERE replica_id = ?').run(local.replica_id);
    await expect(host.harness.callRpc('create', { title: 'Reused sequence', template: 'blank' })).rejects.toThrow(/rollback|fence/);
    expect(database.prepare('SELECT MAX(sequence) AS top FROM sync_operations').get()).toEqual({ top: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('restore fence lost'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "UPDATE dd_replica_generation SET generation = 'older'",
    'UPDATE dd_writer_fence SET epoch = 0',
    'DELETE FROM dd_writer_fence'
  ])('blocks restored fence metadata before the next poll: %s', async (sql) => {
    const { host, database } = wired();
    plugin(host.zcc);
    await settled();
    database.runScript(sql);
    await expect(host.harness.callRpc('create', { title: 'After restore', template: 'blank' })).rejects.toThrow(/rollback|fence/);
  });

  it('allows ordinary consecutive mutations without losing the fence', async () => {
    const { host, database, warn } = wired();
    plugin(host.zcc);
    await settled();
    database.prepare("UPDATE sync_repositories SET group_id = 'group-a', roster_epoch = 1").run();
    await host.harness.callRpc('create', { title: 'First', template: 'blank' });
    await host.harness.callRpc('create', { title: 'Second', template: 'blank' });
    expect(database.prepare('SELECT MAX(sequence) AS top FROM sync_operations').get()).toEqual({ top: 2 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps writes enabled after a successful two-phase re-fence', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { host, database, warn } = wired();
    plugin(host.zcc);
    await settled();
    await host.harness.callRpc('create', { title: 'First', template: 'blank' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(host.harness.storageEpoch).toBe(2);
    await host.harness.callRpc('create', { title: 'Second', template: 'blank' });
    expect(database.prepare('SELECT epoch, pending FROM dd_writer_fence').get()).toEqual({ epoch: 2, pending: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects reads and manual sync after generation rollback, not only local mutations', async () => {
    const { host, database, warn } = wired();
    plugin(host.zcc);
    await settled();
    database.runScript("UPDATE dd_replica_generation SET generation = 'restored'");
    await expect(host.harness.callRpc('syncNow', {})).rejects.toThrow('database rollback detected');
    await expect(host.harness.callRpc('list', {})).rejects.toThrow('database rollback detected');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never starts after disposal during identity lookup', async () => {
    const { host, start } = wired();
    let resolve!: (identity: { id: string }) => void;
    host.harness.sdk.stub('peers.localIdentity', () => new Promise((done) => { resolve = done; }));
    plugin(host.zcc);
    await host.harness.dispose();
    resolve({ id: 'app-a' });
    await settled();
    expect(start).not.toHaveBeenCalled();
  });

  it.each([new Error('identity failure'), 'gone'])('surfaces identity failure: %s', async (error) => {
    const { host, start, warn } = wired();
    host.harness.sdk.stub('peers.localIdentity', async () => { throw error; });
    plugin(host.zcc);
    await settled();
    expect(start).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('peer sync disabled'));
  });

  it('surfaces non-Error maintenance failures and stops all peer timers', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { host, warn } = wired();
    plugin(host.zcc);
    await settled();
    host.harness.sdk.stub('peers.advanceStorageEpoch', async () => { throw 'lost'; });
    await host.harness.callRpc('create', { title: 'Changed', template: 'blank' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(warn).toHaveBeenCalledWith('design docs restore fence lost: unknown error; restart to re-verify');
    expect(vi.getTimerCount()).toBe(0);
  });
});
