import { randomBytes } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDatabase } from '../../../../packages/db/src/sqlite.js';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createPluginApi, type PluginHandle } from '../../../../apps/server/src/plugins/plugin-api.js';
import { PluginStorageEpochs } from '../../../../apps/server/src/services/peers/plugin-storage-epochs.js';
import plugin from '../../server.js';
import { DesignDocBackups, REPLICA_BINDING_KEY, type StorageEpochs } from './backup.js';
import { DesignDocPeerGroup } from './peer-group.js';
import { createRpcHandlers } from './rpc.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const roots: string[] = [];
const handles: PluginHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const actor = { kind: 'user' as const, label: 'You', threadId: null };

async function folder(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dd-backup-')));
  roots.push(root);
  return root;
}

/** One app load over a plugin data folder, wired like server.ts. */
function load(dir: string) {
  const handle = createPluginApi('design-docs', dir);
  handles.push(handle);
  const db = handle.api.storage.database();
  let group!: DesignDocPeerGroup;
  const store = new DesignDocStore(db, { onMutation: (mutation) => group.sync.recordLocalMutation(mutation) });
  group = new DesignDocPeerGroup(db);
  const backups = new DesignDocBackups(db, group.sync, { kv: handle.api.storage.kv, backup: (options) => handle.api.storage.backupDatabase(options) });
  return { handle, db, store, group, backups };
}

/** Puts a backup (or raw copy) where the plugin's live database lives, as an operator restore would. */
async function restoreInto(dir: string, file: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const suffix of ['-wal', '-shm']) await rm(join(dir, `data.db${suffix}`), { force: true });
  await copyFile(file, join(dir, 'data.db'));
}

async function closeLoad(app: ReturnType<typeof load>): Promise<void> {
  handles.splice(handles.indexOf(app.handle), 1);
  await app.handle.dispose();
}

/** Copies the live file without the host's marker, as a filesystem copy would. */
async function rawCopy(dir: string, to: string): Promise<string> {
  const db = createSqliteDatabase(join(dir, 'data.db'));
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  await copyFile(join(dir, 'data.db'), to);
  return to;
}

