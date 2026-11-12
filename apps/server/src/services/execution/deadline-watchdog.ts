import type { ExecutionRecord } from './store.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEADLINE_CLEANUP_RETRY_MS = 1_000;
const DEADLINE_CLEANUP_MAX_ATTEMPTS = 3;
const TERMINAL_STATES = new Set<ExecutionRecord['state']>(['COMPLETED', 'FAILED', 'STOPPED']);

export interface ExecutionDeadlineWatchdogDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (timer: NodeJS.Timeout) => void;
  onDeadline: (executionId: string) => void | Promise<void>;
}

/**
 * Idle-deadline anchor: the most recent GENUINE forward-progress timestamp for a
 * run, floored at its current attempt start. A run's execution deadline is measured from
 * THIS anchor, not from `createdAt` — so a healthy run that keeps making progress
 * (every worker heartbeat / real output advances a unit's `progressAt`) re-arms the
 * timer and is never guillotined mid-flight, while a run that makes no forward
 * progress for a full `deadlineMs` window still times out and self-heals. This is
 * the fix for a deep, slow, sequential plan being killed at a fixed 45-minute total
 * cap while a worker was actively progressing.
 *
 * `progressAt` deliberately EXCLUDES silent agent-state lease renewal (see the store's
 * `renewWorkerLease` with `advanceProgress: false`), so a silent-but-connected worker
 * does NOT keep a stuck run alive forever — that is the claim-stall backstop's job, and
 * here it correctly counts as "no progress". A run with no work units yet (freeform, or
 * pre-plan) falls back to `attemptStartedAt`. Retained resumes reset that durable
 * anchor before launch, so their new attempt gets a full deadline window.
 */
export function executionProgressAnchor(record: ExecutionRecord): number {
  let anchor = record.attemptStartedAt;
  for (const unit of record.workUnits ?? []) {
    if (typeof unit.progressAt === 'number' && unit.progressAt > anchor) anchor = unit.progressAt;
  }
  return anchor;
}

/** Default maximum wait for an open human blocker before the run is stopped (policy `blockedWaitMs` overrides; 0 = no cap). */
export const DEFAULT_BLOCKED_WAIT_MS = 4 * 60 * 60_000;
/** The user is warned this long (at most a quarter of the bound) before a blocked wait expires. */
export const BLOCKED_WAIT_WARN_LEAD_MS = 15 * 60_000;
/** Floor between a "continue" decision and the next arm, so a past target can never spin the timer at delay 0. */
export const DEADLINE_RECHECK_FLOOR_MS = 1_000;

export interface DeadlineTimings {
  deadlineMs: number;
  /** Maximum continuous wait on an open human blocker; 0 = no cap. */
  blockedWaitMs: number;
}

export interface DeadlinePlan {
  /** `idle` stops with reason idle; `blocked-warn` sends the pre-stop warning; `blocked-stop` stops with `unresolved-blocker`. */
  phase: 'idle' | 'blocked-warn' | 'blocked-stop';
  at: number;
}

/** Idle deadline plus blocked-wait bound for a record; undefined when the run has no idle deadline. */
export function deadlineTimings(record: ExecutionRecord): DeadlineTimings | undefined {
  const policy = record.request.policy;
  const deadlineMs = policy?.deadlineMs;
  if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs) || deadlineMs <= 0) return undefined;
  const blocked = policy?.blockedWaitMs;
  const blockedWaitMs = typeof blocked === 'number' && Number.isFinite(blocked) && blocked >= 0 ? blocked : DEFAULT_BLOCKED_WAIT_MS;
  return { deadlineMs, blockedWaitMs };
}

/** Unresolved blockers a person must answer; coordinator self-heal blockers do not pause the deadline. */
export function openHumanBlockers(record: ExecutionRecord): NonNullable<ExecutionRecord['blockers']> {
  return (record.blockers ?? []).filter((blocker) => !blocker.resolved && blocker.audience !== 'coordinator');
}

/**
 * The next deadline event for a live record, derived purely from the record so every
 * caller (watchdog arm, polling, the serialized store decision) agrees. With an open
 * human blocker the idle deadline is paused and a bounded blocked wait applies instead
 * (anchored at the oldest open blocker), with a single warning before it expires.
 * Undefined means nothing is due (blocked with no cap).
 */
export function planDeadline(record: ExecutionRecord, timings: DeadlineTimings, now: number): DeadlinePlan | undefined {
  const open = openHumanBlockers(record);
  if (open.length === 0) return { phase: 'idle', at: executionProgressAnchor(record) + timings.deadlineMs };
  if (timings.blockedWaitMs <= 0) return undefined;
  const stopAt = Math.min(...open.map((blocker) => blocker.createdAt)) + timings.blockedWaitMs;
  const warnAt = stopAt - Math.min(BLOCKED_WAIT_WARN_LEAD_MS, Math.floor(timings.blockedWaitMs / 4));
  if (record.blockedWarnedAt === undefined && now < stopAt && warnAt < stopAt) return { phase: 'blocked-warn', at: warnAt };
  return { phase: 'blocked-stop', at: stopAt };
}

/** When the next deadline event is due for a record, if any. */
export function nextDeadlineAt(record: ExecutionRecord, now: number): number | undefined {
  if (TERMINAL_STATES.has(record.state)) return undefined;
  const timings = deadlineTimings(record);
  return timings ? planDeadline(record, timings, now)?.at : undefined;
}

export class ExecutionDeadlineWatchdog {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(private readonly deps: ExecutionDeadlineWatchdogDeps) {}

  /** `notBefore` floors the arm target (used after a "continue" decision so a past target cannot re-arm at delay 0). */
  schedule(record: ExecutionRecord, notBefore?: number): void {
    this.remove(record.id);
    if (this.disposed || TERMINAL_STATES.has(record.state)) return;
    const at = nextDeadlineAt(record, this.deps.now());
    if (at === undefined) return;
    this.arm(record.id, notBefore === undefined ? at : Math.max(at, notBefore), 1);
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

  private arm(executionId: string, deadlineAt: number, cleanupAttempt: number): void {
    const remaining = deadlineAt - this.deps.now();
    const delay = remaining <= 0 ? 0 : Math.min(remaining, MAX_TIMER_DELAY_MS);
    const timer = this.deps.setTimer(() => {
      this.timers.delete(executionId);
      if (this.disposed) return;
      if (this.deps.now() < deadlineAt) {
        this.arm(executionId, deadlineAt, cleanupAttempt);
        return;
      }
      this.runDeadline(executionId, cleanupAttempt);
    }, delay);
    this.timers.set(executionId, timer);
  }

  private runDeadline(executionId: string, cleanupAttempt: number): void {
    void Promise.resolve(this.deps.onDeadline(executionId)).catch((error) => {
        if (this.disposed) return;
        if (cleanupAttempt < DEADLINE_CLEANUP_MAX_ATTEMPTS) {
          const retry = this.deps.setTimer(() => {
            this.timers.delete(executionId);
            if (!this.disposed) this.runDeadline(executionId, cleanupAttempt + 1);
          }, DEADLINE_CLEANUP_RETRY_MS);
          this.timers.set(executionId, retry);
          return;
        }
        console.error(`[execution-deadline] cleanup failed for ${executionId}`, error);
      });
  }
}
