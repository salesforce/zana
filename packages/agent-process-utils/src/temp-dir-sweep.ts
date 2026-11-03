import { type Stats } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTreeWithoutFollowingLinksAsync } from "./remove-tree.js";

/** The temp dir prefixes of plugin processes: provider bridges and host workers. */
export const PLUGIN_TEMP_DIR_PREFIXES = [
  "bb-provider-bridge",
  "zcc-host",
] as const;

export interface SweepOrphanTempDirsOptions {
  /** Directory to scan. Defaults to `os.tmpdir()`. */
  tempRoot?: string;
  /** Temp dir prefixes to consider, e.g. `bb-provider-bridge`, `zcc-host`. */
  prefixes: readonly string[];
  /** Liveness probe for an owner pid. Defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  /** Cap on matching candidates inspected per sweep. Defaults to 200. */
  maxEntries?: number;
  /** Clock for the recent-modification guard. Defaults to `Date.now`. */
  now?: () => number;
  /** Stops the sweep between entries, for example on shutdown. */
  signal?: AbortSignal;
  /** Called with the path and error of each dir that could not be removed. */
  onFailure?: (path: string, error: unknown) => void;
}

export interface SweepOrphanTempDirsResult {
  inspected: number;
  removed: number;
  skipped: number;
  failed: number;
}

const DEFAULT_MAX_ENTRIES = 200;
const MAX_REMOVED_PER_SWEEP = 50;
/** Raw entries read from the temp folder per sweep, matching or not. */
const MAX_SCANNED_ENTRIES = 100_000;
/** Pid reuse guard: a dir touched this recently may belong to a new owner. */
const RECENT_MS = 10 * 60 * 1000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Names that look like `<prefix>-<pid>-...`, read as a stream so a temp folder
 * with tens of thousands of unrelated entries costs no memory and does not
 * use up the cap: only matches count towards `limit`.
 *
 * A plugin id that starts with digits makes an old-format name such as
 * `zcc-host-42-tools-abc` look like pid 42. That dir is still removed with the
 * link-safe walk and only when pid 42 is dead and the dir is not recent.
 */
async function matchingNames(
  tempRoot: string,
  pattern: RegExp,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const names: string[] = [];
  let dir;
  try {
    dir = await opendir(tempRoot);
  } catch (error) {
    // A missing temp folder is a clean state; anything else (EACCES, EMFILE)
    // is a failure the caller should see.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return names;
  }
  let scanned = 0;
  try {
    for await (const entry of dir) {
      scanned += 1;
      if (signal?.aborted === true || scanned > MAX_SCANNED_ENTRIES) break;
      if (!pattern.test(entry.name)) continue;
      names.push(entry.name);
      if (names.length >= limit) break;
    }
  } finally {
    await dir.close().catch(() => undefined);
  }
  return names;
}

/** A dir to remove: a real directory, not ours, not recent, owner gone. */
function isOrphan(
  stat: Stats,
  pid: number,
  nowMs: number,
  isAlive: (pid: number) => boolean,
): boolean {
  return (
    stat.isDirectory() &&
    Number.isSafeInteger(pid) &&
    pid > 0 &&
    pid !== process.pid &&
    nowMs - stat.mtimeMs >= RECENT_MS &&
    !isAlive(pid)
  );
}

/**
 * Remove temp dirs left behind by plugin processes that no longer exist.
 *
 * Only `<prefix>-<pid>-...` names are considered. Live and current pids and
 * recently modified dirs are skipped; the rest go through the link-safe async
 * remove. Bounded (matching candidates inspected, dirs removed) and never
 * throws for one dir: errors are counted in `failed`. Run it in the
 * background, never on a hot path.
 */
export async function sweepOrphanTempDirs(
  options: SweepOrphanTempDirsOptions,
): Promise<SweepOrphanTempDirsResult> {
  const tempRoot = options.tempRoot ?? tmpdir();
  const isAlive = options.isAlive ?? processIsAlive;
  const now = options.now ?? Date.now;
  const pattern = new RegExp(
    `^(?:${options.prefixes.map(escapeRegExp).join("|")})-(\\d+)-`,
  );
  const result: SweepOrphanTempDirsResult = {
    inspected: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
  };
  let names: string[];
  try {
    names = await matchingNames(
      tempRoot,
      pattern,
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      options.signal,
    );
  } catch (error) {
    options.onFailure?.(tempRoot, error);
    return { ...result, failed: 1 };
  }
  for (const name of names) {
    if (result.removed >= MAX_REMOVED_PER_SWEEP) break;
    if (options.signal?.aborted === true) break;
    result.inspected += 1;
    const path = join(tempRoot, name);
    try {
      const pid = Number(pattern.exec(name)?.[1]);
      if (!isOrphan(await lstat(path), pid, now(), isAlive)) {
        result.skipped += 1;
        continue;
      }
      await removeTreeWithoutFollowingLinksAsync(path);
      result.removed += 1;
    } catch (error) {
      result.failed += 1;
      options.onFailure?.(path, error);
    }
  }
  return result;
}

export interface RemoveOwnedTempDirsResult {
  removed: number;
  /** One entry per dir that could not be removed. */
  failures: { path: string; error: unknown }[];
}

/**
 * Remove the temp dirs `<prefix>-<pid>-*` that a process left behind once it
 * has exited, for the parent that knows the pid. The folder is read as a
 * stream and the exact `<prefix>-<pid>-` prefix is matched, so a pid that is a
 * prefix of another (12 and 123) never matches the other's dirs. A failure on
 * one dir is recorded and the rest are still tried. A pid that is alive again
 * (reused by a new process) is left alone.
 */
export async function removeOwnedTempDirs(options: {
  prefix: string;
  pid: number | undefined;
  tempRoot?: string;
  isAlive?: (pid: number) => boolean;
}): Promise<RemoveOwnedTempDirsResult> {
  const result: RemoveOwnedTempDirsResult = { removed: 0, failures: [] };
  const { pid } = options;
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) return result;
  const tempRoot = options.tempRoot ?? tmpdir();
  const isAlive = options.isAlive ?? processIsAlive;
  if (isAlive(pid)) return result;
  // A process creates one such dir, so stop reading the temp folder at the
  // first match instead of scanning all of it on every exit.
  let names: string[];
  try {
    names = await matchingNames(
      tempRoot,
      new RegExp(`^${escapeRegExp(options.prefix)}-${pid}-`),
      1,
      undefined,
    );
  } catch (error) {
    result.failures.push({ path: tempRoot, error });
    return result;
  }
  for (const name of names) {
    const path = join(tempRoot, name);
    try {
      await removeTreeWithoutFollowingLinksAsync(path);
      result.removed += 1;
    } catch (error) {
      result.failures.push({ path, error });
    }
  }
  return result;
}
