import type { WorkspaceStatus, WorkspaceUntrackedScan } from '@zana-ai/zcc-domain';
import {
  DEFAULT_MAX_FILES,
  discoverWorkspace,
  notAGitRepoStatus,
  readWorkspaceStatusHead,
  runWorkspacePorcelainStatus,
  toWorkspaceFileStatuses,
  type PorcelainEntry,
  type PorcelainStatus
} from './git.js';

/**
 * Workspace status with the untracked-file walk taken off the request path.
 *
 * `git status -uall` walks every directory of the work tree. On very large
 * checkouts (millions of files, non-cone sparse checkout) that takes tens of
 * seconds, every poll timed out, and concurrent pollers each started their own
 * walk. This service:
 *
 * - coalesces concurrent `status(path)` calls into one computation;
 * - runs at most one untracked scan per path, and at most
 *   `maxConcurrentScans` across the host, at low CPU priority;
 * - waits up to `inlineScanMs` for the scan; beyond that it answers from a
 *   tracked-only `git status -uno` plus the last cached untracked result, and
 *   lets the scan finish in the background (bounded by `scanTimeoutMs`);
 * - marks checkouts whose scans exceed `inlineScanMs` as slow and refreshes
 *   their untracked files at most every `max(slowRefreshMs, duration × 10)`,
 *   keeping background scanning under ~10% of wall time.
 */
export interface WorkspaceStatusServiceOptions {
  inlineScanMs?: number;
  scanTimeoutMs?: number;
  slowRefreshMs?: number;
  maxConcurrentScans?: number;
  /** Untracked entries kept per path; bounds memory for huge untracked trees. */
  maxCachedEntries?: number;
  /** Cached paths kept (least recently used evicted). */
  maxCachedPaths?: number;
  now?: () => number;
  runStatus?: typeof runWorkspacePorcelainStatus;
  discover?: typeof discoverWorkspace;
  readHead?: typeof readWorkspaceStatusHead;
}

export const WORKSPACE_STATUS_DEFAULTS = {
  inlineScanMs: 2_000,
  scanTimeoutMs: 120_000,
  slowRefreshMs: 60_000,
  maxConcurrentScans: 2,
  maxCachedEntries: 1_000,
  maxCachedPaths: 64
} as const;

/** Background cadence multiplier: refresh no sooner than duration × this. */
const SLOW_REFRESH_DURATION_FACTOR = 10;

interface UntrackedResult {
  entries: PorcelainEntry[];
  truncated: boolean;
  scannedAt: number;
  durationMs: number;
}

interface ScanOutcome {
  /** Full scan output (tracked + untracked) — usable directly when fresh. */
  status: PorcelainStatus | null;
  error: unknown;
}

interface PathEntry {
  untracked: UntrackedResult | null;
  inflight: Promise<ScanOutcome> | null;
  lastDurationMs: number | null;
  lastFailedAt: number | null;
  slow: boolean;
  /** Set by `invalidate`: rescan on the next request even if not yet due. */
  forceScan: boolean;
}

export interface WorkspaceStatusService {
  status(cwd: string, maxFiles?: number): Promise<WorkspaceStatus>;
  /** Drop cached state for a path (e.g. after the checkout was removed). */
  forget(cwd: string): void;
  /** The work tree changed (commit, merge): rescan on the next request. */
  invalidate(cwd: string): void;
}

