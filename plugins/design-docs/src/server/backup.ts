import { randomUUID } from 'node:crypto';
import type { PluginDatabase, PluginDatabaseBackup, PluginDatabaseBackupOptions, PluginKvStorage } from '@zana-ai/zcc-plugin-sdk/server';
import type { DesignDocPeerGroup } from './peer-group.js';
import type { DesignDocSyncStore } from './sync-store.js';

/** Host-reserved marker table stamped into every backup copy; a live database never has it. */
export const BACKUP_MARKER_TABLE = '_zcc_backup';
/** App-local (zcc.db) record of which replica and generation this app last ran. */
export const REPLICA_BINDING_KEY = 'sync/replica-binding';
const MAX_BACKUP_ROWS = 8;
const MAX_RESTORE_ROWS = 64;
/** How often a running writer re-fences after its database changed. Bounds how stale an undetected live copy can be. */
export const FENCE_INTERVAL_MS = 15_000;

export interface ReplicaBinding { replicaId: string; generation: string; next?: string }
export type RestoreReason = 'backup-marker' | 'replica-binding' | 'generation' | 'app-identity' | 'storage-epoch';
/**
 * `bound`: the database is bound to the core-held storage epoch. `degraded`: the host cannot provide one, so only
 * plugin-folder evidence (marker, KV binding, app identity) is checked. `lost`: a running re-fence failed.
 */
export type FenceStatus = 'unverified' | 'bound' | 'degraded' | 'lost';
/** Core-held, app-level storage epoch for this plugin (`zcc.sdk.peers.storageEpoch` / `advanceStorageEpoch`). */
export interface StorageEpochs {
  current(): Promise<number | null>;
  advance(expected: number): Promise<number>;
}
interface WriterFence { app_id: string; epoch: number; pending: number | null }
export interface BackupRecord {
  backupId: string; name: string; path: string; bytes: number; sha256: string; createdAt: number;
  repoId: string; replicaId: string; peerId: string | null; rosterEpoch: number;
}
export interface RestoreRecord {
  at: number; reason: RestoreReason; backupId: string | null; backupCreatedAt: number | null;
  previousReplicaId: string; replicaId: string;
}

export interface BackupDeps {
  kv: Pick<PluginKvStorage, 'get' | 'set'>;
  /** `zcc.storage.backupDatabase`; absent on hosts without the capability. */
  backup?: (options: PluginDatabaseBackupOptions) => Promise<PluginDatabaseBackup>;
  /** Absent on hosts without the capability; the fence then reports `degraded`. */
  epochs?: StorageEpochs;
  now?: () => number;
  randomId?: () => string;
}

type Sync = Pick<DesignDocSyncStore, 'localRepository'>;
type Group = Pick<DesignDocPeerGroup, 'quarantineRestoredWriter' | 'localPeerId'>;

/**
 * Full-database backups and restore fencing. A restored or cloned database
 * never resumes as the replica it was copied from: startup moves it to a fresh
 * replica identity, detached from its group, so rejoining is a new admission.
 */
export class DesignDocBackups {
  private readonly now: () => number;
  private readonly randomId: () => string;
  private fence: FenceStatus = 'unverified';
  private fencedEpoch: number | null = null;
  private fencedChanges = -1;
  private fencedApp = '';

  constructor(private readonly db: PluginDatabase, private readonly sync: Sync, private readonly deps: BackupDeps) {
    this.now = deps.now ?? Date.now;
    this.randomId = deps.randomId ?? randomUUID;
    db.runScript(`CREATE TABLE IF NOT EXISTS dd_backups (
        backup_id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
        created_at INTEGER NOT NULL, repo_id TEXT NOT NULL, replica_id TEXT NOT NULL, peer_id TEXT, roster_epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS dd_replica_generation (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dd_backup_restores (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, reason TEXT NOT NULL, backup_id TEXT, backup_created_at INTEGER,
        previous_replica_id TEXT NOT NULL, new_replica_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dd_writer_fence (singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        app_id TEXT NOT NULL, epoch INTEGER NOT NULL, pending INTEGER);`);
  }

  get available(): boolean { return typeof this.deps.backup === 'function'; }

  /** Whether this load is fenced by core-held state a plugin-folder restore cannot roll back. */
  fenceStatus(): FenceStatus { return this.fence; }

