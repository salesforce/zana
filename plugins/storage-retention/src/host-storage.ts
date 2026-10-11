import { mkdir, lstat, opendir, readdir, realpath, rename, rm, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { allocatedBytes, measureTree } from "./disk-usage.js";
import { isFsErrorWithCode } from "./fs-errors.js";
import type { hostStorageContract } from "./host-contract.js";
import {
  assertStorageEntry,
  insideRoot,
  isStorageEntry,
  isThreadEntry,
  isTrashEntry,
  trashNameFor,
} from "./storage-entry.js";

type Input<Method extends keyof typeof hostStorageContract> = z.input<
  (typeof hostStorageContract)[Method]["input"]
>;
type Output<Method extends keyof typeof hostStorageContract> = z.output<
  (typeof hostStorageContract)[Method]["output"]
>;

/** What the handlers need from the host call context; tests pass their own. */
export interface HostStorageEnv {
  /** Absolute thread-storage root the daemon computed for itself; never client input. */
  readonly threadStorageRoot: string | null;
  readonly signal: AbortSignal;
  readonly retainWorker: () => { dispose(): Promise<void> };
  readonly now?: () => number;
  /** Test seam: shorten the time `discardLargeFiles` may spend on one call. */
  readonly clearLargeBudgetMs?: number;
}

const ENTRY_DEADLINE_MS = 60_000;
const MIN_ENTRY_DEADLINE_MS = 1_000;
const CLEAR_LARGE_MAX_ENTRIES = 5_000_000;
const CLEAR_LARGE_MAX_LISTED = 100_000;
/** One call's whole budget for walking and deleting; the server's call timeout is 300 s. */
const CLEAR_LARGE_BUDGET_MS = 240_000;

const isGone = (error: unknown) => isFsErrorWithCode(error, "ENOENT") || isFsErrorWithCode(error, "ENOTDIR");
/** Entries one orphan folder may hold and still be proven untouched; a bigger tree counts as recent. */
const QUIET_CHECK_MAX_ENTRIES = 20_000;

/**
 * True when nothing beneath `directory` was modified after `cutoff`. A folder's own mtime only moves when
 * its direct children change, so a write deep inside is found by walking. Symbolic links are never
 * followed. Anything that cannot be read, or a tree over the cap, counts as recently modified.
 */
async function untouchedSince(directory: string, cutoff: number, signal: AbortSignal): Promise<boolean> {
  const pending = [directory];
  let visited = 0;
  while (pending.length > 0) {
    signal.throwIfAborted();
    const current = pending.pop()!;
    let names: string[];
    try {
      names = await readdir(current);
    } catch (error) {
      if (isGone(error)) continue;
      return false;
    }
    for (const name of names) {
      if (++visited > QUIET_CHECK_MAX_ENTRIES) return false;
      const child = path.join(current, name);
      let stats;
      try {
        stats = await lstat(child);
      } catch (error) {
        if (isGone(error)) continue;
        return false;
      }
      if (stats.mtimeMs > cutoff) return false;
      if (stats.isDirectory()) pending.push(child);
    }
  }
  return true;
}

function requireRoot(env: HostStorageEnv): string {
  if (env.threadStorageRoot === null)
    throw new Error("This machine did not report a thread-storage root");
  return env.threadStorageRoot;
}

/** The real path of the configured root, or null when it does not exist yet. */
async function resolveRoot(configured: string): Promise<string | null> {
  try {
    return await realpath(configured);
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
}

async function capacity(start: string) {
  for (let current = start; ; current = path.dirname(current)) {
    try {
      const stats = await statfs(current);
      return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
    } catch (error) {
      if (!isFsErrorWithCode(error, "ENOENT") || current === path.dirname(current)) return null;
    }
  }
}

export async function listLayout(env: HostStorageEnv, input: Input<"layout">): Promise<Output<"layout">> {
  const configured = requireRoot(env);
  const root = await resolveRoot(configured);
  const disk = await capacity(root ?? configured);
  if (root === null) return { disk, names: [], next: null };
  env.signal.throwIfAborted();
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && isStorageEntry(entry.name))
    .map((entry) => entry.name)
    .sort();
  const remaining = input.after === null ? names : names.filter((name) => name > (input.after as string));
  const page = remaining.slice(0, input.limit);
  return { disk, names: page, next: remaining.length > page.length ? (page.at(-1) ?? null) : null };
}

export async function measureEntries(
  env: HostStorageEnv,
  input: Input<"measureEntries">,
): Promise<Output<"measureEntries">> {
  const configured = requireRoot(env);
  for (const name of input.names) assertStorageEntry(configured, name);
  const root = await resolveRoot(configured);
  if (root === null) return { entries: [], skipped: [], missing: [...input.names] };
  const now = env.now ?? Date.now;
  const started = now();
  const entries: Output<"measureEntries">["entries"] = [];
  const missing: string[] = [];
  for (const [index, name] of input.names.entries()) {
    env.signal.throwIfAborted();
    const elapsed = now() - started;
    // Always finish one folder so a tiny budget still makes progress.
    if (index > 0 && elapsed >= input.budgetMs)
      return { entries, missing, skipped: input.names.slice(index) };
    const allowance = Math.max(MIN_ENTRY_DEADLINE_MS, Math.min(ENTRY_DEADLINE_MS, input.budgetMs - elapsed));
    const usage = await measureTree(path.join(root, name), {
      signal: env.signal,
      largeFileMinBytes: input.largeFileMinBytes,
      collectLargeFiles: false,
      maxFiles: input.maxFilesPerEntry,
      deadlineAt: Date.now() + allowance,
    });
    if (usage === null) missing.push(name);
    else
      entries.push({
        name,
        sizeBytes: usage.sizeBytes,
        partial: usage.partial,
        largeCount: usage.largeCount,
        largeBytes: usage.largeBytes,
      });
  }
  return { entries, missing, skipped: [] };
}

export async function discardEntries(env: HostStorageEnv, input: Input<"discard">): Promise<Output<"discard">> {
  const configured = requireRoot(env);
  for (const name of input.names) {
    assertStorageEntry(configured, name);
    if (input.recreate && isTrashEntry(name)) throw new Error("Cannot recreate a trash directory");
  }
  env.signal.throwIfAborted();
  const root = await resolveRoot(configured);
  if (root === null) return { removed: [], skipped: [], empty: [...input.names] };
  const now = env.now ?? Date.now;
  const removed: string[] = [];
  const skipped: string[] = [];
  const empty: string[] = [];
  const trashes: string[] = [];
  try {
    for (const name of input.names) {
      env.signal.throwIfAborted();
      const source = path.join(root, name);
      if (!insideRoot(root, source)) {
        skipped.push(name);
        continue;
      }
      let stats;
      try {
        stats = await lstat(source);
      } catch (error) {
        if (!isGone(error)) throw error;
        empty.push(name);
        continue;
      }
      // A symbolic link (or anything but a plain directory) is never followed or renamed.
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        skipped.push(name);
        continue;
      }
      if (
        input.minAgeMs !== null &&
        (now() - stats.mtimeMs < input.minAgeMs || !(await untouchedSince(source, now() - input.minAgeMs, env.signal)))
      ) {
        skipped.push(name);
        continue;
      }
      if (input.recreate && (await isEmptyDirectory(source))) {
        empty.push(name);
        continue;
      }
      const trash = isTrashEntry(name) ? source : path.join(root, trashNameFor(name));
      if (trash !== source) await rename(source, trash);
      trashes.push(trash);
      removed.push(name);
      if (input.recreate)
        await mkdir(source, { mode: 0o700 }).catch((error: unknown) => {
          if (!isFsErrorWithCode(error, "EEXIST")) throw error;
        });
    }
  } finally {
    if (trashes.length > 0) {
      // The folders are already out of the way; deleting them may outlive this call.
      const lease = env.retainWorker();
      void (async () => {
        for (const trash of trashes)
          await rm(trash, { recursive: true, force: true }).catch((error: unknown) => {
            console.error("Storage trash cleanup failed", error);
          });
      })().finally(() => lease.dispose().catch(() => undefined));
    }
  }
  return { removed, skipped, empty };
}

