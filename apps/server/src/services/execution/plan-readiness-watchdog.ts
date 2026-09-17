import { isDurableCoordination } from '@zana-ai/zcc-domain/product';
import type { ExecutionRecord } from './store.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RETRY_MS = 1_000;
const MAX_ATTEMPTS = 3;
const TERMINAL_STATES = new Set<ExecutionRecord['state']>(['COMPLETED', 'FAILED', 'STOPPED']);

export interface PlanReadinessWatchdogDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (timer: NodeJS.Timeout) => void;
  /** Grace window (ms) a durable execution may stay planless. `0` disables. */
  graceMs: () => number;
  /** Fired when the grace elapses; the callback re-checks and fails if still planless. */
  onGraceExpired: (executionId: string) => void | Promise<void>;
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
 */
export class PlanReadinessWatchdog {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(private readonly deps: PlanReadinessWatchdogDeps) {}

  schedule(record: ExecutionRecord): void {
    this.remove(record.id);
    if (this.disposed || TERMINAL_STATES.has(record.state)) return;
    if (!isDurableCoordination(record.coordinationMode)) return;
    if (record.workUnits && record.workUnits.length > 0) return;
    const grace = this.deps.graceMs();
    if (!Number.isFinite(grace) || grace <= 0) return;
    this.arm(record.id, record.createdAt + grace, 1);
  }

  restore(records: readonly ExecutionRecord[]): void {
    for (const record of records) this.schedule(record);
  }

  remove(executionId: string): void {
    const timer = this.timers.get(executionId);
    if (timer) this.deps.clearTimer(timer);
    this.timers.delete(executionId);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) this.deps.clearTimer(timer);
    this.timers.clear();
  }

  private arm(executionId: string, deadlineAt: number, attempt: number): void {
    const remaining = deadlineAt - this.deps.now();
    const delay = remaining <= 0 ? 0 : Math.min(remaining, MAX_TIMER_DELAY_MS);
    const timer = this.deps.setTimer(() => {
      this.timers.delete(executionId);
      if (this.disposed) return;
      if (this.deps.now() < deadlineAt) {
        this.arm(executionId, deadlineAt, attempt);
        return;
      }
      this.run(executionId, attempt);
    }, delay);
    this.timers.set(executionId, timer);
  }

  private run(executionId: string, attempt: number): void {
    void Promise.resolve(this.deps.onGraceExpired(executionId)).catch((error) => {
      if (this.disposed) return;
      if (attempt < MAX_ATTEMPTS) {
        const retry = this.deps.setTimer(() => {
          this.timers.delete(executionId);
          if (!this.disposed) this.run(executionId, attempt + 1);
        }, RETRY_MS);
        this.timers.set(executionId, retry);
        return;
      }
      console.error(`[plan-readiness] planless cleanup failed for ${executionId}`, error);
    });
  }
}
