/**
 * Resolves which OpenCode session id belongs to a live OpenCode PTY session.
 *
 * WHY THIS EXISTS: like Codex, OpenCode has no flag to FORCE a session id at
 * spawn — it mints its own `ses_<hex>` id server-side into a SQLite store at
 * `~/.local/share/opencode/opencode.db`, so identity must be DETECTED after
 * spawn, not minted before (mirrors `CodexSessionResolver`'s doc comment).
 *
 * Unlike Codex (a filesystem scan of rollout files), detection here goes
 * through OpenCode's own CLI: `opencode session list --format json -n N`,
 * run with `cwd` set to the session's directory, lists sessions SCOPED TO
 * THAT DIRECTORY (verified live: the CLI derives its project from the
 * invoking process's cwd), newest-first. No native binding (better-sqlite3)
 * needed — a bounded, timeout-guarded subprocess call, mirroring the
 * `runVersion` probe in `harness/harness-verify.ts`.
 *
 * The detection heuristic: among sessions in the tab's cwd, filter to ones
 * created at/after the spawn time (minus clock-skew slack) and pick the
 * EARLIEST-created match — the session's own row, not a later sibling
 * created in the same directory while this tab was still running. A brand
 * new OpenCode TUI does not create a session row until the first message is
 * sent, so a resolve() before that returns null (uncached — retried later),
 * never throws.
 */

import { execFile } from 'node:child_process';

/** A resolved OpenCode session: the id OpenCode minted server-side. */
export interface OpenCodeSessionMatch {
  /** The `ses_<hex>` id OpenCode minted; feeds `opencode --session <id>`. */
  sessionId: string;
}

interface OpenCodeSessionListRow {
  id: string;
  created: number;
  directory: string;
}

interface ResolverDeps {
  /** The `opencode` binary; defaults to the bare name on PATH. */
  binary?: string;
  /**
   * Runs `opencode session list --format json -n <limit>` with the given cwd
   * and returns parsed rows, or null on any failure. Injectable for tests so
   * unit tests never spawn a real subprocess.
   */
  runList?: (cwd: string, limit: number) => Promise<OpenCodeSessionListRow[] | null>;
}

/** How many most-recent sessions to ask the CLI for per resolve — small and bounded (Rule 5). */
const LIST_LIMIT = 5;
/** Kill the probe if it hangs; the CLI call normally completes in well under 1s. */
const TIMEOUT_MS = 5_000;

async function defaultRunList(
  binary: string,
  cwd: string,
  limit: number
): Promise<OpenCodeSessionListRow[] | null> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['session', 'list', '--format', 'json', '-n', String(limit)],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? (parsed as OpenCodeSessionListRow[]) : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Resolves + caches OpenCode session ids for live PTY sessions. One instance
 * per app; `resolve()` is called with the session's cwd + spawn time and
 * returns the match once OpenCode's session row has appeared.
 *
 * Caching: a successful match is memoized by the caller-supplied `key` (the
 * PTY session id) so subsequent calls skip the subprocess. A negative result
 * is NOT cached — the row may not exist yet (OpenCode creates it on the first
 * message, a beat after spawn), so a later call retries.
 */
export class OpenCodeSessionResolver {
  private readonly binary: string;
  private readonly runList: (cwd: string, limit: number) => Promise<OpenCodeSessionListRow[] | null>;
  private readonly cache = new Map<string, OpenCodeSessionMatch>();
  private readonly claimedSessionIds = new Map<string, string>();

  constructor(deps: ResolverDeps = {}) {
    this.binary = deps.binary ?? 'opencode';
    this.runList = deps.runList ?? ((cwd, limit) => defaultRunList(this.binary, cwd, limit));
  }

  /** Drop a cached match (call on session close to free memory — Rule 5). */
  forget(key: string): void {
    const match = this.cache.get(key);
    if (match && this.claimedSessionIds.get(match.sessionId) === key) {
      this.claimedSessionIds.delete(match.sessionId);
    }
    this.cache.delete(key);
  }

  /** Number of cached matches (test/introspection helper). */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Resolve the OpenCode session for a live PTY identified by `key`, spawned
   * at `spawnedAtMs` with the given `cwd`. Returns the cached match if known,
   * else lists sessions in `cwd` and matches one created at/after the spawn
   * (minus a small clock-skew slack). Picks the EARLIEST-created match so a
   * later sibling session in the same cwd isn't mistaken for this one.
   * Returns null (uncached) until the row appears. Never throws.
   */
  async resolve(key: string, cwd: string, spawnedAtMs: number): Promise<OpenCodeSessionMatch | null> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const rows = await this.runList(cwd, LIST_LIMIT);
    if (!rows) return null;

    // Allow a small negative slack: the session row's created time can lag
    // the PTY spawn by a fraction of a second, and clocks aren't perfectly
    // aligned.
    const floor = spawnedAtMs - 5_000;
    let best: { match: OpenCodeSessionMatch; createdMs: number } | null = null;
    for (const row of rows) {
      if (row.directory !== cwd) continue;
      if (typeof row.created !== 'number' || row.created < floor) continue;
      if (!row.id) continue;
      const claimant = this.claimedSessionIds.get(row.id);
      if (claimant && claimant !== key) continue;
      if (!best || row.created < best.createdMs) {
        best = { match: { sessionId: row.id }, createdMs: row.created };
      }
    }

    if (best) {
      this.cache.set(key, best.match);
      this.claimedSessionIds.set(best.match.sessionId, key);
      return best.match;
    }
    return null;
  }
}
