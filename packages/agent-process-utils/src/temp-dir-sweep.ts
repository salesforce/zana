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

/** Temp dir prefix of provider bridges. */
export const BRIDGE_TEMP_DIR_PREFIX = PLUGIN_TEMP_DIR_PREFIXES[0];
/** Temp dir prefix of host plugin workers. */
export const HOST_TEMP_DIR_PREFIX = PLUGIN_TEMP_DIR_PREFIXES[1];

export interface SweepOrphanTempDirsOptions {
  /** Directory to scan. Defaults to `os.tmpdir()`. */
  tempRoot?: string;
  /** Temp dir prefixes to consider, e.g. `bb-provider-bridge`, `zcc-host`. */
  prefixes: readonly string[];
  /** Liveness probe for an owner pid. Defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  /**
   * Cap on orphans picked up per sweep. Live, current and recent dirs are
   * filtered out first and never use it up. Defaults to 200.
   */
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
/** Matching names examined (one `lstat` each) per sweep, orphan or not. */
const MAX_INSPECTED_PER_SWEEP = 5_000;
/** Raw entries read from the temp folder per sweep, matching or not. */
const MAX_SCANNED_ENTRIES = 100_000;
/** Pid reuse guard: a dir touched this recently may belong to a new owner. */
const RECENT_MS = 10 * 60 * 1000;

/**
 * Marks a name as the pid format: `<prefix>-<pid>@<plugin id>-<random>`.
 * `encodeURIComponent` always escapes `@`, so no old-format name (which had
 * `<prefix>-<plugin id>-<random>`, an id that may start with digits, as in
 * `zcc-host-42-tools-abc`) can carry it. An old-format dir is never read as
 * owned by a pid and is left alone.
 */
export const OWNER_PID_MARKER = "@";

/**
 * The temp dir `os.tmpdir()` would give a process started with `env`: what a
 * child reads from its own environment, which can differ from the parent's.
 */
export function tempDirForEnv(env: NodeJS.ProcessEnv): string {
  const fromEnv = process.platform === "win32"
    ? env.TEMP || env.TMP
    : env.TMPDIR || env.TMP || env.TEMP;
  return fromEnv === undefined || fromEnv === "" ? tmpdir() : fromEnv;
}

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
 * Names that look like `<prefix>-<pid>@...`, read as a stream so a temp folder
 * with tens of thousands of unrelated entries costs no memory and does not
 * use up any cap: only matches are yielded.
 */
async function* matchingNames(
  tempRoot: string,
  pattern: RegExp,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  let dir;
  try {
    dir = await opendir(tempRoot);
  } catch (error) {
    // A missing temp folder is a clean state; anything else (EACCES, EMFILE)
    // is a failure the caller should see.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return;
  }
  let scanned = 0;
  try {
    for await (const entry of dir) {
      scanned += 1;
      if (signal?.aborted === true || scanned > MAX_SCANNED_ENTRIES) break;
      if (pattern.test(entry.name)) yield entry.name;
    }
  } finally {
    await dir.close().catch(() => undefined);
  }
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
 * Only `<prefix>-<pid>@...` names are considered. Live and current pids and
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
    `^(?:${options.prefixes.map(escapeRegExp).join("|")})-(\\d+)${OWNER_PID_MARKER}`,
  );
  const result: SweepOrphanTempDirsResult = {
    inspected: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
  };
  const limit = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  // Filter first, cap after: live, current and recent dirs are skipped
  // cheaply and never fill the cap, so they cannot starve real orphans.
  // Removal starts only once the folder has been read.
  const orphans: string[] = [];
  try {
    for await (const name of matchingNames(tempRoot, pattern, options.signal)) {
      if (result.inspected >= MAX_INSPECTED_PER_SWEEP || orphans.length >= limit) break;
      result.inspected += 1;
      const path = join(tempRoot, name);
      try {
        const pid = Number(pattern.exec(name)?.[1]);
        if (isOrphan(await lstat(path), pid, now(), isAlive)) orphans.push(name);
        else result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        options.onFailure?.(path, error);
      }
    }
  } catch (error) {
    options.onFailure?.(tempRoot, error);
    return { ...result, failed: result.failed + 1 };
  }
  for (const name of orphans) {
    if (result.removed >= MAX_REMOVED_PER_SWEEP) break;
    if (options.signal?.aborted === true) break;
    const path = join(tempRoot, name);
    try {
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
 * Remove the temp dir `<prefix>-<pid>@*` that a process left behind once it
 * has exited, for the parent that knows the pid. The folder is read as a
 * stream and the exact `<prefix>-<pid>@` prefix is matched, so a pid that is a
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
  // first match instead of scanning all of it.
  const pattern = new RegExp(`^${escapeRegExp(options.prefix)}-${pid}${OWNER_PID_MARKER}`);
  try {
    for await (const name of matchingNames(tempRoot, pattern, undefined)) {
      const path = join(tempRoot, name);
      try {
        await removeTreeWithoutFollowingLinksAsync(path);
        result.removed += 1;
      } catch (error) {
        result.failures.push({ path, error });
      }
      break;
    }
  } catch (error) {
    result.failures.push({ path: tempRoot, error });
  }
  return result;
}