describe('DesignDocBackups', () => {
  it('takes a consistent backup while documents keep being written', async () => {
    const dir = await folder();
    const app = load(dir);
    await app.backups.verifyRestore(app.group, 'app-a');
    const local = app.group.sync.localRepository()!;
    // Joined to a group, so every write is also journalled as an operation.
    app.group.sync.setGroup(local.repoId, 'group-a', [
      { replicaId: local.replicaId, machineId: 'app-a', sponsorReplicaId: null, joinedAt: 1 },
      { replicaId: 'replica-b', machineId: 'app-b', sponsorReplicaId: local.replicaId, joinedAt: 2 }]);
    for (let i = 0; i < 40; i++) app.store.create({ title: `Before ${i}`, template: 'blank', files: [{ path: 'index.md', content: 'x'.repeat(20_000) }] }, actor);
    let writing = true, written = 0;
    const writer = (async () => {
      while (writing) {
        app.store.create({ title: `During ${written++}`, template: 'blank', files: [{ path: 'index.md', content: 'y'.repeat(5_000) }] }, actor);
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    const record = await app.backups.create('app-a');
    writing = false;
    await writer;
    expect(written).toBeGreaterThan(0);
    expect(record).toMatchObject({ peerId: 'app-a', replicaId: app.group.sync.localRepository()!.replicaId, name: expect.stringMatching(/^design-docs-\d+-/) });
    const copy = createSqliteDatabase(record.path, { readonly: true });
    try {
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      // Every copied document has its file and its journal entry; a torn copy would split them.
      expect(copy.prepare('SELECT COUNT(*) AS n FROM docs WHERE id NOT IN (SELECT doc_id FROM doc_files)').get()).toEqual({ n: 0 });
      const ops = copy.prepare('SELECT COUNT(*) AS n, MAX(sequence) AS top FROM sync_operations WHERE replica_id = ?').get(record.replicaId) as { n: number; top: number };
      expect(ops.n).toBeGreaterThanOrEqual(40);
      expect(ops.n).toBe(ops.top);
      expect((copy.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number }).n).toBeGreaterThanOrEqual(40);
      expect(copy.prepare('SELECT backup_id FROM _zcc_backup').get()).toEqual({ backup_id: record.backupId });
    } finally { copy.close(); }
    expect(app.backups.list().backups).toEqual([record]);
  });

  it('quarantines the writer when a backup is restored on the same app, once', async () => {
    const dir = await folder();
    const first = load(dir);
    expect(await first.backups.verifyRestore(first.group, 'app-a')).toEqual({ restored: false, reason: null });
    const local = first.group.sync.localRepository()!;
    first.group.enable('app-a', 'app-b', local.repoId, 'replica-b');
    first.store.create({ title: 'Kept', template: 'blank' }, actor);
    const record = await first.backups.create('app-a');
    await closeLoad(first);
    await restoreInto(dir, record.path);

    const restored = load(dir);
    expect(await restored.backups.verifyRestore(restored.group, 'app-a')).toEqual({ restored: true, reason: 'backup-marker' });
    const after = restored.group.sync.localRepository()!;
    expect(after.replicaId).not.toBe(local.replicaId);
    expect(after.repoId).toBe(local.repoId);
    expect(restored.group.localPeerId()).toBeNull();
    expect(restored.group.consent()).toBeNull();
    expect(restored.store.list({}).map((doc) => doc.title)).toContain('Kept');
    expect(restored.db.prepare("SELECT name FROM sqlite_master WHERE name = '_zcc_backup'").get()).toBeUndefined();
    expect(restored.db.prepare('SELECT previous_peer_id, current_peer_id, previous_replica_id, new_replica_id FROM sync_restore_events').all())
      .toEqual([{ previous_peer_id: 'app-a', current_peer_id: 'app-a', previous_replica_id: local.replicaId, new_replica_id: after.replicaId }]);
    expect(restored.backups.list().restores).toEqual([expect.objectContaining({ reason: 'backup-marker', backupId: record.backupId,
      backupCreatedAt: record.createdAt, previousReplicaId: local.replicaId, replicaId: after.replicaId })]);
    expect(await restored.handle.api.storage.kv.get(REPLICA_BINDING_KEY)).toMatchObject({ replicaId: after.replicaId });
    // Handled restores are not repeated on the next load.
    expect(await restored.backups.verifyRestore(restored.group, 'app-a')).toEqual({ restored: false, reason: null });
    expect(restored.group.sync.localRepository()!.replicaId).toBe(after.replicaId);
  });

  it('fences a clone that keeps the same replica id under a new app identity', async () => {
    const source = await folder(), clone = await folder();
    const a = load(source);
    await a.backups.verifyRestore(a.group, 'app-a');
    const original = a.group.sync.localRepository()!;
    a.group.enable('app-a', 'app-b', original.repoId, 'replica-b');
    const record = await a.backups.create('app-a');
    const raw = await rawCopy(source, join(clone, 'raw.db'));

    await restoreInto(join(clone, 'from-backup'), record.path);
    const fromBackup = load(join(clone, 'from-backup'));
    expect(fromBackup.group.sync.localRepository()!.replicaId).toBe(original.replicaId);
    expect(await fromBackup.backups.verifyRestore(fromBackup.group, 'app-c')).toEqual({ restored: true, reason: 'backup-marker' });
    expect(fromBackup.group.sync.localRepository()!.replicaId).not.toBe(original.replicaId);

    await restoreInto(join(clone, 'raw'), raw);
    const fromRaw = load(join(clone, 'raw'));
    expect(fromRaw.group.sync.localRepository()!.replicaId).toBe(original.replicaId);
    expect(await fromRaw.backups.verifyRestore(fromRaw.group, 'app-c')).toEqual({ restored: true, reason: 'app-identity' });
    expect(fromRaw.group.sync.localRepository()!.replicaId).not.toBe(original.replicaId);
    expect(fromRaw.group.localPeerId()).toBeNull();
    expect(fromRaw.backups.list().restores[0]).toMatchObject({ reason: 'app-identity', backupId: null, previousReplicaId: original.replicaId });
    // The source keeps running as itself.
    expect(await a.backups.verifyRestore(a.group, 'app-a')).toEqual({ restored: false, reason: null });
    expect(a.group.sync.localRepository()!.replicaId).toBe(original.replicaId);
  });

  it('detects a raw copy rolled back over a later run on the same app', async () => {
    const dir = await folder(), spare = await folder();
    const first = load(dir);
    await first.backups.verifyRestore(first.group, 'app-a');
    const replicaId = first.group.sync.localRepository()!.replicaId;
    await closeLoad(first);
    const old = await rawCopy(dir, join(spare, 'old.db'));
    const second = load(dir);
    expect(await second.backups.verifyRestore(second.group, 'app-a')).toEqual({ restored: false, reason: null });
    await closeLoad(second);
    await restoreInto(dir, old);
    const rolledBack = load(dir);
    expect(rolledBack.group.sync.localRepository()!.replicaId).toBe(replicaId);
    expect(await rolledBack.backups.verifyRestore(rolledBack.group, 'app-a')).toEqual({ restored: true, reason: 'generation' });
    expect(rolledBack.group.sync.localRepository()!.replicaId).not.toBe(replicaId);
  });

  it('detects a database bound to another replica but not its own interrupted quarantine', async () => {
    const db = createTestDatabase(); new DesignDocStore(db);
    const group = new DesignDocPeerGroup(db);
    const kv = new Map<string, unknown>();
    const store = { get: async <T>(key: string) => kv.get(key) as T | undefined, set: async (key: string, value: unknown) => { kv.set(key, value); } };
    const backups = new DesignDocBackups(db, group.sync, { kv: store });
    kv.set(REPLICA_BINDING_KEY, { replicaId: 'some-other-replica', generation: 'g' });
    expect(await backups.verifyRestore(group, 'app-a')).toEqual({ restored: true, reason: 'replica-binding' });
    // Crash after the quarantine committed but before the binding moved: the event proves it was ours.
    const previous = (db.prepare('SELECT previous_replica_id FROM dd_backup_restores').get() as { previous_replica_id: string }).previous_replica_id;
    kv.set(REPLICA_BINDING_KEY, { replicaId: previous, generation: 'g' });
    expect(await backups.verifyRestore(group, 'app-a')).toEqual({ restored: false, reason: null });
    // Crash between the binding's two phases: either generation is accepted.
    const binding = kv.get(REPLICA_BINDING_KEY) as { replicaId: string; generation: string };
    kv.set(REPLICA_BINDING_KEY, { replicaId: binding.replicaId, generation: 'stale', next: binding.generation });
    expect(await backups.verifyRestore(group, 'app-a')).toEqual({ restored: false, reason: null });
  });

  it('fails closed on an empty marker table and bounds evidence rows', async () => {
    const db = createTestDatabase(); new DesignDocStore(db);
    const group = new DesignDocPeerGroup(db);
    const kv = new Map<string, unknown>();
    let n = 0;
    const backups = new DesignDocBackups(db, group.sync, {
      kv: { get: async <T>(key: string) => kv.get(key) as T | undefined, set: async (key: string, value: unknown) => { kv.set(key, value); } },
      backup: async ({ name }) => ({ backupId: `b${++n}`, name, path: `/x/${name}.db`, bytes: 1, sha256: 'a'.repeat(64), createdAt: n }),
      now: () => 1000 + n
    });
    db.runScript('CREATE TABLE _zcc_backup (backup_id TEXT, plugin_id TEXT, created_at INTEGER)');
    expect(await backups.verifyRestore(group, 'app-a')).toEqual({ restored: true, reason: 'backup-marker' });
    expect(backups.list().restores[0]).toMatchObject({ backupId: 'unknown', backupCreatedAt: 0 });
    for (let i = 0; i < 70; i++) {
      db.runScript("CREATE TABLE _zcc_backup (backup_id TEXT, plugin_id TEXT, created_at INTEGER); INSERT INTO _zcc_backup VALUES ('m', 'design-docs', 5);");
      await backups.verifyRestore(group, 'app-a');
    }
    expect(backups.list().restores).toHaveLength(64);
    for (let i = 0; i < 10; i++) await backups.create(null, new AbortController().signal);
    expect(backups.list().backups.map((row) => row.backupId)).toEqual(['b10', 'b9', 'b8', 'b7', 'b6', 'b5', 'b4', 'b3']);
  });

  it('reports a missing host capability through rpc', async () => {
    const db = createTestDatabase();
    const store = new DesignDocStore(db);
    const group = new DesignDocPeerGroup(db);
    const backups = new DesignDocBackups(db, group.sync, { kv: { get: async () => undefined, set: async () => {} } });
    expect(backups.available).toBe(false);
    await expect(backups.create(null)).rejects.toThrow('unavailable');
    const sdk = {} as Parameters<typeof createRpcHandlers>[0]['sdk'];
    await expect(Promise.resolve().then(() => createRpcHandlers({ store, changed: () => {}, sdk, backups }).backupDatabase({}))).rejects.toThrow('database backup is unavailable');
    expect(createRpcHandlers({ store, changed: () => {}, sdk }).backups({})).toEqual({ backups: [], restores: [] });
  });
});

/** One app's core-held epoch store, outside every plugin folder, as product-context builds it. */
async function appEpochs(appId: string): Promise<{ appId: string; epochs: PluginStorageEpochs }> {
  const root = await folder(), key = randomBytes(32);
  return { appId, epochs: new PluginStorageEpochs({ directory: join(root, 'plugin-storage-epochs'), instanceId: appId, keyProvider: { getKey: async () => key } }) };
}

/** A load wired through the real host `peers.storageEpoch` / `advanceStorageEpoch`. */
function loadFenced(dir: string, app: { appId: string; epochs: PluginStorageEpochs }) {
  const handle = createPluginApi('design-docs', dir, { productContext: { productInstanceId: app.appId, pluginStorageEpochs: app.epochs } as never });
  handles.push(handle);
  const db = handle.api.storage.database();
  let group!: DesignDocPeerGroup;
  const store = new DesignDocStore(db, { onMutation: (mutation) => group.sync.recordLocalMutation(mutation) });
  group = new DesignDocPeerGroup(db);
  const peers = handle.api.sdk.peers;
  const backups = new DesignDocBackups(db, group.sync, { kv: handle.api.storage.kv,
    epochs: { current: () => peers.storageEpoch!(), advance: (expected) => peers.advanceStorageEpoch!(expected) } });
  return { handle, db, store, group, backups, verify: () => backups.verifyRestore(group, app.appId) };
}

/** Restores an entire plugin data folder (database, WAL, KV binding, settings) from a snapshot. */
async function restoreFolder(dir: string, snapshot: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await cp(snapshot, dir, { recursive: true });
}

function memoryEpochs(start: number | null = 0) {
  const state = { value: start, crash: null as null | 'before' | 'after', advances: 0 };
  const epochs: StorageEpochs = {
    current: async () => state.value,
    advance: async (expected) => {
      if (state.crash === 'before') { state.crash = null; throw new Error('crash before core advance'); }
      if (state.value !== expected) throw new Error('storage epoch mismatch');
      state.value = expected + 1; state.advances++;
      if (state.crash === 'after') { state.crash = null; throw new Error('crash after core advance'); }
      return state.value;
    }
  };
  return { state, epochs };
}

function memoryKv() {
  const kv = new Map<string, unknown>();
  return { get: async <T>(key: string) => kv.get(key) as T | undefined, set: async (key: string, value: unknown) => { kv.set(key, value); } };
}

describe('DesignDocBackups core storage-epoch fence', () => {
  it('detects a whole plugin-folder rollback that restores the KV binding with the database', async () => {
    const dir = await folder(), spare = await folder(), app = await appEpochs('app-a');
    const first = loadFenced(dir, app);
    expect(await first.verify()).toEqual({ restored: false, reason: null });
    first.store.create({ title: 'Old', template: 'blank' }, actor);
    const replicaId = first.group.sync.localRepository()!.replicaId;
    await closeLoad(first);
    const snapshot = join(spare, 'folder');
    await cp(dir, snapshot, { recursive: true });

    const second = loadFenced(dir, app);
    expect(await second.verify()).toEqual({ restored: false, reason: null });
    second.store.create({ title: 'Newer', template: 'blank' }, actor);
    await closeLoad(second);
    await restoreFolder(dir, snapshot);

    const rolledBack = loadFenced(dir, app);
    // The restored KV binding agrees with the restored database; only the core epoch disagrees.
    expect(await rolledBack.handle.api.storage.kv.get(REPLICA_BINDING_KEY)).toMatchObject({ replicaId });
    expect(await rolledBack.verify()).toEqual({ restored: true, reason: 'storage-epoch' });
    expect(rolledBack.group.sync.localRepository()!.replicaId).not.toBe(replicaId);
    expect(rolledBack.store.list({}).map((doc) => doc.title)).toEqual(['Old']);
    expect(rolledBack.backups.list().restores[0]).toMatchObject({ reason: 'storage-epoch', previousReplicaId: replicaId });
    expect(rolledBack.backups.fenceStatus()).toBe('bound');
    // Handled once.
    expect(await rolledBack.verify()).toEqual({ restored: false, reason: null });
  });

  it('does not flag normal restarts and advances the core epoch once per load', async () => {
    const dir = await folder(), app = await appEpochs('app-a');
    let replicaId: string | undefined;
    for (let run = 1; run <= 3; run++) {
      const load = loadFenced(dir, app);
      expect(await load.verify()).toEqual({ restored: false, reason: null });
      replicaId ??= load.group.sync.localRepository()!.replicaId;
      expect(load.group.sync.localRepository()!.replicaId).toBe(replicaId);
      expect(load.backups.list().fence).toBe('bound');
      expect(await app.epochs.current('design-docs')).toBe(run);
      await closeLoad(load);
    }
  });

  it('detects a never-paired raw clone loaded under another app', async () => {
    const source = await folder(), clone = await folder();
    const a = await appEpochs('app-a'), c = await appEpochs('app-c');
    const original = loadFenced(source, a);
    await original.verify();
    const replicaId = original.group.sync.localRepository()!.replicaId;
    expect(original.group.localPeerId()).toBeNull();
    await closeLoad(original);
    await cp(source, join(clone, 'copy'), { recursive: true });
    const copied = loadFenced(join(clone, 'copy'), c);
    expect(await copied.verify()).toEqual({ restored: true, reason: 'app-identity' });
    expect(copied.group.sync.localRepository()!.replicaId).not.toBe(replicaId);
    // The clone is now fenced to its own app; the source keeps running as itself.
    expect(await copied.verify()).toEqual({ restored: false, reason: null });
    const again = loadFenced(source, a);
    expect(await again.verify()).toEqual({ restored: false, reason: null });
    expect(again.group.sync.localRepository()!.replicaId).toBe(replicaId);
  });

  it('fences a raw copy taken mid-run once the run kept writing, with no later run', async () => {
    const dir = await folder(), spare = await folder(), app = await appEpochs('app-a');
    const live = loadFenced(dir, app);
    await live.verify();
    const stop = live.backups.maintainFence(() => { throw new Error('unexpected loss'); }, 5);
    const copy = await rawCopy(dir, join(spare, 'mid-run.db'));
    // No change since the copy: maintenance does not advance, so an identical copy stays acceptable.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await app.epochs.current('design-docs')).toBe(1);
    live.store.create({ title: 'After copy', template: 'blank' }, actor);
    await vi.waitFor(async () => expect(await app.epochs.current('design-docs')).toBe(2));
    stop();
    await closeLoad(live);
    await restoreInto(dir, copy);
    const restored = loadFenced(dir, app);
    expect(await restored.verify()).toEqual({ restored: true, reason: 'storage-epoch' });
  });

  it('is crash-safe on either side of the core advance', async () => {
    const db = createTestDatabase(); new DesignDocStore(db);
    const group = new DesignDocPeerGroup(db), { state, epochs } = memoryEpochs();
    const backups = new DesignDocBackups(db, group.sync, { kv: memoryKv(), epochs });
    await backups.verifyRestore(group, 'app-a');
    state.crash = 'before';
    await expect(backups.verifyRestore(group, 'app-a')).rejects.toThrow('crash before');
    expect(await backups.verifyRestore(group, 'app-a')).toEqual({ restored: false, reason: null });
    state.crash = 'after';
    await expect(backups.verifyRestore(group, 'app-a')).rejects.toThrow('crash after');
    expect(db.prepare('SELECT epoch, pending FROM dd_writer_fence').get()).toEqual({ epoch: state.value! - 1, pending: state.value });
    expect(await backups.verifyRestore(group, 'app-a')).toEqual({ restored: false, reason: null });
    expect(db.prepare('SELECT epoch, pending FROM dd_writer_fence').get()).toEqual({ epoch: state.value, pending: null });
  });

  it('flags a database ahead of core and a shared, never-fenced database on a fenced app', async () => {
    const db = createTestDatabase(); new DesignDocStore(db);
    const group = new DesignDocPeerGroup(db), { state, epochs } = memoryEpochs(4);
    const backups = new DesignDocBackups(db, group.sync, { kv: memoryKv(), epochs });
    await backups.verifyRestore(group, 'app-a');
    state.value = 2;
    expect(await backups.verifyRestore(group, 'app-a')).toEqual({ restored: true, reason: 'storage-epoch' });

    const fresh = createTestDatabase(); new DesignDocStore(fresh);
    const freshGroup = new DesignDocPeerGroup(fresh);
    expect(await new DesignDocBackups(fresh, freshGroup.sync, { kv: memoryKv(), epochs: memoryEpochs(7).epochs })
      .verifyRestore(freshGroup, 'app-a')).toEqual({ restored: false, reason: null });

    const shared = createTestDatabase(); new DesignDocStore(shared);
    const sharedGroup = new DesignDocPeerGroup(shared), local = sharedGroup.sync.localRepository()!;
    sharedGroup.enable('app-a', 'app-b', local.repoId, 'replica-b');
    expect(await new DesignDocBackups(shared, sharedGroup.sync, { kv: memoryKv(), epochs: memoryEpochs(7).epochs })
      .verifyRestore(sharedGroup, 'app-a')).toEqual({ restored: true, reason: 'storage-epoch' });
    // Before the app ever fenced (epoch zero), the same database is just bound.
    const legacy = createTestDatabase(); new DesignDocStore(legacy);
    const legacyGroup = new DesignDocPeerGroup(legacy), legacyLocal = legacyGroup.sync.localRepository()!;
    legacyGroup.enable('app-a', 'app-b', legacyLocal.repoId, 'replica-b');
    expect(await new DesignDocBackups(legacy, legacyGroup.sync, { kv: memoryKv(), epochs: memoryEpochs(0).epochs })
      .verifyRestore(legacyGroup, 'app-a')).toEqual({ restored: false, reason: null });
  });

  it('reports a degraded fence without the capability and keeps the plugin-folder checks', async () => {
    const db = createTestDatabase(); new DesignDocStore(db);
    const group = new DesignDocPeerGroup(db);
    for (const deps of [{ kv: memoryKv() }, { kv: memoryKv(), epochs: memoryEpochs(null).epochs }]) {
      const backups = new DesignDocBackups(db, group.sync, deps);
      expect(backups.fenceStatus()).toBe('unverified');
      await backups.verifyRestore(group, 'app-a');
      expect(backups.fenceStatus()).toBe('degraded');
      expect(backups.list().fence).toBe('degraded');
      const stop = backups.maintainFence(() => {}, 1);
      stop();
    }
    const kv = memoryKv();
    await kv.set(REPLICA_BINDING_KEY, { replicaId: 'another', generation: 'g' });
    expect(await new DesignDocBackups(db, group.sync, { kv }).verifyRestore(group, 'app-a')).toEqual({ restored: true, reason: 'replica-binding' });
  });

  it('survives an onLost callback that throws', async () => {
    const db = createTestDatabase(); const store = new DesignDocStore(db);
    const group = new DesignDocPeerGroup(db), { state, epochs } = memoryEpochs();
    const backups = new DesignDocBackups(db, group.sync, { kv: memoryKv(), epochs });
    await backups.verifyRestore(group, 'app-a');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    backups.maintainFence(() => { throw new Error('callback boom'); }, 2);
    state.value = 99;
    store.create({ title: 'Changed', template: 'blank' }, actor);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('fence-lost callback failed'), expect.objectContaining({ message: 'callback boom' })));
    expect(backups.fenceStatus()).toBe('lost');
    warn.mockRestore();
  });

  it('marks the fence lost when a running re-fence fails, and ignores failures after stop', async () => {
    const db = createTestDatabase(); const store = new DesignDocStore(db);
    const group = new DesignDocPeerGroup(db), { state, epochs } = memoryEpochs();
    const backups = new DesignDocBackups(db, group.sync, { kv: memoryKv(), epochs });
    await backups.verifyRestore(group, 'app-a');
    const lost = vi.fn();
    backups.maintainFence(lost, 2);
    state.value = 99;
    store.create({ title: 'Changed', template: 'blank' }, actor);
    await vi.waitFor(() => expect(lost).toHaveBeenCalledWith(expect.objectContaining({ message: 'storage epoch mismatch' })));
    expect(backups.fenceStatus()).toBe('lost');
    expect(lost).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    let release!: () => void;
    const slow = new DesignDocBackups(db, group.sync, { kv: memoryKv(), epochs: { current: async () => 99,
      advance: async (expected) => { if (expected === 99) return 100; await new Promise<void>((done) => { release = done; }); throw new Error('late'); } } });
    await slow.verifyRestore(group, 'app-a');
    const stop = slow.maintainFence(late, 2);
    store.create({ title: 'Again', template: 'blank' }, actor);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    stop();
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(late).not.toHaveBeenCalled();
    expect(slow.fenceStatus()).toBe('bound');
  });
});

