import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, openSync, fsyncSync, closeSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { copyFile, lstat, mkdir, open, opendir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { z } from 'zod';
import { atomicDurableWrite } from '../durable-store.js';
import { fsyncDirectory } from '../fsync-directory.js';
import type { InstalledPluginRow } from './plugin-store.js';

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 1024;
const OWNED = ['kv.json', 'settings.json', 'secrets', 'data.db'] as const;
const uuid = /^[a-f0-9-]{36}$/;
const registration = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), rootDir: z.string().max(4096),
  sourceKind: z.enum(['git', 'npm', 'builtin', 'path']), version: z.string(), enabled: z.boolean(), installedAt: z.number()
}).passthrough();
const schema = z.object({
  version: z.literal(1), id: z.string().regex(uuid), phase: z.enum(['activating', 'restoring', 'committed', 'restored']),
  previous: registration, candidate: registration, createdAt: z.number(),
  files: z.array(z.object({ path: z.string().max(512), size: z.number().int().nonnegative().max(MAX_BYTES), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(MAX_FILES)
}).strict();
export interface PluginActivationJournal {
  version: 1; id: string; phase: 'activating' | 'restoring' | 'committed' | 'restored';
  previous: InstalledPluginRow; candidate: InstalledPluginRow; createdAt: number;
  files: Array<{ path: string; size: number; digest: string }>;
}
export interface PluginActivationScan {
  journals: PluginActivationJournal[];
  issues: Array<{ entry: string; detail: string }>;
}

async function info(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function directory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Plugin recovery directory must not be a symlink');
}
async function flush(file: string) {
  const handle = await open(file, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function flushDirectory(path: string) {
  fsyncDirectory({ open: openSync, fsync: fsyncSync, close: closeSync }, path);
}
async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
function ownedPath(path: string) {
  return OWNED.includes(path as typeof OWNED[number]) ||
    (path.startsWith('secrets/') && path.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes('\\')));
}
function ownedFile(path: string) { return path !== 'secrets' && ownedPath(path); }

/** Preserve canonical ancestry even after a completed activation removed a generation. */
export function canonicalPluginPath(path: string): string {
  let ancestor = resolve(path); const missing: string[] = [];
  for (let depth = 0; depth < 256; depth++) {
    try { return resolve(realpathSync(ancestor), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { lstatSync(ancestor); throw new Error('Managed plugin path contains a dangling symlink'); }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(basename(ancestor)); ancestor = parent;
    }
  }
  throw new Error('Managed plugin path exceeds its depth limit');
}

/** The journal never contains a destination for state: restore paths are host-derived. */
export function createPluginActivationStore(dataDir: string) {
  const root = join(dataDir, 'plugin-activations');
  const base = resolve(dataDir, 'plugins');
  const pluginRoot = existsSync(base) ? realpathSync(base) : base;
  function transactionDir(id: string) {
    if (!uuid.test(id)) throw new Error('Invalid activation journal identity');
    return join(root, id);
  }
  function validate(value: unknown): PluginActivationJournal {
    const parsed = schema.parse(value) as unknown as PluginActivationJournal;
    if (parsed.previous.id !== parsed.candidate.id || parsed.previous.installedAt !== parsed.candidate.installedAt ||
        parsed.files.some(file => !ownedFile(file.path)) ||
        new Set(parsed.files.map(file => file.path)).size !== parsed.files.length ||
        parsed.files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) throw new Error('Invalid plugin activation journal');
    for (const row of [parsed.previous, parsed.candidate]) {
      const path = canonicalPluginPath(row.rootDir);
      if (!path.startsWith(pluginRoot + sep)) throw new Error('Activation registration is outside managed plugin storage');
    }
    return parsed;
  }
  async function write(journal: PluginActivationJournal) {
    validate(journal);
    const dir = transactionDir(journal.id);
    await directory(root); await directory(dir);
    const bytes = Buffer.from(JSON.stringify(journal));
    if (bytes.length > 1_048_576) throw new Error('Plugin activation journal exceeds the limit');
    atomicDurableWrite(join(dir, 'journal.json'), bytes);
    flushDirectory(root);
  }
  async function scan(): Promise<PluginActivationScan> {
    const result: PluginActivationScan = { journals: [], issues: [] };
    if (!await info(root)) return result;
    await directory(root);
    let count = 0;
    for await (const entry of await opendir(root)) {
      // Finder/Explorer metadata is inert only when it is a regular file. Never
      // follow a same-named symlink or treat a directory as harmless metadata.
      if (entry.isFile() && ['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(entry.name)) continue;
      if (++count > 256) {
        result.issues.push({ entry: '.', detail: 'Too many pending plugin activations; recovery requires attention' });
        break;
      }
      try {
        if (!uuid.test(entry.name) || !entry.isDirectory()) throw new Error('Unexpected plugin activation entry');
        const dir = transactionDir(entry.name), file = join(dir, 'journal.json'), stats = await info(file);
        if (!stats) { await rm(dir, { recursive: true, force: true }); continue; } // Snapshotting cannot have activated code yet.
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1_048_576) throw new Error('Invalid plugin activation journal file');
        const journal = validate(JSON.parse(await readFile(file, 'utf8')));
        if (journal.id !== entry.name) throw new Error('Activation directory and journal disagree');
        result.journals.push(journal);
      } catch (error) {
        // Retain damaged evidence and continue examining independent journals.
        result.issues.push({ entry: entry.name, detail: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }
  return {
    async prepare(previous: InstalledPluginRow, candidate: InstalledPluginRow, now: number): Promise<PluginActivationJournal> {
      const journal: PluginActivationJournal = { version: 1, id: randomUUID(), phase: 'activating', previous, candidate, createdAt: now, files: [] };
      validate(journal);
      await directory(root);
      const dir = transactionDir(journal.id), snapshot = join(dir, 'snapshot'), source = join(pluginRoot, previous.id);
      await directory(snapshot);
      try {
        const sourceInfo = await info(source);
        if (sourceInfo && (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink())) throw new Error('Plugin storage must not be a symlink');
        let total = 0, entriesSeen = 0;
        const copy = async (path: string): Promise<void> => {
          if (++entriesSeen > MAX_FILES || path.length > 512 || !ownedPath(path)) throw new Error('Plugin snapshot exceeds its file or path limit');
          const from = join(source, path), stats = await info(from);
          if (!stats) return;
          if (stats.isSymbolicLink()) throw new Error('Plugin snapshots cannot contain symlinks');
          const to = join(snapshot, path);
          if (stats.isDirectory()) {
            if (path !== 'secrets' && !path.startsWith('secrets/')) throw new Error('Invalid plugin storage file');
            await directory(to);
            const entries = await opendir(from);
            for await (const entry of entries) await copy(`${path}/${entry.name}`);
            flushDirectory(to);
            return;
          }
          if (!ownedFile(path) || !stats.isFile() || journal.files.length >= MAX_FILES || total + stats.size > MAX_BYTES) throw new Error('Plugin snapshot exceeds its file or size limit');
          if (path === 'data.db') {
            for (const suffix of ['-wal', '-shm']) if ((await info(from + suffix))?.isSymbolicLink()) throw new Error('Plugin database sidecars cannot be symlinks');
            const db = createSqliteDatabase(from, { readonly: true, fileMustExist: true });
            try {
              const pageSize = db.pragma('page_size', { simple: true }) as number;
              await db.backup(to, { progress: state => {
                if (state.totalPages * pageSize + total > MAX_BYTES) throw new Error('Plugin database snapshot exceeds its size limit');
                return 64;
              } });
            } finally { db.close(); }
          } else await copyFile(from, to);
          const copied = await lstat(to);
          total += copied.size;
          if (total > MAX_BYTES) throw new Error('Plugin snapshot exceeds its size limit');
          // copyFile preserves source mode; secrets and all backups stay private.
          const handle = await open(to, 'r+');
          try { await handle.chmod(0o600); await handle.sync(); } finally { await handle.close(); }
          journal.files.push({ path, size: copied.size, digest: await digest(to) });
        };
        for (const name of OWNED) await copy(name);
        flushDirectory(snapshot);
        await write(journal);
        return journal;
      } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
    },
    async list(): Promise<PluginActivationJournal[]> {
      const result = await scan();
      if (result.issues.length) throw new Error(result.issues[0]!.detail);
      return result.journals;
    },
    scan,
    async phase(journal: PluginActivationJournal, phase: PluginActivationJournal['phase']) {
      const next = { ...journal, phase }; await write(next); return next;
    },
    async restore(journal: PluginActivationJournal) {
      validate(journal);
      const snapshot = join(transactionDir(journal.id), 'snapshot');
      await directory(snapshot);
      // Validate the complete snapshot before touching even one live file.
      for (const file of journal.files) {
        const path = join(snapshot, file.path), stats = await lstat(path);
        if (!realpathSync(path).startsWith(realpathSync(snapshot) + sep) || !stats.isFile() || stats.isSymbolicLink() || stats.size !== file.size || await digest(path) !== file.digest) throw new Error('Plugin recovery snapshot is damaged');
      }
      const target = join(pluginRoot, journal.previous.id);
      await directory(target);
      for (const name of [...OWNED, 'data.db-wal', 'data.db-shm']) await rm(join(target, name), { recursive: true, force: true });
      const directories = new Set<string>([target]);
      for (const file of journal.files) {
        const path = join(target, file.path);
        await directory(join(path, '..'));
        await copyFile(join(snapshot, file.path), path);
        await flush(path);
        let parent = join(path, '..');
        while (parent.startsWith(target + sep)) { directories.add(parent); parent = join(parent, '..'); }
      }
      for (const path of [...directories].sort((a, b) => b.length - a.length)) flushDirectory(path);
    },
    async finish(journal: PluginActivationJournal) {
      await rm(transactionDir(journal.id), { recursive: true, force: true });
      flushDirectory(root);
    },
    /** Called before staging or loading code. Pending recovery is resolved first. */
    async pruneGenerations(referencedRoots: string[]) {
      const generations = join(pluginRoot, 'generations');
      if (!await info(generations)) return;
      await directory(generations);
      const retained = new Set(referencedRoots.map(path => {
        const canonical = canonicalPluginPath(path);
        return canonical.startsWith(generations + sep) ? canonical.slice(generations.length + 1).split(sep)[0] : '';
      }));
      let count = 0;
      for await (const entry of await opendir(generations)) {
        if (++count > 4096) throw new Error('Too many plugin generations; cleanup requires attention');
        if (uuid.test(entry.name) && entry.isDirectory() && !retained.has(entry.name)) {
          await rm(join(generations, entry.name), { recursive: true, force: true });
        }
      }
      flushDirectory(generations);
    }
  };
}
