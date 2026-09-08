/**
 * Idle-gated PTY injection for engine-cascade work assignments.
 *
 * The Job Team engine cascade dispatches a newly-ready work unit the instant a
 * worker COMPLETES its previous one (see `SquadExecutionService.completeWork` →
 * `cascadeDispatch`). At that instant the worker is still mid-turn — its
 * `execution.work.complete` MCP call hasn't returned — so a raw `reply()` would
 * inject the next unit's task into a busy Claude TUI, which buffers it as a
 * botched paste and wedges the agent ("working" forever, no progress). The
 * blocker-answer path already avoids this by having workers PULL when idle; the
 * assignment push had no such gate.
 *
 * This queues the text when the worker is busy and flushes it on the worker's
 * next transition INTO idle — honoring the "messages inject when idle" contract
 * the worker launch prompt promises. Delivery is immediate when the worker is
 * already idle (the kickoff dispatch to freshly-spawned, idle workers).
 *
 * Deliberately state-string typed (not the domain `AgentState`) so it stays a
 * dependency-light helper the Electron host can instantiate with
 * `agentStatus.get` / `ptys.reply` and a unit test can drive with plain stubs.
 */
export interface IdleGatedInjectorDeps {
  /** Current resolved agent state for a session (`'idle'`, `'working'`, …). */
  getState: (sessionId: string) => string;
  /** Write a line to the session's PTY as if typed. Returns false if gone. */
  reply: (sessionId: string, text: string) => boolean;
}

/** States in which a worker cannot safely receive an injected task. */
const BUSY_STATES = new Set(['working', 'blocked', 'waiting']);

export class IdleGatedInjector {
  private readonly pending = new Map<string, string[]>();

  constructor(private readonly deps: IdleGatedInjectorDeps) {}

  /**
   * Deliver `text` now if the worker is idle; otherwise queue it for the worker's
   * next idle edge. Always returns true (accepted) unless an immediate `reply`
   * reports the session is gone — matching the raw-reply contract callers expect.
   */
  deliver(sessionId: string, text: string): boolean {
    if (!BUSY_STATES.has(this.deps.getState(sessionId))) {
      return this.deps.reply(sessionId, text);
    }
    const queue = this.pending.get(sessionId) ?? [];
    queue.push(text);
    this.pending.set(sessionId, queue);
    return true;
  }

  /**
   * Feed a resolved-state transition (from the host's `agentStatus` 'status'
   * subscription). On entering idle it flushes ONE queued item; a pile-up
   * re-queues so the NEXT idle edge delivers the rest, because sending several
   * back-to-back would re-trigger the very TUI paste-buffering the deferred-CR
   * split in `reply()` exists to avoid. Cheap no-op for non-idle states or an
   * empty queue.
   */
  onState(sessionId: string, state: string): void {
    if (state !== 'idle') return;
    const queue = this.pending.get(sessionId);
    if (!queue?.length) return;
    this.pending.delete(sessionId);
    const [next, ...rest] = queue;
    this.deps.reply(sessionId, next);
    if (rest.length) this.pending.set(sessionId, rest);
  }

  /** Drop a session's queue (call on PTY exit — Rule 3 resource release). */
  forget(sessionId: string): void {
    this.pending.delete(sessionId);
  }

  /** Queued (undelivered) item count for a session. Introspection / tests. */
  pendingCount(sessionId: string): number {
    return this.pending.get(sessionId)?.length ?? 0;
  }
}