describe('design-docs server backup wiring', () => {
  it('exposes backup rpc on the plugin and checks restores before peer sync starts', async () => {
    const host = createFakePluginHost({ pluginId: 'design-docs', database: createTestDatabase() });
    host.harness.sdk.stub('peers.localIdentity', async () => ({ id: 'app-a' }));
    host.harness.sdk.stub('peers.list', async () => []);
    plugin(host.zcc);
    const record = await host.harness.callRpc('backupDatabase', {}) as { backupId: string };
    expect(host.harness.backups).toHaveLength(1);
    expect(record.backupId).toBe(host.harness.backups[0]!.backupId);
    expect(await host.harness.callRpc('backups', {})).toMatchObject({ backups: [expect.objectContaining({ backupId: record.backupId })] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(host.harness.kv.get(REPLICA_BINDING_KEY)).toMatchObject({ replicaId: expect.any(String), generation: expect.any(String) });
    await host.harness.dispose();
  });

  function wired(identity: () => Promise<{ id: string }>, prepare: (host: ReturnType<typeof createFakePluginHost>) => void = () => {}) {
    const database = createTestDatabase();
    const host = createFakePluginHost({ pluginId: 'design-docs', database });
    const warn = vi.fn();
    host.zcc.log.warn = warn;
    host.harness.sdk.stub('peers.localIdentity', identity);
    host.harness.sdk.stub('peers.list', async () => []);
    prepare(host);
    return { host, warn, database };
  }

  it('warns and detaches when the loaded database is a restored backup', async () => {
    const { host, warn, database } = wired(async () => ({ id: 'app-a' }));
    database.runScript("CREATE TABLE _zcc_backup (backup_id TEXT, plugin_id TEXT, created_at INTEGER); INSERT INTO _zcc_backup VALUES ('b1', 'design-docs', 5);");
    plugin(host.zcc);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('restored or copied (backup-marker)')));
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = '_zcc_backup'").get()).toBeUndefined();
    await host.harness.dispose();
  });

  it('does not start peer sync when disposed before identity resolves, and fails closed on identity errors', async () => {
    let resolve!: (value: { id: string }) => void;
    const slow = wired(() => new Promise((done) => { resolve = done; }));
    plugin(slow.host.zcc);
    await slow.host.harness.dispose();
    resolve({ id: 'app-a' });
    await new Promise((done) => setTimeout(done, 10));
    expect(slow.host.harness.sdk.callsTo('peers.list')).toEqual([]);

    const failing = wired(async () => { throw new Error('no identity'); });
    plugin(failing.host.zcc);
    await vi.waitFor(() => expect(failing.warn).toHaveBeenCalledWith('design docs peer sync disabled: no identity'));
    await failing.host.harness.dispose();

    const opaque = wired(async () => { throw 'gone'; });
    plugin(opaque.host.zcc);
    await vi.waitFor(() => expect(opaque.warn).toHaveBeenCalledWith('design docs peer sync disabled: identity unavailable'));
    await opaque.host.harness.dispose();
  });

  it('stops before answering peers when disposed while the restore check finishes', async () => {
    let disposing: Promise<void> | undefined;
    const { host } = wired(async () => ({ id: 'app-a' }), (h) => {
      const set = h.zcc.storage.kv.set.bind(h.zcc.storage.kv);
      h.zcc.storage.kv.set = async (key: string, value: unknown) => {
        await set(key, value);
        // The final binding write is the last step of the check; dispose lands right after it.
        if (key === REPLICA_BINDING_KEY && !(value as { next?: string }).next) disposing = h.harness.dispose();
      };
    });
    plugin(host.zcc);
    await vi.waitFor(() => expect(disposing).toBeDefined());
    await disposing;
    await new Promise((done) => setTimeout(done, 10));
    expect(host.harness.sdk.callsTo('peers.list')).toEqual([]);
  });

  it('binds the database to the host storage epoch on load, and re-fences while running', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { host, warn } = wired(async () => ({ id: 'app-a' }));
      plugin(host.zcc);
      await vi.waitFor(async () => expect(await host.harness.callRpc('backups', {})).toMatchObject({ fence: 'bound' }));
      expect(host.harness.storageEpoch).toBe(1);
      host.zcc.storage.database().runScript("CREATE TABLE IF NOT EXISTS fence_probe (x); INSERT INTO fence_probe VALUES (1);");
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => expect(host.harness.storageEpoch).toBe(2));
      // Core moved underneath the running writer: maintenance stops and says so.
      host.harness.storageEpoch = 40;
      host.zcc.storage.database().runScript('INSERT INTO fence_probe VALUES (2);');
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('design docs restore fence lost: storage epoch mismatch; restart to re-verify'));
      await host.harness.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('warns that the fence is degraded on a host without a storage epoch', async () => {
    const { host, warn } = wired(async () => ({ id: 'app-a' }), (h) => { h.harness.storageEpoch = null; });
    plugin(host.zcc);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('restore fence degraded')));
    expect(await host.harness.callRpc('backups', {})).toMatchObject({ fence: 'degraded' });
    await host.harness.dispose();
  });

  it('fails closed without starting peer sync when the storage epoch cannot advance', async () => {
    const { host, warn } = wired(async () => ({ id: 'app-a' }), (h) => {
      h.harness.sdk.stub('peers.advanceStorageEpoch', async () => { throw new Error('storage epoch mismatch'); });
    });
    plugin(host.zcc);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('design docs peer sync disabled: storage epoch mismatch'));
    expect(host.harness.storageEpoch).toBe(0);
    expect(await host.harness.callRpc('backups', {})).toMatchObject({ fence: 'unverified' });
    await host.harness.dispose();
  });

  it('keeps plugin-folder checks on hosts whose peers SDK predates storage epochs', async () => {
    const { host } = wired(async () => ({ id: 'app-a' }), (h) => {
      delete (h.zcc.sdk.peers as Partial<typeof h.zcc.sdk.peers>).storageEpoch;
    });
    plugin(host.zcc);
    await vi.waitFor(async () => expect(await host.harness.callRpc('backups', {})).toMatchObject({ fence: 'degraded' }));
    expect(host.harness.sdk.callsTo('peers.advanceStorageEpoch')).toEqual([]);
    await host.harness.dispose();
  });

  it('reports backup as unavailable on a host without the capability', async () => {
    const { host } = wired(async () => ({ id: 'app-a' }), (h) => { delete (h.zcc.storage as Partial<typeof h.zcc.storage>).backupDatabase; });
    plugin(host.zcc);
    await expect(Promise.resolve().then(() => host.harness.callRpc('backupDatabase', {}))).rejects.toThrow('database backup is unavailable');
    await host.harness.dispose();
  });
});
