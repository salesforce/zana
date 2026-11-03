import { lstat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTreeWithoutFollowingLinksAsync } from "./remove-tree.js";

export interface SweepOrphanTempDirsOptions {
  /** Directory to scan. Defaults to `os.tmpdir()`. */
  tempRoot?: string;
  /** Temp dir prefixes to consider, e.g. `bb-provider-bridge`, `zcc-host`. */
  prefixes: readonly string[];
  /** Liveness probe for an owner pid. Defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  /** Cap on entries inspected per sweep. Defaults to 200. */
  maxEntries?: number;
  /** Clock for the recent-modification guard. Defaults to `Date.now`. */
  now?: () => number;
}

export interface SweepOrphanTempDirsResult {
  inspected: number;
  removed: number;
  skipped: number;
  failed: number;
}

const DEFAULT_MAX_ENTRIES = 200;
const MAX_REMOVED_PER_SWEEP = 50;
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
 * Remove temp dirs left behind by plugin processes that no longer exist.
 *
 * Only `<prefix>-<pid>-...` names are considered, so dirs from before the pid
 * was added to the name are left alone. Live and current pids and recently
 * modified dirs are skipped; the rest go through the link-safe async remove.
 * Bounded (entries inspected, dirs removed) and never throws for one dir:
 * errors are counted in `failed`. Run it in the background, never on a hot path.
 */
export async function sweepOrphanTempDirs(
  options: SweepOrphanTempDirsOptions,
): Promise<SweepOrphanTempDirsResult> {
  const tempRoot = options.tempRoot ?? tmpdir();
  const isAlive = options.isAlive ?? processIsAlive;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const result: SweepOrphanTempDirsResult = {
    inspected: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
  };
  const pattern = new RegExp(
    `^(?:${options.prefixes.map(escapeRegExp).join("|")})-(\\d+)-`,
  );

  let names: string[];
  try {
    names = await readdir(tempRoot);
  } catch {
    return result;
  }

  for (const name of names.slice(0, maxEntries)) {
    if (result.removed >= MAX_REMOVED_PER_SWEEP) break;
    result.inspected += 1;
    const match = pattern.exec(name);
    if (match === null) {
      result.skipped += 1;
      continue;
    }
    const pid = Number(match[1]);
    const path = join(tempRoot, name);
    try {
      const stat = await lstat(path);
      const isRealDirOrLink = stat.isDirectory() || stat.isSymbolicLink();
      if (
        !isRealDirOrLink ||
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        pid === process.pid ||
        now() - stat.mtimeMs < RECENT_MS ||
        isAlive(pid)
      ) {
        result.skipped += 1;
        continue;
      }
      await removeTreeWithoutFollowingLinksAsync(path);
      result.removed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
