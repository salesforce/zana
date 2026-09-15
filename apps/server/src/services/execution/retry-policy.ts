export const MAX_AUTO_RETRY_ATTEMPTS = 3;
export const MAX_RETRY_DELAY_MS = 30_000;

export type RetryFailureCode = 'TRANSIENT' | 'RESOURCE_EXHAUSTED' | 'UNKNOWN' | 'WORK_FAILED' | 'VALIDATION_FAILED' | 'PERMISSION_DENIED' | 'SEMANTIC_CONFLICT' | 'POLICY_ESCALATION' | 'NO_QUALIFIED_ROUTE' | 'ROUTE_FACTS_UNAVAILABLE';
export type RetryDecision = 'RETRY' | 'TERMINAL' | 'ESCALATE';
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface RetryPolicyInput {
  failureCode: RetryFailureCode;
  /** Completed automatic retries. Values outside [0, 3] fail closed. */
  autoAttempts: number;
  safeToRetry: boolean;
  fenced: boolean;
}

export interface RetryPolicyOutcome {
  decision: RetryDecision;
  reason: string;
  delayMs?: number;
}

export interface CircuitTransitionInput {
  state: CircuitState;
  now: number;
  openedAt?: number;
  resetAfterMs: number;
  probeSucceeded?: boolean;
}

export interface CircuitTransition {
  state: CircuitState;
  allowRequest: boolean;
  reason: string;
}

const RETRYABLE_FAILURES = new Set<RetryFailureCode>(['TRANSIENT', 'RESOURCE_EXHAUSTED']);

/** Deterministic exponential delay for retry attempt number 1 through 3. */
export function retryDelayMs(attempt: number): number | undefined {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_AUTO_RETRY_ATTEMPTS) return undefined;
  return Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

/** Pure retry admission. Unsafe or unfenced failures never retry automatically. */
export function evaluateRetryPolicy(input: RetryPolicyInput): RetryPolicyOutcome {
  if (!Number.isInteger(input.autoAttempts) || input.autoAttempts < 0 || input.autoAttempts > MAX_AUTO_RETRY_ATTEMPTS) {
    return { decision: 'ESCALATE', reason: 'invalid automatic retry attempt count' };
  }
  if (!RETRYABLE_FAILURES.has(input.failureCode)) return { decision: 'TERMINAL', reason: 'failure code is not retryable' };
  if (!input.safeToRetry) return { decision: 'ESCALATE', reason: 'retry is not safe' };
  if (!input.fenced) return { decision: 'ESCALATE', reason: 'retry requires an execution fence' };
  if (input.autoAttempts >= MAX_AUTO_RETRY_ATTEMPTS) return { decision: 'ESCALATE', reason: 'automatic retry limit reached' };
  const attempt = input.autoAttempts + 1;
  return { decision: 'RETRY', reason: 'retryable fenced failure', delayMs: retryDelayMs(attempt)! };
}

/**
 * Circuit request transition. OPEN rejects until reset window expires, then
 * admits one HALF_OPEN probe. HALF_OPEN closes only after an explicit success.
 */
export function transitionCircuit(input: CircuitTransitionInput): CircuitTransition {
  if (!Number.isFinite(input.now) || !Number.isFinite(input.resetAfterMs) || input.resetAfterMs < 0) {
    return { state: 'OPEN', allowRequest: false, reason: 'invalid circuit clock' };
  }
  if (input.state === 'CLOSED') return { state: 'CLOSED', allowRequest: true, reason: 'circuit closed' };
  if (input.state === 'HALF_OPEN') {
    if (input.probeSucceeded === true) return { state: 'CLOSED', allowRequest: true, reason: 'probe succeeded' };
    return { state: 'HALF_OPEN', allowRequest: false, reason: 'probe pending or failed' };
  }
  if (!Number.isFinite(input.openedAt)) return { state: 'OPEN', allowRequest: false, reason: 'circuit open time unavailable' };
  if (input.now - input.openedAt! < input.resetAfterMs) return { state: 'OPEN', allowRequest: false, reason: 'circuit cooling down' };
  return { state: 'HALF_OPEN', allowRequest: true, reason: 'probe allowed' };
}