  /** Takes a consistent online backup and records what it contains. */
  async create(peerId: string | null, signal?: AbortSignal): Promise<BackupRecord> {
    if (!this.deps.backup) throw new Error('database backup is unavailable on this host');
    const name = `design-docs-${this.now()}-${this.randomId().replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`;
    const result = await this.deps.backup({ name, ...(signal ? { signal } : {}) });
    const local = this.sync.localRepository()!;
    const record: BackupRecord = { backupId: result.backupId, name: result.name, path: result.path, bytes: result.bytes, sha256: result.sha256,
      createdAt: result.createdAt, repoId: local.repoId, replicaId: local.replicaId, peerId, rosterEpoch: local.rosterEpoch };
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR REPLACE INTO dd_backups (backup_id, name, path, bytes, sha256, created_at, repo_id, replica_id, peer_id, roster_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.backupId, record.name, record.path, record.bytes, record.sha256, record.createdAt,
        record.repoId, record.replicaId, record.peerId, record.rosterEpoch);
      this.db.prepare(`DELETE FROM dd_backups WHERE backup_id NOT IN (SELECT backup_id FROM dd_backups ORDER BY created_at DESC, backup_id LIMIT ?)`).run(MAX_BACKUP_ROWS);
    });
    return record;
  }

  list(): { backups: BackupRecord[]; restores: RestoreRecord[]; fence: FenceStatus } {
    const backups = (this.db.prepare('SELECT * FROM dd_backups ORDER BY created_at DESC, backup_id LIMIT ?').all(MAX_BACKUP_ROWS) as Array<Record<string, unknown>>)
      .map((row) => ({ backupId: row.backup_id as string, name: row.name as string, path: row.path as string, bytes: row.bytes as number,
        sha256: row.sha256 as string, createdAt: row.created_at as number, repoId: row.repo_id as string, replicaId: row.replica_id as string,
        peerId: row.peer_id as string | null, rosterEpoch: row.roster_epoch as number }));
    const restores = (this.db.prepare('SELECT * FROM dd_backup_restores ORDER BY id DESC LIMIT ?').all(MAX_RESTORE_ROWS) as Array<Record<string, unknown>>)
      .map((row) => ({ at: row.at as number, reason: row.reason as RestoreReason, backupId: row.backup_id as string | null,
        backupCreatedAt: row.backup_created_at as number | null, previousReplicaId: row.previous_replica_id as string, replicaId: row.new_replica_id as string }));
    return { backups, restores, fence: this.fence };
  }

  /**
   * Runs once per load, before peer sync answers anyone. Fails closed: any
   * sign that this database is not the one this app last ran quarantines its
   * writer. Then binds the (possibly new) replica and a fresh generation, and
   * advances the core-held storage epoch the database is fenced to.
   *
   * The KV binding lives in the plugin folder next to the database, so a
   * whole-folder restore rolls both back together; only the core epoch, held
   * outside that folder, catches it. An epoch read or advance failure rejects,
   * and the caller must not start peer sync.
   */
  async verifyRestore(group: Group, currentPeerId: string): Promise<{ restored: boolean; reason: RestoreReason | null }> {
    const marker = this.marker();
    const binding = await this.deps.kv.get<ReplicaBinding>(REPLICA_BINDING_KEY);
    const core = this.deps.epochs ? await this.deps.epochs.current() : null;
    const before = this.sync.localRepository()!;
    const reason: RestoreReason | null = marker ? 'backup-marker'
      : (core !== null ? this.fenceReason(group, currentPeerId, core, before.groupId) : null)
        ?? (binding && binding.replicaId !== before.replicaId && !this.completedQuarantine(binding.replicaId, before.replicaId) ? 'replica-binding'
          : binding && binding.replicaId === before.replicaId && !this.generationMatches(binding) ? 'generation'
            : null);
    let restored = false, recorded: RestoreReason | null = reason;
    this.db.transaction(() => {
      restored = group.quarantineRestoredWriter(currentPeerId, { force: reason !== null }).restored;
      if (restored && !recorded) recorded = 'app-identity';
      if (!restored) return;
      const after = this.sync.localRepository()!;
      this.db.prepare(`INSERT INTO dd_backup_restores (at, reason, backup_id, backup_created_at, previous_replica_id, new_replica_id)
        VALUES (?, ?, ?, ?, ?, ?)`).run(this.now(), recorded, marker?.backup_id ?? null, marker?.created_at ?? null, before.replicaId, after.replicaId);
      this.db.prepare('DELETE FROM dd_backup_restores WHERE id NOT IN (SELECT id FROM dd_backup_restores ORDER BY id DESC LIMIT ?)').run(MAX_RESTORE_ROWS);
      // Handled: the marker must not quarantine the new replica again on the next load.
      if (marker) this.db.runScript(`DROP TABLE ${BACKUP_MARKER_TABLE}`);
    });
    await this.rebind(binding);
    if (core === null) this.fence = 'degraded';
    else {
      await this.advanceFence(currentPeerId, core);
      this.fence = 'bound';
    }
    return { restored, reason: restored ? recorded : null };
  }

  /**
   * While running, re-fence after the database changes so a raw copy taken
   * mid-run is stale by the time it could be restored. Returns a stop function;
   * a failed re-fence stops maintenance and marks the fence `lost`.
   */
  maintainFence(onLost: (error: unknown) => void, intervalMs = FENCE_INTERVAL_MS): () => void {
    if (this.fence !== 'bound') return () => {};
    let stopped = false, busy = false;
    const timer = setInterval(() => {
      if (busy || this.changes() === this.fencedChanges) return;
      busy = true;
      void this.advanceFence(this.fencedApp, this.fencedEpoch!).catch((error: unknown) => {
        if (stopped) return;
        stop();
        this.fence = 'lost';
        try { onLost(error); } catch (callbackError) { console.warn('[design-docs] backup fence-lost callback failed:', callbackError); }
      }).finally(() => { busy = false; });
    }, intervalMs);
    timer.unref?.();
    const stop = () => { stopped = true; clearInterval(timer); };
    return stop;
  }

  /**
   * Accepts the core epoch only when it is exactly what this database last
   * recorded: the committed epoch, or the pending one a crash left between the
   * core advance and the final database write. Anything else means the
   * database is older (rolled back) or newer (core rolled back) than core.
   */
  private fenceReason(group: Group, currentPeerId: string, core: number, groupId: string | null): RestoreReason | null {
    const fence = this.db.prepare('SELECT app_id, epoch, pending FROM dd_writer_fence WHERE singleton = 1').get() as WriterFence | undefined;
    if (fence) return fence.app_id !== currentPeerId ? 'app-identity' : core === fence.epoch || core === fence.pending ? null : 'storage-epoch';
    // Never fenced, yet this app has fenced a database before: a copy from before fencing replaced it. A fresh,
    // never-shared database has nothing to protect and is simply bound.
    const shared = groupId !== null || group.localPeerId() !== null || !!this.db.prepare('SELECT 1 FROM sync_operations LIMIT 1').get();
    return core > 0 && shared ? 'storage-epoch' : null;
  }

  /** Two-phase: the database records the pending epoch before core advances, so a crash at any point is accepted next load. */
  private async advanceFence(appId: string, expected: number): Promise<void> {
    this.db.prepare(`INSERT INTO dd_writer_fence (singleton, app_id, epoch, pending) VALUES (1, ?, ?, ?)
      ON CONFLICT (singleton) DO UPDATE SET app_id = excluded.app_id, epoch = excluded.epoch, pending = excluded.pending`).run(appId, expected, expected + 1);
    const next = await this.deps.epochs!.advance(expected);
    this.db.prepare('UPDATE dd_writer_fence SET epoch = ?, pending = NULL WHERE singleton = 1').run(next);
    this.fencedApp = appId;
    this.fencedEpoch = next;
    this.fencedChanges = this.changes();
  }

  private changes(): number {
    return (this.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  }

  private marker(): { backup_id: string; created_at: number } | null {
    if (!this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(BACKUP_MARKER_TABLE)) return null;
    const row = this.db.prepare(`SELECT backup_id, created_at FROM ${BACKUP_MARKER_TABLE} LIMIT 1`).get() as { backup_id: string; created_at: number } | undefined;
    // An empty marker table still came from a copy; fail closed.
    return row ?? { backup_id: 'unknown', created_at: 0 };
  }

  private generation(): string | null {
    const row = this.db.prepare('SELECT generation FROM dd_replica_generation WHERE singleton = 1').get() as { generation: string } | undefined;
    return row?.generation ?? null;
  }

  private generationMatches(binding: ReplicaBinding): boolean {
    const current = this.generation();
    // A database from before generations existed has none yet; the binding check still applies to it.
    return current === null || current === binding.generation || current === binding.next;
  }

  /** A quarantine this app committed but crashed before rebinding is not a second restore. */
  private completedQuarantine(boundReplicaId: string, currentReplicaId: string): boolean {
    return !!this.db.prepare('SELECT id FROM sync_restore_events WHERE previous_replica_id = ? AND new_replica_id = ? LIMIT 1').get(boundReplicaId, currentReplicaId);
  }

  /** Two-phase so a crash between the database and KV writes cannot look like a rollback. */
  private async rebind(previous: ReplicaBinding | undefined): Promise<void> {
    const replicaId = this.sync.localRepository()!.replicaId, next = this.randomId();
    const current = this.generation() ?? previous?.generation ?? next;
    await this.deps.kv.set(REPLICA_BINDING_KEY, { replicaId, generation: current, next } satisfies ReplicaBinding);
    this.db.prepare(`INSERT INTO dd_replica_generation (singleton, generation) VALUES (1, ?)
      ON CONFLICT (singleton) DO UPDATE SET generation = excluded.generation`).run(next);
    await this.deps.kv.set(REPLICA_BINDING_KEY, { replicaId, generation: next } satisfies ReplicaBinding);
  }
}
