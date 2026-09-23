import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../../durable-store.js';

/**
 * A remote agent process that a previous (or the current) run spawned over
 * `ssh -t`, recorded so main can actively reap it. Local teardown kills only the
 * local `ssh` proxy; a CLI that ignores the resulting SIGHUP (OpenCode) survives
 * on the remote box, orphaned and burning CPU. This ledger persists the minimal
 * recipe to SIGKILL that remote process — either gracefully on close, or at the
 * next boot for the quit/hard-crash case where the async graceful kill could not
 * complete before the app exited.
 */
export interface RemoteReapEntry {
  /** The zcc pty session id (also the boot-reap liveness key). */
  sessionId: string;
  /** `ssh` target — `user@host` or `host` (never a flag; validated at reap). */
  target: string;
  /** Keepalive / `-J jump` opts to reach the box on the reap ssh (no `-t`). */
  probeOpts: string[];
  /** Remote CLI PID, parsed from the spawn's boot sentinel (digits only). Present
   *  for a HEADLESS remote; ABSENT for a tmux-backed one (tmux swallows the boot
   *  sentinel, so the pid never streams — see {@link tmuxName}). */
  pid?: number;
  /** tmux session name (`cc-<id>`) for a TMUX-BACKED remote — the reap route when
   *  {@link pid} is absent: main resolves the live pane pid on the box and kills
   *  it, then drops the session. Absent for a headless remote. */
  tmuxName?: string;
  /** True when the remote session is tmux-backed (may re-attach on restore). */
  tmux: boolean;
  createdAt: number;
}

export interface RemoteReapLedger {
  /** Upsert an entry (replaces any prior entry for the same session id). */
  record(entry: RemoteReapEntry): Promise<void>;
  remove(sessionId: string): Promise<void>;
  removeMany(sessionIds: readonly string[]): Promise<void>;
  list(): Promise<RemoteReapEntry[]>;
}

/**
 * Bound the on-disk ledger (Rule 5). A live app never has this many concurrent
 * remote agents; the cap just stops a pathological accumulation of stale entries
 * (repeated hard-crashes before a boot-reap ever runs) from growing the file
 * without limit. Newest entries win.
 */
const MAX_ENTRIES = 256;

function isEntry(value: unknown): value is RemoteReapEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  // A reap recipe is actionable via EITHER a captured pid (headless) OR a tmux
  // session name (tmux-backed). Accept an entry that carries at least one; reject
  // one carrying neither (nothing to reap) or a malformed value for a present field.
  const hasPid = typeof e.pid === 'number' && Number.isInteger(e.pid);
  const hasTmuxName = typeof e.tmuxName === 'string';
  const pidOk = e.pid === undefined || hasPid;
  const tmuxNameOk = e.tmuxName === undefined || hasTmuxName;
  return (
    typeof e.sessionId === 'string' &&
    typeof e.target === 'string' &&
    Array.isArray(e.probeOpts) &&
    e.probeOpts.every((o) => typeof o === 'string') &&
    pidOk &&
    tmuxNameOk &&
    (hasPid || hasTmuxName) &&
    typeof e.tmux === 'boolean' &&
    typeof e.createdAt === 'number'
  );
}

function readEntries(filePath: string): { entries: RemoteReapEntry[]; hash: string | null } {
  const raw = readRawFile(filePath);
  if (!raw) return { entries: [], hash: null };
  const hash = hashBytes(raw);
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (Array.isArray(parsed)) return { entries: parsed.filter(isEntry), hash };
  } catch {
    /* corrupt file → treat as empty; the next write overwrites it cleanly */
  }
  return { entries: [], hash };
}

/**
 * Filter a ledger to the entries whose session is NOT currently live/recovered —
 * the boot-reap set. A non-tmux remote can never re-attach, so it is always an
 * orphan here; a tmux-backed remote that the renderer re-attached on restore is
 * in `recovered` and correctly spared. Pure so it is unit-testable without disk.
 */
export function remoteReapOrphans(
  entries: readonly RemoteReapEntry[],
  recovered: ReadonlySet<string>
): RemoteReapEntry[] {
  return entries.filter((entry) => !recovered.has(entry.sessionId));
}

export function createRemoteReapLedger(opts: { filePath: string }): RemoteReapLedger {
  const { filePath } = opts;
  const queue = createSerializedTransactionQueue();
  const mutate = (fn: (entries: RemoteReapEntry[]) => RemoteReapEntry[]): Promise<void> =>
    queue.run(async () => {
      const { entries, hash } = readEntries(filePath);
      const next = fn(entries).slice(-MAX_ENTRIES);
      atomicDurableWrite(filePath, Buffer.from(JSON.stringify(next), 'utf8'), { expectedHash: hash });
    });
  return {
    record: (entry) =>
      mutate((entries) => [...entries.filter((e) => e.sessionId !== entry.sessionId), entry]),
    remove: (sessionId) => mutate((entries) => entries.filter((e) => e.sessionId !== sessionId)),
    removeMany: (sessionIds) => {
      const drop = new Set(sessionIds);
      return mutate((entries) => entries.filter((e) => !drop.has(e.sessionId)));
    },
    list: () => queue.run(async () => readEntries(filePath).entries)
  };
}
