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
  /**
   * Wall clock for stale-queue detection; defaults to `Date.now`. A queued item
   * records its enqueue time so {@link IdleGatedInjector.flushStale} can force it
   * through when the worker's idle edge never arrives (see that method).
   */
  now?: () => number;
  /**
   * True when this session is a HEADLESS team worker with no interactive user —
   * the {@link suppressesInteractiveBlocked} cohort. For such a session, silence
   * means "resting in standby, ready for an assignment", NOT "busy" or "waiting
   * on a person": there is no interactive TUI to clobber and no human to wait on.
   * So `unknown` and `waiting` become DELIVERABLE for it (only active-output
   * `working` — and the never-reached `blocked` — still gate delivery), and an
   * engine-cascade assignment reaches it the instant it comes to rest instead of
   * stranding behind the {@link IdleGatedInjector.flushStale} bound.
   *
   * GATED ON BOOT: this narrowing applies only AFTER the worker has reached a
   * {@link REST_STATES rest state} once (the injector's `booted` latch). A
   * FRESHLY-SPAWNED worker also sits at `unknown`, but its opencode TUI is still
   * booting and NOT ready to accept a paste — injecting then loses the assignment
   * (live run 2cfc03e7). So before its first rest edge a headless worker keeps
   * the full {@link BUSY_STATES}: its `unknown` QUEUES and delivers on the first
   * idle/waiting edge (or the flushStale safety net). The "resting silent /
   * no-telemetry" case this flag targets is precisely a worker that HAS rested
   * before, so the latch leaves that fix intact.
   *
   * This is the delivery twin of {@link suppressesInteractiveBlocked}: the
   * output-activity heuristic (`output-activity.ts`) maps a silent standby worker
   * to `waiting` (onTurnStart fired but no output this turn) and a worker that
   * has never emitted a byte — e.g. a lifecycle-RECOVERED remote worker sitting
   * quiet — stays `unknown`. Both are busy under the interactive contract, so an
   * assignment to a no-telemetry remote worker used to strand until the 45 s
   * force-flush (live run f0f44413: verify-upstream CLAIMED, deliveries 0,
   * telemetry gap count 16). Wire this from the SAME headless-worker predicate.
   *
   * Defaults false / absent: the interactive contract holds — `unknown` is
   * transient startup (don't clobber a booting TUI) and `waiting` needs a person.
   */
  deliverableWhenSilent?: (sessionId: string) => boolean;
}

interface QueuedItem {
  text: string;
  /** When this item was queued (or last re-queued behind a delivered peer). */
  queuedAt: number;
}

/** States in which a worker cannot safely receive an injected task. */
const BUSY_STATES = new Set(['working', 'blocked', 'waiting', 'unknown']);

/**
 * At-rest states that PROVE a worker has booted: it completed (or is between)
 * turns, so its TUI is up and ready to accept an injected paste. Reaching any
 * of these — via {@link IdleGatedInjector.onState} OR as the live state seen by
 * {@link IdleGatedInjector.deliver} — latches `booted` for the session, which
 * is what promotes a HEADLESS worker's ambiguous `unknown`/`waiting` from "still
 * BOOTING, don't inject" to "at rest, deliverable". `working`/`blocked`/`unknown`
 * are deliberately EXCLUDED: none proves a completed turn (a freshly-spawned
 * worker sits at `unknown` while opencode is still booting, and injecting then
 * hits a not-yet-ready TUI — the paste is lost and the assignment strands until
 * lease expiry, live run 2cfc03e7: verify-upstream dispatched at spawn+2s, no
 * worker output for a full lease window, recovered only on the attempt-2
 * re-dispatch ~10 min later).
 *
 * NOTE the deliberate overlap with {@link BUSY_STATES}: `waiting` is a member of
 * BOTH sets. For an INTERACTIVE session it is simultaneously a rest-PROOF (it
 * proves the TUI booted, so it latches `booted`) AND a gating busy state (it
 * still means "waiting on a person", so `onState`/`deliver` will NOT flush into
 * it). Only a HEADLESS worker's narrowed {@link HEADLESS_BUSY_STATES} drops
 * `waiting` from the busy set and makes that rest edge deliverable. The two-role
 * split is the point: the latch is role-agnostic, the flush gate is not.
 */
const REST_STATES = new Set(['idle', 'waiting', 'done']);

