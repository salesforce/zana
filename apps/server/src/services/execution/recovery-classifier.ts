export type RecoveryAction = 'NONE' | 'RETRY' | 'ESCALATE';

export interface RecoveryClassification {
  reason: 'NOT_STUCK' | 'STUCK_NO_STATE' | 'STUCK_NO_PROGRESS' | 'STUCK_NO_HEARTBEAT' | 'LOOP_REPEATED_SIGNATURE';
  evidence: readonly string[];
  action: RecoveryAction;
}

export interface StuckRecoveryInput {
  now: number;
  /** State must be known and current for execution to be considered healthy. */
  stateObservedAt?: number;
  progressObservedAt?: number;
  heartbeatObservedAt?: number;
  maxSilenceMs: number;
}

export interface LoopRecoveryInput {
  /** Most recent event signatures, bounded by caller to newest observations. */
  signatures: readonly string[];
  repeatThreshold: number;
  maxSignatures?: number;
}

const MAX_EVIDENCE = 3;
const DEFAULT_MAX_SIGNATURES = 32;

function invalidClock(now: number, maxSilenceMs: number): boolean {
  return !Number.isFinite(now) || !Number.isFinite(maxSilenceMs) || maxSilenceMs < 0;
}

function stale(now: number, observedAt: number | undefined, maxSilenceMs: number): boolean {
  return observedAt === undefined || !Number.isFinite(observedAt) || observedAt > now || now - observedAt > maxSilenceMs;
}

/** Classifies missing liveness signals without reading or mutating execution state. */
export function classifyStuckRecovery(input: StuckRecoveryInput): RecoveryClassification {
  if (invalidClock(input.now, input.maxSilenceMs)) {
    return { reason: 'STUCK_NO_STATE', evidence: ['invalid liveness clock'], action: 'ESCALATE' };
  }
  if (stale(input.now, input.stateObservedAt, input.maxSilenceMs)) {
    return { reason: 'STUCK_NO_STATE', evidence: ['state observation missing or stale'], action: 'ESCALATE' };
  }
  if (stale(input.now, input.progressObservedAt, input.maxSilenceMs)) {
    return { reason: 'STUCK_NO_PROGRESS', evidence: ['progress observation missing or stale'], action: 'RETRY' };
  }
  if (stale(input.now, input.heartbeatObservedAt, input.maxSilenceMs)) {
    return { reason: 'STUCK_NO_HEARTBEAT', evidence: ['heartbeat observation missing or stale'], action: 'RETRY' };
  }
  return { reason: 'NOT_STUCK', evidence: [], action: 'NONE' };
}

/** Detects repeated non-empty signatures from a bounded newest-first observation list. */
export function classifyLoopRecovery(input: LoopRecoveryInput): RecoveryClassification {
  const maxSignatures = input.maxSignatures ?? DEFAULT_MAX_SIGNATURES;
  if (!Number.isInteger(input.repeatThreshold) || input.repeatThreshold < 2 || !Number.isInteger(maxSignatures) || maxSignatures < 1) {
    return { reason: 'NOT_STUCK', evidence: ['invalid loop classifier bounds'], action: 'NONE' };
  }
  const counts = new Map<string, number>();
  for (const signature of input.signatures.slice(0, maxSignatures)) {
    if (typeof signature !== 'string' || signature.length === 0 || signature.length > 512) continue;
    const count = (counts.get(signature) ?? 0) + 1;
    counts.set(signature, count);
    if (count >= input.repeatThreshold) {
      return {
        reason: 'LOOP_REPEATED_SIGNATURE',
        evidence: [`signature repeated ${count} times`, `signature: ${signature.slice(0, 160)}`].slice(0, MAX_EVIDENCE),
        action: 'ESCALATE'
      };
    }
  }
  return { reason: 'NOT_STUCK', evidence: [], action: 'NONE' };
}