async function isEmptyDirectory(directory: string): Promise<boolean> {
  const handle = await opendir(directory);
  try {
    return (await handle.read()) === null;
  } finally {
    await handle.close();
  }
}

export async function discardLargeFiles(
  env: HostStorageEnv,
  input: Input<"discardLargeFiles">,
): Promise<Output<"discardLargeFiles">> {
  const configured = requireRoot(env);
  for (const name of input.names) {
    assertStorageEntry(configured, name);
    if (!isThreadEntry(name)) throw new Error("Invalid storage entry");
  }
  const root = await resolveRoot(configured);
  if (root === null) return { removed: [], skipped: [] };
  const removed: Output<"discardLargeFiles">["removed"] = [];
  const skipped: string[] = [];
  // One budget for the whole call, so a batch of huge folders cannot outlast the caller.
  const deadlineAt = Date.now() + (env.clearLargeBudgetMs ?? CLEAR_LARGE_BUDGET_MS);
  for (const name of input.names) {
    env.signal.throwIfAborted();
    const directory = path.join(root, name);
    let stats;
    try {
      stats = await lstat(directory);
    } catch (error) {
      if (isGone(error)) continue;
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      skipped.push(name);
      continue;
    }
    const usage = await measureTree(directory, {
      signal: env.signal,
      largeFileMinBytes: input.minBytes,
      collectLargeFiles: true,
      maxListedLargeFiles: CLEAR_LARGE_MAX_LISTED,
      maxFiles: CLEAR_LARGE_MAX_ENTRIES,
      deadlineAt,
    });
    let sizeBytes = 0;
    let count = 0;
    for (const file of usage?.largeFiles ?? []) {
      env.signal.throwIfAborted();
      if (!insideRoot(directory, file.path)) throw new Error("Large file must be inside its storage directory");
      try {
        // Re-check at the moment of deletion: only a plain file, still large,
        // reached without crossing any symbolic link.
        const current = await lstat(file.path, { bigint: true });
        if (!current.isFile()) continue;
        const currentBytes = allocatedBytes(current);
        if (currentBytes < input.minBytes) continue;
        if ((await realpath(file.path)) !== file.path) continue;
        env.signal.throwIfAborted();
        await unlink(file.path);
        sizeBytes += currentBytes;
        count += 1;
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    }
    removed.push({ name, sizeBytes, count });
    // A walk that ran out of time or room may have left large files behind:
    // report what was deleted, but do not claim the folder is done.
    if (usage?.partial || usage?.largeTruncated) skipped.push(name);
  }
  return { removed, skipped };
}
