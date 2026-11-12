import type { ExecutionRecord } from './store.js';

/**
 * Single source of truth for whether a timed-out run may be recovered. Used by
 * `recoverTimedOut` (authoritative) and the execution projection (advisory UI),
 * so renderer gating and backend rejection cannot diverge. Recovery is limited to
 * plans with no mutating work: mutating work needs durable provenance replay.
 * Runs with no work units are recoverable.
 */
export function timeoutRecoveryBlockReason(record: Pick<ExecutionRecord, 'workUnits'>): string | undefined {
  const units = record.workUnits ?? [];
  if (units.some((unit) => unit.state !== 'COMPLETED' && !unit.readOnly)) {
    return 'recovery requires durable provenance for unfinished mutating work';
  }
  if (units.some((unit) => unit.state === 'COMPLETED' && !unit.readOnly)) {
    return 'recovery requires durable provenance for completed mutating work';
  }
  return undefined;
}
