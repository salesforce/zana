import type { AgentState } from '@zana-ai/zcc-domain/product';

/**
 * How long a delivered, confirmation-required coordinator wake may go without
 * consumption evidence (the coordinator leaving idle) before it is redelivered
 * once, and then — if still unconsumed — escalated.
 */
export const COORDINATOR_WAKE_CONFIRM_MS = 20_000;
/** Initial delivery plus at most one redelivery. Never a free-running retry loop. */
export const COORDINATOR_WAKE_MAX_DELIVERIES = 2;

/**
 * Caller-owned fence for a wake whose delivery must be confirmed. Writing text
 * into a CLI coordinator's TUI is not proof it was submitted (a startup overlay
 * can swallow it), so such a wake stays queued until the coordinator is seen to
 * leave idle.
 */
export interface CoordinatorWakeConfirmation {
  /** False once the wake is no longer wanted (cancelled, approved, superseded offer). */
  isCurrent(): Promise<boolean>;
  /** Called at most once, after the redelivery also went unconsumed. */
  onUnconsumed(): Promise<void> | void;
}

export interface PendingWakeConfirmation {
  readonly wakeId: string;
  readonly projectId: string;
  readonly executionId: string;
  readonly confirmation: CoordinatorWakeConfirmation;
  /** Deliveries started so far; `0` until the first idle-gated write. */
  deliveries: number;
  /** Coordinator session and execution attempt the last delivery was fenced to. */
  sessionId?: string;
  attempt?: number;
  timer?: NodeJS.Timeout;
}

/** A state that proves the coordinator left idle after the wake was written. */
export function isWakeConsumptionState(state: AgentState | undefined): boolean {
  return state === 'working' || state === 'blocked';
}

/**
 * In-memory ledger of confirmation-required coordinator wakes. The durable wake
 * stays in the execution store until consumption is observed, so a lost wake is
 * never acknowledged away; process restart degrades to the store's plain
 * at-least-once delivery. One one-shot timer per delivery bounds the window.
 */
export class CoordinatorWakeConfirmations {
  private readonly entries = new Map<string, PendingWakeConfirmation>();

  constructor(private readonly deps: {
    setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
    clearTimer: (timer: NodeJS.Timeout) => void;
    onExpire: (entry: PendingWakeConfirmation) => void;
    windowMs?: number;
  }) {}

  /** Track a freshly queued wake. A wake already tracked keeps its delivery count. */
  register(wakeId: string, projectId: string, executionId: string, confirmation: CoordinatorWakeConfirmation): void {
    if (this.entries.has(wakeId)) return;
    this.entries.set(wakeId, { wakeId, projectId, executionId, confirmation, deliveries: 0 });
  }

  get(wakeId: string): PendingWakeConfirmation | undefined {
    return this.entries.get(wakeId);
  }

  /**
   * Synchronously claim the next delivery for a wake. False when the budget is
   * spent, so concurrent drains (idle edge, reconcile tick, queue) never double-write.
   */
  beginDelivery(entry: PendingWakeConfirmation, sessionId: string, attempt: number): boolean {
    if (this.entries.get(entry.wakeId) !== entry || entry.deliveries >= COORDINATOR_WAKE_MAX_DELIVERIES) return false;
    entry.deliveries += 1;
    entry.sessionId = sessionId;
    entry.attempt = attempt;
    return true;
  }

  /** The write itself failed (session gone): give the delivery back. */
  abortDelivery(entry: PendingWakeConfirmation): void {
    entry.deliveries = Math.max(0, entry.deliveries - 1);
  }

  /** Start the bounded consumption window for the delivery just written. */
  arm(entry: PendingWakeConfirmation): void {
    if (this.entries.get(entry.wakeId) !== entry) return;
    if (entry.timer) this.deps.clearTimer(entry.timer);
    const timer = this.deps.setTimer(() => {
      if (entry.timer !== timer) return;
      entry.timer = undefined;
      if (this.entries.get(entry.wakeId) === entry) this.deps.onExpire(entry);
    }, this.deps.windowMs ?? COORDINATOR_WAKE_CONFIRM_MS);
    timer.unref?.();
    entry.timer = timer;
  }

  /** Delivered wakes for this session that the given state proves consumed. */
  consumedBy(sessionId: string, state: AgentState | undefined): PendingWakeConfirmation[] {
    if (!isWakeConsumptionState(state)) return [];
    return [...this.entries.values()].filter((entry) => entry.deliveries > 0 && entry.sessionId === sessionId);
  }

  forget(entry: PendingWakeConfirmation): void {
    if (this.entries.get(entry.wakeId) !== entry) return;
    if (entry.timer) this.deps.clearTimer(entry.timer);
    entry.timer = undefined;
    this.entries.delete(entry.wakeId);
  }

  dispose(): void {
    for (const entry of this.entries.values()) if (entry.timer) this.deps.clearTimer(entry.timer);
    this.entries.clear();
  }
}
