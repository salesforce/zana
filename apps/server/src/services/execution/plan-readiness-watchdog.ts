import { isDurableCoordination } from '@zana-ai/zcc-domain/product';
import type { ExecutionRecord } from './store.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RETRY_MS = 1_000;
const MAX_ATTEMPTS = 3;
const TERMINAL_STATES = new Set<ExecutionRecord['state']>(['COMPLETED', 'FAILED', 'STOPPED']);
/** How often a suspended (decision-pending) execution re-checks its suspension. */
export const PLAN_READINESS_SUSPEND_POLL_MS = 30_000;
/** Absolute cap from attempt start after which a suspended execution still fails. */
export const PLAN_READINESS_SUSPENSION_CAP_MS = 24 * 60 * 60 * 1_000;

/** Why {@link PlanReadinessWatchdogDeps.onGraceExpired} fired; absent = ordinary grace expiry. */
export type PlanReadinessExpiryReason = 'suspension-cap';

export interface PlanReadinessWatchdogDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (timer: NodeJS.Timeout) => void;
  /** Grace window (ms) a durable execution may stay planless. `0` disables. */
  graceMs: () => number;
  /**
   * Fired when the grace elapses; the callback re-checks and fails if still planless.
   * `reason` is `'suspension-cap'` only when the absolute cap fired while suspended.
   */
  onGraceExpired: (executionId: string, reason?: PlanReadinessExpiryReason) => void | Promise<void>;
  /**
   * True while the grace check must be paused for this execution (a human
   * plan-correction decision is pending). Consulted only once the grace has
   * elapsed. A throw or rejection is treated as NOT suspended (fail safe: the
   * original deadline applies). Absent = never suspended (legacy behavior).
   */
  isSuspended?: (executionId: string) => boolean | Promise<boolean>;
  /** Overrides {@link PLAN_READINESS_SUSPEND_POLL_MS} (tests). */
  suspendPollMs?: number;
  /** Overrides {@link PLAN_READINESS_SUSPENSION_CAP_MS} (tests). */
  suspensionCapMs?: number;
}

/**
 * Bounds the "launched but never planned" stall: a durable Team execution that
 * reaches a live state with no registered work units relies on the coordinator
 * model to derive and register a plan at runtime. If that never happens (crash,
 * entitlement error, planless kickoff), the run otherwise looks healthy forever.
 * This watchdog arms only while a durable execution has NO work units; a
 * pre-seeded plan (the "Plan provided" fast path) or a coordinator that
 * registers in time removes the timer before it fires. Mirrors
 * {@link ExecutionDeadlineWatchdog}.
 *
 * Suspension: when the grace elapses while `isSuspended` reports an open
 * decision, the run is not failed; the watchdog polls instead. When the
 * decision resolves without a plan (and the run is still live), a FRESH full
 * grace starts from the moment resolution was observed — the human's wait is
 * never charged against the coordinator. While suspended, an absolute cap of
 * attemptStartedAt + suspensionCapMs still fails the run. Suspension state is
 * in-memory: after a restart `restore()` re-arms from the original deadline and
 * re-checks suspension when it fires.
 */
export class PlanReadinessWatchdog {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Per-id schedule token; an async suspension check whose token changed is stale. */
  private readonly tokens = new Map<string, number>();
  private generation = 0;
  private disposed = false;

  constructor(private readonly deps: PlanReadinessWatchdogDeps) {}

  schedule(record: ExecutionRecord): void {
    this.remove(record.id);
    if (this.disposed || TERMINAL_STATES.has(record.state)) return;
    if (!isDurableCoordination(record.coordinationMode)) return;
    if (record.workUnits && record.workUnits.length > 0) return;
    const grace = this.deps.graceMs();
    if (!Number.isFinite(grace) || grace <= 0) return;
    this.tokens.set(record.id, ++this.generation);
    this.arm(record.id, record.attemptStartedAt + grace, 1, record.attemptStartedAt);
  }

  restore(records: readonly ExecutionRecord[]): void {
    for (const record of records) this.schedule(record);
  }

  remove(executionId: string): void {
    const timer = this.timers.get(executionId);
    if (timer) this.deps.clearTimer(timer);
    this.timers.delete(executionId);
    this.tokens.delete(executionId);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) this.deps.clearTimer(timer);
    this.timers.clear();
    this.tokens.clear();
  }

  private arm(executionId: string, deadlineAt: number, attempt: number, launchAt: number): void {
    const remaining = deadlineAt - this.deps.now();
    const delay = remaining <= 0 ? 0 : Math.min(remaining, MAX_TIMER_DELAY_MS);
    const timer = this.deps.setTimer(() => {
      this.timers.delete(executionId);
      if (this.disposed) return;
      if (this.deps.now() < deadlineAt) {
        this.arm(executionId, deadlineAt, attempt, launchAt);
        return;
      }
      this.expire(executionId, attempt, launchAt);
    }, delay);
    this.timers.set(executionId, timer);
  }

  /** Grace elapsed: fail unless suspended, in which case poll until resolution or cap. */
  private expire(executionId: string, attempt: number, launchAt: number): void {
    if (!this.deps.isSuspended) {
      this.run(executionId, attempt);
      return;
    }
    this.whenChecked(executionId, (open) => {
      if (open) this.suspend(executionId, launchAt);
      else this.run(executionId, attempt);
    });
  }

  private suspend(executionId: string, launchAt: number): void {
    const capAt = launchAt + (this.deps.suspensionCapMs ?? PLAN_READINESS_SUSPENSION_CAP_MS);
    const remaining = capAt - this.deps.now();
    if (remaining <= 0) {
      this.run(executionId, 1, 'suspension-cap');
      return;
    }
    const pollMs = this.deps.suspendPollMs ?? PLAN_READINESS_SUSPEND_POLL_MS;
    const timer = this.deps.setTimer(() => {
      this.timers.delete(executionId);
      if (this.disposed) return;
      this.whenChecked(executionId, (open) => {
        if (open) {
          this.suspend(executionId, launchAt);
          return;
        }
        // Decision resolved without a plan: fresh full grace from now.
        const grace = this.deps.graceMs();
        if (!Number.isFinite(grace) || grace <= 0) return;
        this.arm(executionId, this.deps.now() + grace, 1, launchAt);
      });
    }, Math.min(pollMs, remaining, MAX_TIMER_DELAY_MS));
    this.timers.set(executionId, timer);
  }

  /** Runs `next` with the fail-safe suspension answer unless the schedule changed meanwhile. */
  private whenChecked(executionId: string, next: (open: boolean) => void): void {
    const token = this.tokens.get(executionId);
    const check = async (): Promise<boolean> => {
      try { return (await this.deps.isSuspended!(executionId)) === true; } catch { return false; }
    };
    void check().then((open) => {
      if (this.disposed || this.tokens.get(executionId) !== token || this.timers.has(executionId)) return;
      next(open);
    });
  }

  private run(executionId: string, attempt: number, reason?: PlanReadinessExpiryReason): void {
    const fired = reason ? this.deps.onGraceExpired(executionId, reason) : this.deps.onGraceExpired(executionId);
    void Promise.resolve(fired).catch((error) => {
      if (this.disposed) return;
      if (attempt < MAX_ATTEMPTS) {
        const retry = this.deps.setTimer(() => {
          this.timers.delete(executionId);
          if (!this.disposed) this.run(executionId, attempt + 1, reason);
        }, RETRY_MS);
        this.timers.set(executionId, retry);
        return;
      }
      console.error(`[plan-readiness] planless cleanup failed for ${executionId}`, error);
    });
  }
}
