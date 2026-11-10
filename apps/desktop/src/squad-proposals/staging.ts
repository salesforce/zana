import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Private copies of the attachments of a pending Squad proposal, one folder per proposal id under
 * `<zcc data dir>/squad-proposals/staged`. Owner-only (0700 folders, 0600 files) and unencrypted.
 * A staged file is afterwards an ordinary path source: the data-dir policy allows this folder
 * through READABLE_DATA_DIRS ('squad-proposals').
 */
export const SQUAD_STAGING_PARENT_DIR_NAME = 'squad-proposals';
export const SQUAD_STAGING_DIR_NAME = 'staged';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TMP_PREFIX = '.tmp-';

export interface StagedFile { name: string; text: string }
export interface StagedWrite { bytes: number; paths: string[] }

export interface StagingStore {
  /** Create the root (0700) and return its realpath; staged paths are built from it. */
  prepareRoot(): Promise<string>;
  /** Write every file into a private folder for `id`, all or nothing. Names must already be safe, unique file names. */
  write(id: string, files: readonly StagedFile[]): Promise<StagedWrite>;
  /** Remove the folder for `id`; a missing one is fine. Never follows a link. */
  remove(id: string): Promise<void>;
  /** Bytes held on disk by all staged folders, including unfinished ones. */
  usedBytes(): Promise<number>;
  /** Entries under the root: proposal folders and unfinished temp folders with their age. */
  entries(): Promise<Array<{ name: string; id?: string; modifiedAt: number }>>;
  /** Remove an unfinished temp folder by entry name. */
  removeEntry(name: string): Promise<void>;
}

export const isStagingId = (id: string): boolean => ID_PATTERN.test(id);

async function sizeOf(path: string): Promise<number> {
  let stat;
  try { stat = await lstat(path); } catch { return 0; }
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const child of await readdir(path).catch(() => [] as string[])) total += await sizeOf(join(path, child));
  return total;
}

/** Remove `path` without following a link at it. */
async function removePath(path: string): Promise<void> {
  let stat;
  try { stat = await lstat(path); } catch { return; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) { await unlink(path); return; }
  await rm(path, { recursive: true, force: true });
}

export function createStagingStore(options: { root: string }): StagingStore {
  let real: string | undefined;
  const prepareRoot = async (): Promise<string> => {
    if (real) return real;
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    await chmod(options.root, 0o700).catch(() => undefined);
    real = await realpath(options.root);
    return real;
  };
  const folder = async (id: string): Promise<string> => {
    if (!isStagingId(id)) throw new Error('invalid staging id');
    return join(await prepareRoot(), id);
  };

  return {
    prepareRoot,

    async write(id, files) {
      const target = await folder(id);
      const tmp = join(await prepareRoot(), `${TMP_PREFIX}${id}-${randomBytes(6).toString('hex')}`);
      try {
        await mkdir(tmp, { mode: 0o700 });
        await chmod(tmp, 0o700).catch(() => undefined);
        const paths: string[] = [];
        let bytes = 0;
        for (const file of files) {
          const data = Buffer.from(file.text, 'utf8');
          await writeFile(join(tmp, file.name), data, { flag: 'wx', mode: 0o600 });
          bytes += data.byteLength;
          paths.push(join(target, file.name));
        }
        await rename(tmp, target);
        return { bytes, paths };
      } catch (error) {
        await removePath(tmp).catch(() => undefined);
        throw error;
      }
    },

    async remove(id) {
      await removePath(await folder(id));
    },

    async usedBytes() {
      const root = await prepareRoot();
      let total = 0;
      for (const name of await readdir(root).catch(() => [] as string[])) total += await sizeOf(join(root, name));
      return total;
    },

    async entries() {
      const root = await prepareRoot();
      const out: Array<{ name: string; id?: string; modifiedAt: number }> = [];
      for (const name of await readdir(root).catch(() => [] as string[])) {
        const stat = await lstat(join(root, name)).catch(() => undefined);
        if (!stat) continue;
        out.push({ name, ...(isStagingId(name) ? { id: name } : {}), modifiedAt: stat.mtimeMs });
      }
      return out;
    },

    async removeEntry(name) {
      if (name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name === '') throw new Error('invalid staging entry');
      await removePath(join(await prepareRoot(), name));
    }
  };
}