/**
 * The narrowed busy set for a HEADLESS worker (see
 * {@link IdleGatedInjectorDeps.deliverableWhenSilent}). Only active-output
 * `working` (a mid-turn paste would wedge it) and the never-reached `blocked`
 * still gate delivery; `waiting`/`unknown` — a silent standby / no-telemetry
 * worker at rest — are deliverable, so the assignment lands the moment the
 * worker settles rather than stranding until the force-flush bound.
 */
const HEADLESS_BUSY_STATES = new Set(['working', 'blocked']);

/**
 * A headless team-worker session has NO interactive user: its human-input path
 * is `execution.work.block` (the coordinator blocker lane), not the TUI "needs
 * you" blocked overlay, and it is never nudged/triaged/promoted. The host
 * suppresses the end-of-turn Notification `blocked` overlay for such a session
 * so a standby worker rests deliverable (`idle`) instead of stranding an
 * engine-cascade assignment in {@link IdleGatedInjector} — the dispatch↔reclaim
 * lease-expiry churn a live Job Team run hit when its parked workers resolved
 * `blocked` and the queued assignment never flushed.
 */
export function suppressesInteractiveBlocked(
  session: { headless?: boolean; cohort?: { role?: string } } | null | undefined
): boolean {
  return session?.headless === true && session.cohort?.role === 'worker';
}

export class IdleGatedInjector {
  private readonly pending = new Map<string, QueuedItem[]>();
  /**
   * Sessions that have reached a {@link REST_STATES rest state} at least once —
   * proof the worker BOOTED and its TUI is ready for input. Only a `booted`
   * headless worker gets the narrowed {@link HEADLESS_BUSY_STATES} (silence =
   * deliverable); a never-yet-rested one keeps the full {@link BUSY_STATES} so
   * its `unknown` (still booting) QUEUES instead of injecting into a not-ready
   * TUI. Cleared on {@link forget} (Rule 3).
   */
  private readonly booted = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: IdleGatedInjectorDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * The busy set for a session: the narrowed {@link HEADLESS_BUSY_STATES} for a
   * headless worker that has already BOOTED (silence = deliverable), else the
   * full {@link BUSY_STATES}. The `booted` gate is the boot-race fix: before a
   * headless worker's first rest edge, its `unknown`/`waiting` is still-booting,
   * not resting, so it must NOT be injected into (see {@link REST_STATES} and
   * {@link IdleGatedInjectorDeps.deliverableWhenSilent}). Once it has rested once,
   * a later `unknown`/`waiting` is a genuine at-rest / no-telemetry gap and
   * delivers immediately (the f0f44413 strand fix stays intact).
   */
  private busyStates(sessionId: string): ReadonlySet<string> {
    return this.deps.deliverableWhenSilent?.(sessionId) && this.booted.has(sessionId)
      ? HEADLESS_BUSY_STATES
      : BUSY_STATES;
  }

  /**
   * Deliver `text` now if the worker is idle; otherwise queue it for the worker's
   * next idle edge. Always returns true (accepted) unless an immediate `reply`
   * reports the session is gone — matching the raw-reply contract callers expect.
   */
  deliver(sessionId: string, text: string): boolean {
    const state = this.deps.getState(sessionId);
    // A worker seen at rest is proven booted — latch it so a headless worker
    // resting at `waiting`/`idle` on the very first delivery (no prior onState
    // edge yet) is trusted immediately rather than queued.
    if (REST_STATES.has(state)) this.booted.add(sessionId);
    if (!this.busyStates(sessionId).has(state)) {
      return this.deps.reply(sessionId, text);
    }
    const queue = this.pending.get(sessionId) ?? [];
    queue.push({ text, queuedAt: this.now() });
    this.pending.set(sessionId, queue);
    return true;
  }

