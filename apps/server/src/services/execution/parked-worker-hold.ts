import { effectiveBlockedWaitMs, MAX_BLOCKED_WAIT_MS, openHumanBlockers } from './deadline-watchdog.js';
import { isTerminalExecutionState, type ExecutionRecord } from './store.js';

/** Hard ceiling on any hold: a hold can never outlive the blocked-wait ceiling (24 h). */
export const PARKED_HOLD_MAX_MS = MAX_BLOCKED_WAIT_MS;

/**
 * Longest a human blocker may keep its worker's session resident, measured from the oldest open
 * human blocker: the run's blocked-wait bound (`effectiveBlockedWaitMs`: policy `blockedWaitMs`,
 * default 4 h, 0 = 24 h ceiling). This is the same bound the deadline plan stops the run at, so a
 * hold never ends before the run does. A run with no idle timeout never stops on a blocker; its
 * hold still lapses at this bound and the worker is re-established when the answer arrives.
 */
export function parkedHoldWaitMs(record: ExecutionRecord): number {
  return effectiveBlockedWaitMs(record.request.policy?.blockedWaitMs);
}

/**
 * Slot -> epoch-ms the slot's session must stay resident until, for every slot with an open
 * human blocker (coordinator self-heal blockers never hold). All holds share the deadline's
 * anchor, the oldest open human blocker. Pure; a terminal record, or a bound already passed,
 * holds nothing.
 */
export function deriveParkedHolds(record: ExecutionRecord, nowMs: number): Map<string, number> {
  const holds = new Map<string, number>();
  if (isTerminalExecutionState(record.state)) return holds;
  const open = openHumanBlockers(record);
  if (open.length === 0) return holds;
  const until = Math.min(Math.min(...open.map((blocker) => blocker.createdAt)) + parkedHoldWaitMs(record), nowMs + PARKED_HOLD_MAX_MS);
  if (until <= nowMs) return holds;
  for (const blocker of open) holds.set(blocker.slotId, until);
  return holds;
}

export interface ParkedWorkerHoldDeps {
  now: () => number;
  load: (executionId: string) => Promise<ExecutionRecord | undefined | null>;
  /** `retainUntilMs` is an epoch-ms hold; `null` clears it. Rejections are logged and retried on the next sync. */
  retain: (record: ExecutionRecord, slotId: string, retainUntilMs: number | null) => Promise<void>;
  logError?: (message: string, error: unknown) => void;
}

/**
 * Keeps the host's idle-session sweep from releasing a worker that is parked on an open blocker.
 * Holds are self-expiring timestamps, so a lost clear can never pin a session past its bound.
 */
export class ParkedWorkerHolds {
  private readonly held = new Map<string, Set<string>>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly deps: ParkedWorkerHoldDeps) {}

  /** Re-derive holds for one execution from the stored record; serialized per execution. */
  sync(executionId: string, opts: { restore?: boolean } = {}): Promise<void> {
    const run = (this.queues.get(executionId) ?? Promise.resolve()).then(() => this.apply(executionId, opts));
    const tail = run.catch(() => undefined);
    this.queues.set(executionId, tail);
    void tail.then(() => { if (this.queues.get(executionId) === tail) this.queues.delete(executionId); });
    return run;
  }

  /** Records still holding a slot (diagnostics and tests). */
  heldSlots(executionId: string): string[] {
    return [...(this.held.get(executionId) ?? [])];
  }

  private async apply(executionId: string, opts: { restore?: boolean }): Promise<void> {
    const record = await this.deps.load(executionId);
    if (!record) { this.held.delete(executionId); return; }
    const desired = deriveParkedHolds(record, this.deps.now());
    const known = this.held.get(executionId) ?? new Set<string>();
    // After a restart nothing is tracked in memory: every slot the record ever blocked is a clear candidate.
    const stale = new Set(known);
    if (opts.restore || isTerminalExecutionState(record.state)) for (const blocker of record.blockers ?? []) stale.add(blocker.slotId);
    const next = new Set<string>();
    for (const [slotId, until] of desired) {
      next.add(slotId);
      try { await this.deps.retain(record, slotId, until); }
      catch (error) { this.deps.logError?.(`execution parked-worker hold failed for ${executionId}/${slotId}`, error); }
    }
    for (const slotId of stale) {
      if (desired.has(slotId)) continue;
      try { await this.deps.retain(record, slotId, null); }
      catch (error) {
        next.add(slotId); // keep tracking so the next sync retries the clear
        this.deps.logError?.(`execution parked-worker release failed for ${executionId}/${slotId}`, error);
      }
    }
    if (next.size) this.held.set(executionId, next); else this.held.delete(executionId);
  }
}