export function createWorkspaceStatusService(options: WorkspaceStatusServiceOptions = {}): WorkspaceStatusService {
  const inlineScanMs = options.inlineScanMs ?? WORKSPACE_STATUS_DEFAULTS.inlineScanMs;
  const scanTimeoutMs = options.scanTimeoutMs ?? WORKSPACE_STATUS_DEFAULTS.scanTimeoutMs;
  const slowRefreshMs = options.slowRefreshMs ?? WORKSPACE_STATUS_DEFAULTS.slowRefreshMs;
  const maxConcurrentScans = Math.max(1, options.maxConcurrentScans ?? WORKSPACE_STATUS_DEFAULTS.maxConcurrentScans);
  const maxCachedEntries = options.maxCachedEntries ?? WORKSPACE_STATUS_DEFAULTS.maxCachedEntries;
  const maxCachedPaths = Math.max(1, options.maxCachedPaths ?? WORKSPACE_STATUS_DEFAULTS.maxCachedPaths);
  const now = options.now ?? Date.now;
  const runStatus = options.runStatus ?? runWorkspacePorcelainStatus;
  const discover = options.discover ?? discoverWorkspace;
  const readHead = options.readHead ?? readWorkspaceStatusHead;

  const paths = new Map<string, PathEntry>();
  const inflightStatus = new Map<string, Promise<WorkspaceStatus>>();
  let activeScans = 0;
  const scanQueue: Array<() => void> = [];

  function entryFor(cwd: string): PathEntry {
    let entry = paths.get(cwd);
    if (entry) {
      // Refresh LRU position.
      paths.delete(cwd);
      paths.set(cwd, entry);
      return entry;
    }
    entry = { untracked: null, inflight: null, lastDurationMs: null, lastFailedAt: null, slow: false, forceScan: false };
    paths.set(cwd, entry);
    while (paths.size > maxCachedPaths) {
      const [oldestKey, oldest] = paths.entries().next().value as [string, PathEntry];
      // Never evict a path with a running scan; its result is still expected.
      if (oldest.inflight) break;
      paths.delete(oldestKey);
    }
    return entry;
  }

  async function withScanSlot<T>(run: () => Promise<T>): Promise<T> {
    if (activeScans >= maxConcurrentScans) {
      await new Promise<void>((resolve) => scanQueue.push(resolve));
    } else {
      activeScans += 1;
    }
    try {
      return await run();
    } finally {
      const next = scanQueue.shift();
      if (next) next();
      else activeScans -= 1;
    }
  }

  function scanDue(entry: PathEntry): boolean {
    if (entry.inflight) return false;
    if (entry.forceScan) return true;
    const last = entry.untracked?.scannedAt ?? entry.lastFailedAt;
    if (last === null || last === undefined) return true;
    if (!entry.slow) return true;
    const cadence = Math.max(slowRefreshMs, (entry.lastDurationMs ?? 0) * SLOW_REFRESH_DURATION_FACTOR);
    return now() - last >= cadence;
  }

  function startScan(cwd: string, entry: PathEntry): Promise<ScanOutcome> {
    entry.forceScan = false;
    const scan = withScanSlot(async (): Promise<ScanOutcome> => {
      const startedAt = now();
      try {
        const status = await runStatus(cwd, 'all', { timeoutMs: scanTimeoutMs, lowPriority: true });
        const finishedAt = now();
        const durationMs = Math.max(0, finishedAt - startedAt);
        const untracked = status.entries.filter((item) => item.code === '??');
        entry.untracked = {
          entries: untracked.slice(0, maxCachedEntries),
          truncated: status.truncated || untracked.length > maxCachedEntries,
          scannedAt: finishedAt,
          durationMs
        };
        entry.lastDurationMs = durationMs;
        entry.lastFailedAt = null;
        entry.slow = durationMs > inlineScanMs;
        return { status, error: null };
      } catch (error) {
        const finishedAt = now();
        entry.lastDurationMs = Math.max(0, finishedAt - startedAt);
        entry.lastFailedAt = finishedAt;
        // A scan that failed by running out of time is the slow case; a fast
        // failure (e.g. a transient git error) keeps the normal cadence.
        entry.slow = entry.slow || entry.lastDurationMs > inlineScanMs;
        return { status: null, error };
      }
    });
    entry.inflight = scan;
    void scan.finally(() => {
      if (entry.inflight === scan) entry.inflight = null;
    });
    return scan;
  }

  async function waitAtMost<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  function untrackedInfo(entry: PathEntry, state: WorkspaceUntrackedScan['state']): WorkspaceUntrackedScan {
    return {
      state,
      scannedAt: entry.untracked?.scannedAt ?? null,
      durationMs: entry.lastDurationMs,
      slow: entry.slow
    };
  }

  async function compute(cwd: string, maxFiles: number): Promise<WorkspaceStatus> {
    const discovered = await discover(cwd);
    if (!discovered.isGitRepo) {
      forget(cwd);
      return notAGitRepoStatus(cwd);
    }
    const entry = entryFor(cwd);
    const scan = scanDue(entry) ? startScan(cwd, entry) : entry.inflight;
    const headPromise = readHead(cwd, discovered);
    // Avoid an unhandled rejection if we bail out before awaiting the head.
    headPromise.catch(() => undefined);

    if (scan && !entry.slow) {
      const outcome = await waitAtMost(scan, inlineScanMs);
      if (outcome?.status) {
        return build(await headPromise, outcome.status, outcome.status.entries, outcome.status.truncated, maxFiles, untrackedInfo(entry, 'fresh'));
      }
      // Overran the inline budget: treat as slow now, so the next polls skip
      // the wait. The scan's own duration settles the flag when it finishes.
      if (!outcome && entry.inflight) entry.slow = true;
    }

    // Slow path: tracked changes now, untracked files from the last scan.
    const tracked = await runStatus(cwd, 'no');
    const cached = entry.untracked;
    const trackedPaths = new Set(tracked.entries.map((item) => item.path));
    const untracked = (cached?.entries ?? []).filter((item) => !trackedPaths.has(item.path));
    const state: WorkspaceUntrackedScan['state'] = cached
      ? 'stale'
      : entry.inflight ? 'pending' : entry.lastFailedAt !== null ? 'unavailable' : 'pending';
    return build(
      await headPromise,
      tracked,
      [...tracked.entries, ...untracked],
      tracked.truncated || Boolean(cached?.truncated),
      maxFiles,
      untrackedInfo(entry, state)
    );
  }

  function build(
    head: Awaited<ReturnType<typeof readWorkspaceStatusHead>>,
    branch: PorcelainStatus,
    entries: PorcelainEntry[],
    truncated: boolean,
    maxFiles: number,
    untracked: WorkspaceUntrackedScan
  ): WorkspaceStatus {
    return {
      ...head,
      ahead: branch.ahead,
      behind: branch.behind,
      dirty: entries.length > 0,
      files: toWorkspaceFileStatuses(entries, maxFiles),
      filesTruncated: entries.length > maxFiles || truncated,
      untracked
    };
  }

  function forget(cwd: string): void {
    const entry = paths.get(cwd);
    if (entry && !entry.inflight) paths.delete(cwd);
  }

  function invalidate(cwd: string): void {
    const entry = paths.get(cwd);
    if (entry) entry.forceScan = true;
  }

  return {
    status(cwd, maxFiles = DEFAULT_MAX_FILES) {
      const key = `${cwd}\0${maxFiles}`;
      const existing = inflightStatus.get(key);
      if (existing) return existing;
      const pending = compute(cwd, maxFiles).finally(() => {
        if (inflightStatus.get(key) === pending) inflightStatus.delete(key);
      });
      inflightStatus.set(key, pending);
      return pending;
    },
    forget,
    invalidate
  };
}
