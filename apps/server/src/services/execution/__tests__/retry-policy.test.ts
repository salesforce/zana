import { describe, expect, it } from 'vitest';
import { evaluateRetryPolicy, retryDelayMs, transitionCircuit } from '../retry-policy.js';

describe('retry policy', () => {
  it('uses deterministic capped exponential delays', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([1_000, 2_000, 4_000]);
    expect(retryDelayMs(0)).toBeUndefined();
    expect(retryDelayMs(4)).toBeUndefined();
  });

  it('retries only safe fenced transient or resource failures up to three times', () => {
    expect(evaluateRetryPolicy({ failureCode: 'TRANSIENT', autoAttempts: 0, safeToRetry: true, fenced: true }))
      .toEqual({ decision: 'RETRY', reason: 'retryable fenced failure', delayMs: 1_000 });
    expect(evaluateRetryPolicy({ failureCode: 'RESOURCE_EXHAUSTED', autoAttempts: 2, safeToRetry: true, fenced: true }))
      .toMatchObject({ decision: 'RETRY', delayMs: 4_000 });
    expect(evaluateRetryPolicy({ failureCode: 'TRANSIENT', autoAttempts: 3, safeToRetry: true, fenced: true }))
      .toMatchObject({ decision: 'ESCALATE' });
    expect(evaluateRetryPolicy({ failureCode: 'TRANSIENT', autoAttempts: 0, safeToRetry: false, fenced: true }))
      .toMatchObject({ decision: 'ESCALATE' });
    expect(evaluateRetryPolicy({ failureCode: 'TRANSIENT', autoAttempts: 0, safeToRetry: true, fenced: false }))
      .toMatchObject({ decision: 'ESCALATE' });
    expect(evaluateRetryPolicy({ failureCode: 'PERMISSION_DENIED', autoAttempts: 0, safeToRetry: true, fenced: true }))
      .toMatchObject({ decision: 'TERMINAL' });
  });

  it('runs CLOSED OPEN HALF_OPEN circuit request transitions', () => {
    expect(transitionCircuit({ state: 'CLOSED', now: 10, resetAfterMs: 1_000 }))
      .toMatchObject({ state: 'CLOSED', allowRequest: true });
    expect(transitionCircuit({ state: 'OPEN', openedAt: 100, now: 1_099, resetAfterMs: 1_000 }))
      .toMatchObject({ state: 'OPEN', allowRequest: false });
    expect(transitionCircuit({ state: 'OPEN', openedAt: 100, now: 1_100, resetAfterMs: 1_000 }))
      .toMatchObject({ state: 'HALF_OPEN', allowRequest: true });
    expect(transitionCircuit({ state: 'HALF_OPEN', now: 1_100, resetAfterMs: 1_000, probeSucceeded: true }))
      .toMatchObject({ state: 'CLOSED', allowRequest: true });
    expect(transitionCircuit({ state: 'HALF_OPEN', now: 1_100, resetAfterMs: 1_000, probeSucceeded: false }))
      .toMatchObject({ state: 'HALF_OPEN', allowRequest: false });
  });
});
