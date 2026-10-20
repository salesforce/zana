import type { AgentState } from '@zana-ai/zcc-domain/product';
import { SQUAD_PROPOSAL_LIMITS } from '@zana-ai/zcc-domain/squad-proposal';

export interface QueuedReport {
  text: string;
  /** Called once the report is typed or dropped for good; never on dispose, so boot replay re-delivers it. */
  settle?: () => void;
}

export interface PtyReportQueueDeps {
  reply(sessionId: string, text: string): boolean;
  ptyLive(id: string): boolean;
  ptyState(id: string): AgentState | undefined;
  lastInputAt(id: string): number | undefined;
  /** True for non-OSC harnesses (Codex, Cursor, Pi, OpenCode), which sit in `waiting` at rest. */
  deliverableWhenWaiting(id: string): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * Per-session queue of one-line reports for CLI Agent PTYs: one item is typed at a time, only
 * while the session is live, at rest and quiet for `ptyQuietMs`, at most `ptyQueueMax` waiting.
 */
export function createPtyReportQueue(deps: PtyReportQueueDeps, log: (message: string, error?: unknown) => void) {
  const queues = new Map<string, QueuedReport[]>();
  const timers = new Map<string, unknown>();
  let disposed = false;

  function settle(item: QueuedReport): void {
    try { item.settle?.(); } catch (error) { log('squad proposal report settle failed', error); }
  }

  function clear(sessionId: string, settleDropped: boolean): void {
    const dropped = queues.get(sessionId) ?? [];
    queues.delete(sessionId);
    const handle = timers.get(sessionId);
    if (handle !== undefined) {
      timers.delete(sessionId);
      try { deps.clearTimer(handle); } catch (error) { log(`squad proposal timer clear failed for ${sessionId}`, error); }
    }
    if (settleDropped) for (const item of dropped) settle(item);
  }

  function atRest(sessionId: string, state: AgentState | undefined): boolean {
    return state === 'idle' || state === 'done' || (state === 'waiting' && deps.deliverableWhenWaiting(sessionId));
  }

  /** Milliseconds until the session has been quiet long enough, or 0 when it already has. */
  function quietWait(sessionId: string): number {
    const lastInput = deps.lastInputAt(sessionId);
    return lastInput === undefined ? 0 : Math.max(0, lastInput + SQUAD_PROPOSAL_LIMITS.ptyQuietMs - deps.now());
  }

  /** Deliver at most one queued item when the session is live, at rest and quiet. */
  function flush(sessionId: string, stateHint?: AgentState): void {
    const queue = queues.get(sessionId);
    if (disposed || !queue?.length) return;
    try {
      if (!deps.ptyLive(sessionId)) { clear(sessionId, true); return; }
      if (!atRest(sessionId, stateHint ?? deps.ptyState(sessionId))) return;
      const wait = quietWait(sessionId);
      if (wait > 0) {
        if (!timers.has(sessionId)) {
          timers.set(sessionId, deps.setTimer(() => { timers.delete(sessionId); flush(sessionId); }, wait));
        }
        return;
      }
      const item = queue.shift() as QueuedReport;
      if (!deps.reply(sessionId, item.text)) log(`squad proposal report not accepted by session ${sessionId}`);
      if (!queue.length) clear(sessionId, false);
      settle(item);
    } catch (error) {
      log(`squad proposal flush failed for ${sessionId}`, error);
    }
  }

  function enqueue(sessionId: string, item: QueuedReport): void {
    const queue = queues.get(sessionId) ?? [];
    queue.push(item);
    // Over the cap the oldest report is dropped; its result is already in the Inbox.
    while (queue.length > SQUAD_PROPOSAL_LIMITS.ptyQueueMax) settle(queue.shift() as QueuedReport);
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
      for (const sessionId of [...new Set([...queues.keys(), ...timers.keys()])]) clear(sessionId, false);
    }
  };
}