  /**
   * Feed a resolved-state transition (from the host's `agentStatus` 'status'
   * subscription). On entering ANY non-busy (deliverable) state it flushes ONE
   * queued item; a pile-up re-queues so the NEXT deliverable edge delivers the
   * rest, because sending several back-to-back would re-trigger the very TUI
   * paste-buffering the deferred-CR split in `reply()` exists to avoid. Cheap
   * no-op for busy states or an empty queue.
   *
   * The gate MIRRORS {@link deliver} (both consult {@link busyStates}), not a
   * bare `=== 'idle'`, on purpose: a worker that comes to rest in a non-busy,
   * non-idle state (e.g. `done`) would otherwise strand its queue
   * forever — the exact deadlock a standby team worker hit when its end-of-turn
   * yield resolved to something other than `idle` and no later `idle` edge ever
   * arrived. Flushing on any state `deliver()` would itself have injected into
   * keeps the two paths symmetric. For an INTERACTIVE session `unknown` is
   * deliberately busy: a freshly spawned worker reports unknown while its standby
   * prompt is still running, and injecting then can be accepted by the PTY
   * without becoming a new turn. For a HEADLESS worker
   * ({@link IdleGatedInjectorDeps.deliverableWhenSilent}) that reasoning inverts —
   * `unknown`/`waiting` mean "resting in standby, ready" — so its gate uses the
   * narrowed {@link HEADLESS_BUSY_STATES}.
   */
  onState(sessionId: string, state: string): void {
    // Latch `booted` BEFORE the busy check so the rest edge that proves boot
    // (a headless worker's first `waiting`/`idle`) also promotes it to the
    // narrowed busy set and flushes on this same edge.
    if (REST_STATES.has(state)) this.booted.add(sessionId);
    if (this.busyStates(sessionId).has(state)) return;
    const queue = this.pending.get(sessionId);
    if (!queue?.length) return;
    this.pending.delete(sessionId);
    const [next, ...rest] = queue;
    this.deps.reply(sessionId, next.text);
    // The remainder just got a delivery opportunity (one flushed); reset their
    // stale clock so flushStale waits a fresh window before force-injecting them.
    if (rest.length) this.pending.set(sessionId, this.restamp(rest));
  }

  /**
   * Force-deliver ONE queued item to each session whose OLDEST queued item has
   * waited `>= maxWaitMs` without a deliverable idle edge — the escape hatch for a
   * worker whose agent-state telemetry never resolves to idle (e.g. a REMOTE worker
   * with a telemetry gap that sits in `unknown` forever, so `onState` never fires a
   * non-busy edge and the assignment strands — live run c33a6715: board CLAIMED,
   * `deliveries: []`, worker idle in standby). The wait must be generous: a worker
   * that is genuinely working emits output → agent-state transitions → `onState`
   * flushes normally, so only a truly non-signalling worker reaches this bound.
   *
   * Injects at most one item per session per call (matching {@link onState}'s
   * one-at-a-time discipline to avoid re-triggering TUI paste-buffering) and
   * re-stamps the remainder so the NEXT sweep delivers the next after another full
   * wait. Returns the sessionIds force-flushed (for host logging).
   */
  flushStale(maxWaitMs: number): string[] {
    const now = this.now();
    const flushed: string[] = [];
    for (const [sessionId, queue] of [...this.pending]) {
      if (!queue.length) { this.pending.delete(sessionId); continue; }
      if (now - queue[0].queuedAt < maxWaitMs) continue;
      // NEVER force-inject into a worker that is ACTIVELY `working`. A long turn
      // emits no deliverable onState edge WHILE it runs, but it WILL resolve to a
      // rest state when the turn ends, and `onState` flushes the queue safely
      // then. Pasting mid-turn is the exact paste-during-work wedge this injector
      // exists to prevent — the 45s bound must not jump ahead of a genuine turn.
      // Skipping (not re-stamping) preserves `queuedAt`, so the moment the worker
      // leaves `working` the next sweep flushes immediately with no fresh wait.
      //
      // `working` is the ONLY skip state on purpose: it is the sole busy state
      // that both risks a mid-turn paste AND guarantees a future rest edge. The
      // other busy states (`unknown`/`waiting` — a silent, no-telemetry standby
      // worker that will NEVER emit an idle edge) are precisely the strand cases
      // this escape hatch exists for (live runs c33a6715 / f0f44413), so they
      // MUST still force-flush; gating on the full `busyStates()` set would
      // neuter flushStale entirely.
      if (this.deps.getState(sessionId) === 'working') continue;
      const [next, ...rest] = queue;
      this.deps.reply(sessionId, next.text);
      flushed.push(sessionId);
      if (rest.length) this.pending.set(sessionId, this.restamp(rest, now));
      else this.pending.delete(sessionId);
    }
    return flushed;
  }

  private restamp(items: QueuedItem[], at = this.now()): QueuedItem[] {
    return items.map((item) => ({ ...item, queuedAt: at }));
  }

  /** Drop a session's queue + boot latch (call on PTY exit — Rule 3 resource release). */
  forget(sessionId: string): void {
    this.pending.delete(sessionId);
    this.booted.delete(sessionId);
  }

  /** Queued (undelivered) item count for a session. Introspection / tests. */
  pendingCount(sessionId: string): number {
    return this.pending.get(sessionId)?.length ?? 0;
  }
}
