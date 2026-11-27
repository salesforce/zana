import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import { fsyncDirectory } from './fsync-directory.js';
import { renameWithRetry } from './rename-retry.js';

/**
 * Server-owned durable persistence primitive (Runtime Migration Backlog,
 * Durable Foundation #1). Every product store the server takes ownership of
 * must route its writes through this module: a same-directory UUID temp file,
 * fsynced then renamed over the target, with the parent directory fsynced
 * afterward on POSIX, plus one serialized queue per logical store so a
 * read-modify-write never races itself. Startup migration storage uses the same
 * directory-flush helper so both persistence paths behave identically on Windows.
 */
export interface DurableWriteFileSystem {
  readFile(path: string): Buffer;
  open(path: string, flags: string, mode?: number): number;
  writeFile(fd: number, bytes: Buffer): void;
  fsync(fd: number): void;
  close(fd: number): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
}

const nodeFileSystem: DurableWriteFileSystem = {
  readFile: (path) => readFileSync(path),
  open: (path, flags, mode) => openSync(path, flags, mode),
  writeFile: (fd, bytes) => writeFileSync(fd, bytes),
  fsync: (fd) => fsyncSync(fd),
  close: (fd) => closeSync(fd),
  rename: (from, to) => renameSync(from, to),
  unlink: (path) => unlinkSync(path)
};

export class DurableWriteConflictError extends Error {
  constructor() {
    super('Durable write rejected: file changed outside serialized transaction');
    this.name = 'DurableWriteConflictError';
  }
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function currentHash(fs: DurableWriteFileSystem, target: string): string | null {
  try {
    return hashBytes(fs.readFile(target));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function atomicDurableWrite(
  target: string,
  bytes: Buffer,
  options: {
    expectedHash?: string | null;
    fs?: DurableWriteFileSystem;
    uuid?: () => string;
    beforeRename?: () => void;
    /** Test seam for the rename retry wait. */
    sleep?: (ms: number) => void;
  } = {}
): void {
  const fs = options.fs ?? nodeFileSystem;
  const expectedHash = options.expectedHash;
  if (expectedHash !== undefined && currentHash(fs, target) !== expectedHash) {
    throw new DurableWriteConflictError();
  }

  const temp = `${target}.tmp-${(options.uuid ?? randomUUID)()}`;
  let fd: number | undefined;
  try {
    fd = fs.open(temp, 'wx', 0o600);
    fs.writeFile(fd, bytes);
    fs.fsync(fd);
    fs.close(fd);
    fd = undefined;
    options.beforeRename?.();
    // Re-check after temp fsync: another process may have changed target while
    // bytes were being written. Never replace that external edit at rename.
    if (expectedHash !== undefined && currentHash(fs, target) !== expectedHash) {
      throw new DurableWriteConflictError();
    }
    // Windows: a brief lock on the target (antivirus, indexer, another
    // process) fails the rename with EPERM/EBUSY/EACCES; retry, bounded.
    renameWithRetry(() => fs.rename(temp, target), { sleep: options.sleep });
    fsyncDirectory(fs, dirname(target));
  } catch (error) {
    if (fd !== undefined) {
      try { fs.close(fd); } catch { /* preserve original failure */ }
    }
    try { fs.unlink(temp); } catch { /* rename or absent temp */ }
    throw error;
  }
}

export function durableRemove(
  target: string,
  options: { expectedHash: string; fs?: DurableWriteFileSystem }
): void {
  const fs = options.fs ?? nodeFileSystem;
  if (currentHash(fs, target) !== options.expectedHash) throw new DurableWriteConflictError();
  fs.unlink(target);
  fsyncDirectory(fs, dirname(target));
}

export function readRawFile(
  target: string,
  fs: DurableWriteFileSystem = nodeFileSystem
): Buffer | null {
  try {
    return fs.readFile(target);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function createSerializedTransactionQueue(): {
  run<T>(task: () => Promise<T>): Promise<T>;
} {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(() => undefined, () => undefined);
      return result;
    }
  };
}
