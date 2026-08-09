/**
 * Resolves which Codex rollout file belongs to a live Codex PTY session.
 *
 * WHY THIS EXISTS: Claude lets us FORCE a session id at spawn (`--session-id
 * <uuid>`), so the transcript path is a pure derivation from ids we already hold.
 * Codex has no such flag — it MINTS its own UUID and writes it into the opening
 * `session_meta` line of a rollout file at
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<local-ts>-<UUID>.jsonl
 * So for Codex, session identity must be DETECTED after spawn, not minted before.
 *
 * The detection heuristic: a freshly-spawned Codex session writes a NEW rollout
 * file whose `session_meta.cwd` equals the session's cwd and whose file
 * birthtime is at/after the spawn time. We scan the (small, date-bucketed)
 * sessions tree for candidates created since spawn, read only each candidate's
 * FIRST line to match cwd, and pick the earliest-created match (the session's
 * own file, not a later sibling). The match is CACHED per PTY session id so the
 * scan runs at most a handful of times before the file appears.
 *
 * Every operation is bounded (only day-dirs on/after the spawn date, a hard file
 * cap) and defensive (missing dir / unreadable file → no match, never throws),
 * mirroring the never-throw contract of the transcript readers. The resolved
 * UUID feeds `codex resume <UUID>` (stable per-tab resume) and the rollout path
 * feeds the Codex transcript reader.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';

/** Root of Codex's rollout store. Overridable for tests via {@link CodexSessionResolver}. */
export function codexSessionsRoot(): string {
  return join(homedir(), '.codex', 'sessions');
}

/** A resolved Codex session: its minted UUID and the rollout file path. */
export interface CodexSessionMatch {
  /** The UUID Codex minted (from `session_meta.payload.id`); feeds `codex resume`. */
  sessionId: string;
  /** Absolute path to the rollout `.jsonl`; feeds the Codex transcript reader. */
  rolloutPath: string;
}

interface ResolverDeps {
  /** Sessions root; injectable for tests. Defaults to `~/.codex/sessions`. */
  root?: string;
  /** Current epoch ms; injectable for tests. */
  now?: () => number;
  /** Max rollout files to inspect in one scan (Rule 5 bound). */
  maxFilesPerScan?: number;
}

/** Read the first line of a rollout file and return {cwd, id} from session_meta. */
async function readRolloutHead(path: string): Promise<{ cwd?: string; id?: string } | null> {
  try {
    // Rollout files open with a single-line `session_meta`; we only need bytes up
    // to the first newline, but the meta line embeds full base_instructions and
    // can be tens of KB, so cap the read generously rather than streaming.
    const raw = await readFile(path, 'utf8');
    const nl = raw.indexOf('\n');
    const firstLine = nl === -1 ? raw : raw.slice(0, nl);
    const obj = JSON.parse(firstLine) as { type?: string; payload?: { cwd?: string; id?: string } };
    if (obj?.type !== 'session_meta') return null;
    return { cwd: obj.payload?.cwd, id: obj.payload?.id };
  } catch {
    return null;
  }
}

/**
 * Enumerate rollout file paths under the sessions root, newest date-buckets
 * first, stopping once `limit` files are collected. Date buckets are
 * `YYYY/MM/DD`; we only descend into buckets whose date is on/after
 * `sinceDateKey` (a `YYYY/MM/DD` string) so a session that spawned today never
 * scans years of history. Never throws — a missing/unreadable dir is skipped.
 */
async function listRolloutFiles(
  root: string,
  sinceDateKey: string,
  limit: number
): Promise<string[]> {
  const out: string[] = [];
  const safeReaddir = async (dir: string): Promise<string[]> => {
    try {
      return (await readdir(dir)).sort().reverse(); // newest-first by lexical date
    } catch {
      return [];
    }
  };

  const years = await safeReaddir(root);
  for (const y of years) {
    if (out.length >= limit) break;
    const months = await safeReaddir(join(root, y));
    for (const m of months) {
      if (out.length >= limit) break;
      const days = await safeReaddir(join(root, y, m));
      for (const d of days) {
        if (out.length >= limit) break;
        const dateKey = `${y}/${m}/${d}`;
        // Skip buckets strictly before the spawn date (lexical compare is valid
        // for zero-padded YYYY/MM/DD).
        if (dateKey < sinceDateKey) continue;
        const files = await safeReaddir(join(root, y, m, d));
        for (const f of files) {
          if (!f.startsWith('rollout-') || !f.endsWith('.jsonl')) continue;
          out.push(join(root, y, m, d, f));
          if (out.length >= limit) break;
        }
      }
    }
  }
  return out;
}

/** `YYYY/MM/DD` for an epoch-ms instant in LOCAL time (buckets are local-tz). */
function dateKeyOf(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/**
 * Resolves + caches Codex rollout files for live PTY sessions. One instance per
 * app; `resolve()` is called (e.g. from a transcript read) with the session's
 * cwd + spawn time and returns the match once the rollout file has appeared.
 *
 * Caching: a successful match is memoized by the caller-supplied `key` (the PTY
 * session id) so subsequent reads skip the scan. A negative result is NOT cached
 * — the file may not exist yet (Codex writes it a beat after spawn), so a later
 * call retries.
 */
export class CodexSessionResolver {
  private readonly root: string;
  private readonly now: () => number;
  private readonly maxFilesPerScan: number;
  private readonly cache = new Map<string, CodexSessionMatch>();

  constructor(deps: ResolverDeps = {}) {
    this.root = deps.root ?? codexSessionsRoot();
    this.now = deps.now ?? Date.now;
    this.maxFilesPerScan = deps.maxFilesPerScan ?? 200;
  }

  /** Drop a cached match (call on session close to free memory — Rule 5). */
  forget(key: string): void {
    this.cache.delete(key);
  }

  /** Number of cached matches (test/introspection helper). */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Resolve the rollout for a Codex session identified by `key`, spawned at
   * `spawnedAtMs` with the given `cwd`. Returns the cached match if known, else
   * scans for a rollout whose `session_meta.cwd` matches and whose file was
   * created at/after the spawn (minus a small clock-skew slack). Picks the
   * EARLIEST-created match so a later sibling in the same cwd isn't mistaken for
   * this session. Returns null (uncached) until the file appears. Never throws.
   */
  async resolve(key: string, cwd: string, spawnedAtMs: number): Promise<CodexSessionMatch | null> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Allow a small negative slack: the rollout's birthtime can lag the PTY
    // spawn by a fraction of a second, and clocks aren't perfectly aligned.
    const floor = spawnedAtMs - 5_000;
    const sinceDateKey = dateKeyOf(floor);
    const files = await listRolloutFiles(this.root, sinceDateKey, this.maxFilesPerScan);

    let best: { match: CodexSessionMatch; birthMs: number } | null = null;
    for (const path of files) {
      let birthMs: number;
      try {
        const s = await stat(path);
        // birthtime is the creation instant; fall back to mtime where birthtime
        // is unsupported (0 on some filesystems).
        birthMs = s.birthtimeMs || s.mtimeMs;
      } catch {
        continue;
      }
      if (birthMs < floor) continue;

      const head = await readRolloutHead(path);
      if (!head || head.cwd !== cwd || !head.id) continue;

      if (!best || birthMs < best.birthMs) {
        best = { match: { sessionId: head.id, rolloutPath: path }, birthMs };
      }
    }

    if (best) {
      this.cache.set(key, best.match);
      return best.match;
    }
    return null;
  }
}
