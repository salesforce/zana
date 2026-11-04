import { constants } from 'node:fs';
import { lstat, open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isWithin, resolveContainedReal } from './index.js';

export interface ContainedFile {
  /** Open read-only handle. The caller owns it and must close it. */
  handle: FileHandle;
  /** Fully resolved path the handle was validated against. */
  real: string;
  size: number;
}

export interface OpenContainedOptions {
  /** Fault-injection seam: runs between path resolution and the open. */
  afterResolve?: (real: string) => void | Promise<void>;
  /**
   * Canonical directory the caller authorized. When set, `dir` must still
   * resolve to exactly this path both before the open and when the descriptor is
   * revalidated, so a root swapped for a symlink after authorization is refused
   * instead of becoming the new boundary.
   */
  expectedRoot?: string;
}

/**
 * Open a regular file under `dir` for reading without a check-then-reopen gap.
 *
 * Policy: `dir` and the target are both resolved with realpath, and the target
 * must sit inside `dir` on a path boundary. Symlinks that finish inside `dir`
 * are allowed; symlinks that leave it, dangling links, directories, FIFOs and
 * devices are refused. The target is then opened once with O_NOFOLLOW (the
 * final component cannot be a link) and O_NONBLOCK (a FIFO cannot block the
 * open). A swap of an intermediate directory can still redirect that open, so
 * the opened descriptor is validated: the resolved path must be unchanged,
 * still inside `dir`, and name the very inode the descriptor refers to. Reads
 * must use the returned handle, never the path again. Returns null when any
 * step fails (fail closed).
 */
export async function openContainedFile(
  dir: string,
  entry: string,
  options: OpenContainedOptions = {}
): Promise<ContainedFile | null> {
  if (options.expectedRoot !== undefined && !(await rootIs(dir, options.expectedRoot))) return null;
  const real = await resolveContainedReal(dir, entry);
  if (!real) return null;
  let handle: FileHandle | undefined;
  try {
    if (!(await lstat(real)).isFile()) return null;
    await options.afterResolve?.(real);
    handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new Error('not a regular file');
    const realDir = await realpath(resolve(dir));
    if (options.expectedRoot !== undefined && realDir !== options.expectedRoot) throw new Error('root changed');
    const again = await realpath(real);
    if (again !== real || !isWithin(again, realDir)) throw new Error('path changed');
    const named = await stat(again, { bigint: true });
    if (named.dev !== opened.dev || named.ino !== opened.ino) throw new Error('file replaced');
    return { handle, real, size: Number(opened.size) };
  } catch {
    await handle?.close().catch(() => undefined);
    return null;
  }
}

async function rootIs(dir: string, expected: string): Promise<boolean> {
  try {
    return (await realpath(resolve(dir))) === expected;
  } catch {
    return false;
  }
}
