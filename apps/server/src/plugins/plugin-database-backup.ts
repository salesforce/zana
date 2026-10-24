import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  normalizePluginDatabaseBackupOptions,
  PLUGIN_DATABASE_BACKUP_MARKER_TABLE,
  PLUGIN_DATABASE_BACKUP_RETENTION,
  PluginDatabaseBackupError,
  type PluginDatabaseBackup,
  type PluginDatabaseBackupOptions
} from '@zana-ai/zcc-plugin-sdk';

/** The live better-sqlite3 handle the plugin writes through. */
export interface PluginBackupSource {
  backup(file: string, options?: { progress?(info: { totalPages: number; remainingPages: number }): number | void }): Promise<unknown>;
  pragma(source: string, options?: { simple?: boolean }): unknown;
}

/** A short-lived handle on the finished copy, used to stamp and verify it. */
export interface PluginBackupCopy {
  runScript(source: string): void;
  prepare(source: string): { run(...params: unknown[]): unknown };
  pragma(source: string, options?: { simple?: boolean }): unknown;
  close(): void;
}

export interface PluginDatabaseBackupDeps {
  pluginId: string;
  /** The folder holding the plugin's `data.db`; backups go in its `backups/` child. */
  pluginDir: string;
  /** The live handle. Using the writer's own connection keeps concurrent writes inside the copy. */
  source(): PluginBackupSource;
  openCopy(file: string): PluginBackupCopy;
  /** Aborted when the plugin is disposed. */
  lifetime?: AbortSignal;
  now?: () => number;
}

const BACKUP_SUFFIX = '.db';
const TEMP_MARKER = '.tmp-';

/** Adapts a raw better-sqlite3 handle; `exec` is the driver's batch-SQL method. */
export function backupCopyHandle(db: { prepare(source: string): { run(...params: unknown[]): unknown }; pragma(source: string, options?: { simple?: boolean }): unknown; close(): void }): PluginBackupCopy {
  const runBatch = Reflect.get(db, 'exec') as (source: string) => unknown;
  return {
    runScript: (source) => { runBatch.call(db, source); },
    prepare: (source) => db.prepare(source),
    pragma: (source, options) => db.pragma(source, options),
    close: () => db.close()
  };
}

function aborted(): PluginDatabaseBackupError {
  return new PluginDatabaseBackupError('aborted', 'database backup aborted');
}

function tooLarge(maxBytes: number): PluginDatabaseBackupError {
  return new PluginDatabaseBackupError('too-large', `database backup exceeds ${maxBytes} bytes`);
}

/** The plugin's backups folder, created 0700 and proven to be a real child of its data folder. */
async function confinedBackupDir(pluginDir: string): Promise<string> {
  const root = await realpath(pluginDir);
  const dir = join(root, 'backups');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new PluginDatabaseBackupError('failed', 'plugin backup folder is not a plain directory');
  }
  await chmod(dir, 0o700);
  return dir;
}

async function removeCopy(file: string): Promise<void> {
  await Promise.all(['', '-wal', '-shm', '-journal'].map((suffix) => rm(`${file}${suffix}`, { force: true })));
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function syncPath(file: string, flags: string): Promise<void> {
  const handle = await open(file, flags);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function prune(dir: string, keep: string): Promise<void> {
  const entries = await readdir(dir);
  const finished = await Promise.all(entries
    .filter((entry) => entry.endsWith(BACKUP_SUFFIX) && !entry.startsWith('.') && entry !== keep)
    .map(async (entry) => ({ entry, mtime: (await lstat(join(dir, entry))).mtimeMs })));
  finished.sort((a, b) => b.mtime - a.mtime || (a.entry < b.entry ? 1 : -1));
  for (const { entry } of finished.slice(PLUGIN_DATABASE_BACKUP_RETENTION - 1)) await rm(join(dir, entry), { force: true });
}

/**
 * `zcc.storage.backupDatabase` for one plugin. Serialized: a second call waits
 * for the first. Every failure path removes the partial copy.
 */
export function createPluginDatabaseBackup(deps: PluginDatabaseBackupDeps): (options: PluginDatabaseBackupOptions) => Promise<PluginDatabaseBackup> {
  const now = deps.now ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve();

  const run = async (options: PluginDatabaseBackupOptions): Promise<PluginDatabaseBackup> => {
    const { name, maxBytes } = normalizePluginDatabaseBackupOptions(options);
    const signals = [options.signal, deps.lifetime].filter((signal): signal is AbortSignal => Boolean(signal));
    const isAborted = () => signals.some((signal) => signal.aborted);
    const check = () => { if (isAborted()) throw aborted(); };
    check();
    const dir = await confinedBackupDir(deps.pluginDir);
    // Serialized, so any temp file here belongs to an interrupted earlier run.
    for (const entry of await readdir(dir)) if (entry.includes(TEMP_MARKER)) await rm(join(dir, entry), { force: true });
    const source = deps.source();
    const pageSize = Number(source.pragma('page_size', { simple: true }));
    if (Number(source.pragma('page_count', { simple: true })) * pageSize > maxBytes) throw tooLarge(maxBytes);
    const backupId = randomUUID(), createdAt = now();
    const temp = join(dir, `.${name}${TEMP_MARKER}${backupId}`), target = join(dir, `${name}${BACKUP_SUFFIX}`);
    try {
      // Create the file 0600 before SQLite writes any page into it.
      await (await open(temp, 'wx', 0o600)).close();
      check();
      await source.backup(temp, {
        progress: ({ totalPages }) => {
          if (isAborted()) throw aborted();
          if (totalPages * pageSize > maxBytes) throw tooLarge(maxBytes);
        }
      });
      check();
      const copy = deps.openCopy(temp);
      try {
        copy.pragma('journal_mode = DELETE');
        copy.runScript(`DROP TABLE IF EXISTS ${PLUGIN_DATABASE_BACKUP_MARKER_TABLE};
          CREATE TABLE ${PLUGIN_DATABASE_BACKUP_MARKER_TABLE} (backup_id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, created_at INTEGER NOT NULL);`);
        copy.prepare(`INSERT INTO ${PLUGIN_DATABASE_BACKUP_MARKER_TABLE} (backup_id, plugin_id, created_at) VALUES (?, ?, ?)`).run(backupId, deps.pluginId, createdAt);
        const integrity = copy.pragma('quick_check', { simple: true });
        if (integrity !== 'ok') throw new PluginDatabaseBackupError('failed', `database backup failed integrity check: ${String(integrity).slice(0, 120)}`);
      } finally { copy.close(); }
      await chmod(temp, 0o600);
      const bytes = (await stat(temp)).size;
      if (bytes > maxBytes) throw tooLarge(maxBytes);
      await syncPath(temp, 'r+');
      const digest = await sha256(temp);
      check();
      await rename(temp, target);
      await syncPath(dir, 'r').catch(() => { /* Directory fsync is unsupported on some filesystems; the rename is still atomic. */ });
      await prune(dir, `${name}${BACKUP_SUFFIX}`);
      return { backupId, name, path: target, bytes, sha256: digest, createdAt };
    } catch (error) {
      await removeCopy(temp);
      if (error instanceof PluginDatabaseBackupError) throw error;
      if (isAborted()) throw aborted();
      throw new PluginDatabaseBackupError('failed', `database backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (options) => {
    const next = queue.then(() => run(options));
    queue = next.catch(() => undefined);
    return next;
  };
}
