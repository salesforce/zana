import { lstat, readdir } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { isFsErrorWithCode } from "./fs-errors.js";

/**
 * Bounded, child-process-free disk usage walker.
 *
 * Reports allocated bytes (blocks * 512, what `du` reports), never follows a
 * symbolic link, counts a hard-linked file once, yields to the event loop on
 * every filesystem call, and stops at an entry cap or a deadline. A walk that
 * stopped early, or skipped something it could not read, reports
 * `partial: true`: the size is then a lower bound, never an overstatement.
 */

const DIRECTORY_CONCURRENCY = 4;
const ENTRY_CHUNK = 32;
const DEFAULT_LISTED_LARGE_FILES = 1000;
const BLOCK_BYTES = 512;

export interface MeasureOptions {
  readonly signal: AbortSignal;
  /** Regular files at or above this many allocated bytes are counted as large. */
  readonly largeFileMinBytes: number | null;
  /** Also list the largest large files (capped); otherwise only count them. */
  readonly collectLargeFiles: boolean;
  /** Stop after visiting this many entries. */
  readonly maxFiles: number;
  /** Stop once `Date.now()` passes this instant. */
  readonly deadlineAt: number;
  readonly maxListedLargeFiles?: number;
}

export interface LargeFile {
  readonly path: string;
  readonly sizeBytes: number;
}

export interface TreeUsage {
  readonly sizeBytes: number;
  readonly entryCount: number;
  readonly partial: boolean;
  readonly largeCount: number;
  readonly largeBytes: number;
  readonly largeFiles: readonly LargeFile[];
  readonly largeTruncated: boolean;
}

/** Bytes actually allocated on disk (what `du` reports); apparent size where blocks are not reported. */
export const allocatedBytes = (stats: BigIntStats): number =>
  process.platform === "win32" ? Number(stats.size) : Number(stats.blocks) * BLOCK_BYTES;

const bySizeThenPath = (a: LargeFile, b: LargeFile): number =>
  b.sizeBytes - a.sizeBytes || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Measure one file or directory tree. Resolves `null` when the root does not
 * exist; rejects with the abort reason when `signal` aborts.
 */
export async function measureTree(root: string, options: MeasureOptions): Promise<TreeUsage | null> {
  const { signal, largeFileMinBytes, collectLargeFiles, maxFiles, deadlineAt } = options;
  const listCap = Math.max(0, options.maxListedLargeFiles ?? DEFAULT_LISTED_LARGE_FILES);
  signal.throwIfAborted();

  let rootStats: BigIntStats;
  try {
    rootStats = await lstat(root, { bigint: true });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT") || isFsErrorWithCode(error, "ENOTDIR")) return null;
    throw error;
  }

  let sizeBytes = 0;
  let entryCount = 0;
  let largeCount = 0;
  let largeBytes = 0;
  let visited = 0;
  let partial = false;
  let stopped = false;
  let largeFiles: LargeFile[] = [];
  const seenLinks = new Set<string>();
  const pending: string[] = [];

  const account = (entryPath: string, stats: BigIntStats): void => {
    if (!stats.isDirectory() && stats.nlink > 1n) {
      const key = `${stats.dev}:${stats.ino}`;
      if (seenLinks.has(key)) return;
      seenLinks.add(key);
    }
    const bytes = allocatedBytes(stats);
    sizeBytes += bytes;
    entryCount += 1;
    if (stats.isDirectory()) {
      pending.push(entryPath);
      return;
    }
    if (largeFileMinBytes === null || !stats.isFile() || bytes < largeFileMinBytes) return;
    largeCount += 1;
    largeBytes += bytes;
    if (!collectLargeFiles || listCap === 0) return;
    largeFiles.push({ path: entryPath, sizeBytes: bytes });
    if (largeFiles.length >= listCap * 2) largeFiles = largeFiles.sort(bySizeThenPath).slice(0, listCap);
  };

  const outOfBudget = (): boolean => {
    if (stopped) return true;
    if (visited > maxFiles || Date.now() > deadlineAt) {
      partial = true;
      stopped = true;
    }
    return stopped;
  };

  const visit = async (entryPath: string): Promise<void> => {
    try {
      account(entryPath, await lstat(entryPath, { bigint: true }));
    } catch (error) {
      // Vanishing mid-walk is normal (a concurrent cleanup); anything else
      // means this entry is not counted, so the total is a lower bound.
      if (!isFsErrorWithCode(error, "ENOENT") && !isFsErrorWithCode(error, "ENOTDIR")) partial = true;
    }
  };

  const scanDirectory = async (directory: string): Promise<void> => {
    signal.throwIfAborted();
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (!isFsErrorWithCode(error, "ENOENT") && !isFsErrorWithCode(error, "ENOTDIR")) partial = true;
      return;
    }
    for (let offset = 0; offset < names.length; offset += ENTRY_CHUNK) {
      signal.throwIfAborted();
      const chunk = names.slice(offset, offset + ENTRY_CHUNK);
      visited += chunk.length;
      if (outOfBudget()) return;
      await Promise.all(chunk.map((name) => visit(path.join(directory, name))));
    }
  };

  account(root, rootStats);

  await new Promise<void>((resolve, reject) => {
    let active = 0;
    let failed = false;
    let failure: unknown;
    const pump = (): void => {
      while (!failed && !stopped && active < DIRECTORY_CONCURRENCY && pending.length > 0) {
        const directory = pending.pop() as string;
        active += 1;
        scanDirectory(directory)
          .catch((error: unknown) => {
            if (!failed) {
              failed = true;
              failure = error;
            }
          })
          .finally(() => {
            active -= 1;
            pump();
          });
      }
      if (active === 0 && (failed || stopped || pending.length === 0)) {
        if (failed) reject(failure);
        else resolve();
      }
    };
    pump();
  });

  largeFiles = largeFiles.sort(bySizeThenPath).slice(0, listCap);
  return {
    sizeBytes,
    entryCount,
    partial,
    largeCount,
    largeBytes,
    largeFiles,
    largeTruncated: collectLargeFiles && largeCount > largeFiles.length,
  };
}
