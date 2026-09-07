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

export class ExecutionDeadlineWatchdog {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(private readonly deps: ExecutionDeadlineWatchdogDeps) {}

  schedule(record: ExecutionRecord): void {
    this.remove(record.id);
    if (this.disposed || TERMINAL_STATES.has(record.state)) return;
    const deadlineMs = record.request.policy?.deadlineMs;
    if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs) || deadlineMs <= 0) return;
    this.arm(record.id, record.createdAt + deadlineMs, 1);
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
