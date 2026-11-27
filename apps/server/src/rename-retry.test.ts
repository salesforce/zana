import { closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicDurableWrite as durableStoreWrite } from './durable-store.js';
import { atomicDurableWrite as harnessStorageWrite } from './services/harness-routing/storage.js';
import {
  isRetryableRenameError,
  RENAME_RETRY_DELAYS_MS,
  RENAME_RETRY_TOTAL_MS,
  renameWithRetry,
  sleepSync
} from './rename-retry.js';

const roots: string[] = [];
const errno = (code: string) => Object.assign(new Error(`${code}: rename`), { code });

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'zcc-rename-retry-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('renameWithRetry', () => {
  it('keeps the worst-case block short, with small early steps', () => {
    expect(RENAME_RETRY_DELAYS_MS.slice(0, 4)).toEqual([5, 10, 20, 40]);
    expect(RENAME_RETRY_TOTAL_MS).toBeLessThanOrEqual(1000);
  });

  it.each(['EPERM', 'EBUSY', 'EACCES'])('retries %s with the backoff steps and then succeeds', (code) => {
    const sleeps: number[] = [];
    let calls = 0;
    renameWithRetry(() => { if (++calls <= 3) throw errno(code); }, { sleep: (ms) => sleeps.push(ms) });
    expect(calls).toBe(4);
    expect(sleeps).toEqual([5, 10, 20]);
  });

  it('rethrows the last error once the delays are exhausted', () => {
    const sleeps: number[] = [];
    let calls = 0;
    const last = errno('EPERM');
    expect(() => renameWithRetry(() => { calls++; throw last; }, { sleep: (ms) => sleeps.push(ms) })).toThrow(last);
    expect(calls).toBe(RENAME_RETRY_DELAYS_MS.length + 1);
    expect(sleeps).toEqual([...RENAME_RETRY_DELAYS_MS]);
  });

  it('does not retry other errors', () => {
    const sleep = vi.fn();
    let calls = 0;
    expect(() => renameWithRetry(() => { calls++; throw errno('ENOENT'); }, { sleep })).toThrow('ENOENT');
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(isRetryableRenameError(new Error('no code'))).toBe(false);
    expect(isRetryableRenameError(null)).toBe(false);
  });

  it('sleepSync waits for about the requested time', () => {
    const start = Date.now();
    sleepSync(15);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });
});

describe.each([
  ['durable-store', durableStoreWrite],
  ['harness-routing storage', harnessStorageWrite]
])('atomicDurableWrite (%s) on a locked target', (_name, write) => {
  const lockedFs = (failures: number, code = 'EPERM') => {
    let rename = failures;
    return {
      readFile: (path: string) => readFileSync(path),
      open: (path: string, flags: string, mode?: number) => openSync(path, flags, mode),
      writeFile: (fd: number, bytes: Buffer) => writeFileSync(fd, bytes),
      fsync: (fd: number) => fsyncSync(fd),
      close: (fd: number) => closeSync(fd),
      rename: (from: string, to: string) => {
        if (rename-- > 0) throw errno(code);
        renameSync(from, to);
      },
      unlink: (path: string) => rmSync(path)
    };
  };

  it('replaces the file after transient EPERM failures', () => {
    const dir = root();
    const target = join(dir, 'projects.json');
    writeFileSync(target, 'old');
    write(target, Buffer.from('new'), { fs: lockedFs(3), sleep: () => undefined });
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['projects.json']);
  });

  it('keeps the error and removes the temp file when the lock never clears', () => {
    const dir = root();
    const target = join(dir, 'projects.json');
    writeFileSync(target, 'old');
    expect(() => write(target, Buffer.from('new'), { fs: lockedFs(1000), sleep: () => undefined })).toThrow('EPERM');
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['projects.json']);
  });
});
