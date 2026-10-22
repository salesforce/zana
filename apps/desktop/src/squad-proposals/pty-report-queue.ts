import type { AgentState } from '@zana-ai/zcc-domain/product';
import { SQUAD_PROPOSAL_LIMITS } from '@zana-ai/zcc-domain/squad-proposal';

export interface QueuedReport {
  text: string;
  /** Called once the report is typed or dropped for good (not when the session refused the text); never on dispose, so boot replay re-delivers it. */
  settle?: () => void;
  /**
   * Re-checked just before the text is typed (the item may have waited a long time): false drops
   * the item for good, settled. A check that throws does not block delivery.
   */
  stillWanted?: () => Promise<boolean>;
  /** When set, replaces `settle` if the session is gone or the queue overflows, so the item is not marked delivered. */
  onDrop?: () => void;
}

export interface PtyReportQueueDeps {
  reply(sessionId: string, text: string): boolean;
  ptyLive(id: string): boolean;
  ptyState(id: string): AgentState | undefined;
  /** Time of the user's last real keystroke (not mouse, focus or terminal replies). */
  lastInputAt(id: string): number | undefined;
  /** True while the user has typed something into the prompt that is not yet submitted; nothing is typed over it. */
  draftPending(id: string): boolean;
  /** True for harnesses whose status is not OSC-driven (Codex, Cursor, Pi, OpenCode), which sit in `waiting` at rest. */
  deliverableWhenWaiting(id: string): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** How often a busy session, or one holding an unsent draft, is looked at again when no status edge wakes the queue. */
const PTY_RECHECK_MS = 5_000;

/** A draft flag older than this since the last keystroke is treated as stale (the heuristic can stick) and no longer holds delivery. */
const DRAFT_STALE_MS = 10 * 60_000;

/**
 * Per-session queue of one-line reports for CLI Agent PTYs: one item is typed at a time, only
 * while the session is live, at rest, free of an unsent draft and quiet for `ptyQuietMs`, at most
 * `ptyQueueMax` waiting. A session that is not ready is re-checked on a single bounded timer.
 */
export function createPtyReportQueue(deps: PtyReportQueueDeps, log: (message: string, error?: unknown) => void) {
  const queues = new Map<string, QueuedReport[]>();
  const timers = new Map<string, unknown>();
  /** Sessions with an item awaiting its `stillWanted` check; nothing else is typed meanwhile. */
  const checking = new Set<string>();
  let disposed = false;

  function settle(item: QueuedReport): void {
    try { item.settle?.(); } catch (error) { log('squad proposal report settle failed', error); }
  }

  function drop(item: QueuedReport): void {
    if (!item.onDrop) { settle(item); return; }
    try { item.onDrop(); } catch (error) { log('squad proposal report drop failed', error); }
  }

  function clear(sessionId: string, settleDropped: boolean): void {
    const dropped = queues.get(sessionId) ?? [];
    queues.delete(sessionId);
    const handle = timers.get(sessionId);
    if (handle !== undefined) {
      timers.delete(sessionId);
      try { deps.clearTimer(handle); } catch (error) { log(`squad proposal timer clear failed for ${sessionId}`, error); }
    }
    if (settleDropped) for (const item of dropped) drop(item);
  }

  function atRest(sessionId: string, state: AgentState | undefined): boolean {
    return state === 'idle' || state === 'done' || (state === 'waiting' && deps.deliverableWhenWaiting(sessionId));
  }

  /** Milliseconds until the session has been quiet long enough, or 0 when it already has. */
  function quietWait(sessionId: string): number {
    const lastInput = deps.lastInputAt(sessionId);
    return lastInput === undefined ? 0 : Math.max(0, lastInput + SQUAD_PROPOSAL_LIMITS.ptyQuietMs - deps.now());
  }

  /** A pending draft holds delivery only while it is fresh; a stale flag is logged and ignored so polling ends. */
  function draftHolds(sessionId: string): boolean {
    if (!deps.draftPending(sessionId)) return false;
    if (deps.now() - (deps.lastInputAt(sessionId) ?? 0) < DRAFT_STALE_MS) return true;
    log(`squad proposal delivering over a stale draft flag for ${sessionId}`);
    return false;
  }

  /** At most one timer per session: an armed timer is kept, and re-evaluates everything when it fires. */
  function armTimer(sessionId: string, ms: number): void {
    if (timers.has(sessionId)) return;
    timers.set(sessionId, deps.setTimer(() => { timers.delete(sessionId); flush(sessionId); }, ms));
  }

  function type(sessionId: string, item: QueuedReport): void {
    const accepted = deps.reply(sessionId, item.text);
    if (!accepted) log(`squad proposal report not accepted by session ${sessionId}`);
    // A refused reply is not delivered: leave it unsettled so boot replay tries again.
    if (accepted) settle(item);
  }

  /** Type the item only if it is still wanted when its turn comes. */
  function recheck(sessionId: string, item: QueuedReport): void {
    checking.add(sessionId);
    void Promise.resolve()
      .then(() => item.stillWanted!())
      .catch((error: unknown) => { log(`squad proposal report recheck failed for ${sessionId}`, error); return true; })
      .then((wanted) => {
        checking.delete(sessionId);
        // Disposed mid-check: leave it unsettled, boot replay decides.
        if (disposed) return;
        try {
          if (!wanted) settle(item);
          else if (!deps.ptyLive(sessionId)) drop(item);
          else type(sessionId, item);
        } catch (error) { log(`squad proposal flush failed for ${sessionId}`, error); }
        flush(sessionId);
      });
  }

  /** Deliver at most one queued item when the session is live, at rest and quiet. */
  function flush(sessionId: string, stateHint?: AgentState): void {
    const queue = queues.get(sessionId);
    if (disposed || !queue?.length || checking.has(sessionId)) return;
    try {
      if (!deps.ptyLive(sessionId)) { clear(sessionId, true); return; }
      if (!atRest(sessionId, stateHint ?? deps.ptyState(sessionId)) || draftHolds(sessionId)) {
        armTimer(sessionId, PTY_RECHECK_MS);
        return;
      }
      const wait = quietWait(sessionId);
      if (wait > 0) { armTimer(sessionId, wait); return; }
      const item = queue.shift() as QueuedReport;
      if (!queue.length) clear(sessionId, false);
      if (item.stillWanted) { recheck(sessionId, item); return; }
      type(sessionId, item);
    } catch (error) {
      log(`squad proposal flush failed for ${sessionId}`, error);
    }
  }

  function enqueue(sessionId: string, item: QueuedReport): void {
    const queue = queues.get(sessionId) ?? [];
    queue.push(item);
    // Over the cap the oldest report is dropped; its result is already in the Inbox.
    while (queue.length > SQUAD_PROPOSAL_LIMITS.ptyQueueMax) drop(queue.shift() as QueuedReport);
    queues.set(sessionId, queue);
    flush(sessionId);
  }

  return {
    enqueue,
    flush,
    /** The session is gone: drop its reports for good. */
    forget(sessionId: string): void { clear(sessionId, true); },
    /** App shutdown: drop timers and queues without settling, so boot replay delivers them again. */
    dispose(): void {
      disposed = true;
      checking.clear();
      for (const sessionId of [...new Set([...queues.keys(), ...timers.keys()])]) clear(sessionId, false);
    }
  };
}
