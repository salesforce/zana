import { describe, expect, it } from 'vitest';
import { classifyLoopRecovery, classifyStuckRecovery } from '../recovery-classifier.js';

describe('recovery classifiers', () => {
  it('classifies no state, progress, or heartbeat in priority order', () => {
    expect(classifyStuckRecovery({ now: 10_000, maxSilenceMs: 1_000 }))
      .toMatchObject({ reason: 'STUCK_NO_STATE', action: 'ESCALATE' });
    expect(classifyStuckRecovery({ now: 10_000, maxSilenceMs: 1_000, stateObservedAt: 9_500 }))
      .toMatchObject({ reason: 'STUCK_NO_PROGRESS', action: 'RETRY' });
    expect(classifyStuckRecovery({ now: 10_000, maxSilenceMs: 1_000, stateObservedAt: 9_500, progressObservedAt: 9_500 }))
      .toMatchObject({ reason: 'STUCK_NO_HEARTBEAT', action: 'RETRY' });
    expect(classifyStuckRecovery({ now: 10_000, maxSilenceMs: 1_000, stateObservedAt: 9_500, progressObservedAt: 9_500, heartbeatObservedAt: 9_500 }))
      .toEqual({ reason: 'NOT_STUCK', evidence: [], action: 'NONE' });
  });

  it('detects bounded repeated signatures and leaves normal activity alone', () => {
    expect(classifyLoopRecovery({ signatures: ['a', 'b', 'a', 'a'], repeatThreshold: 3 }))
      .toMatchObject({ reason: 'LOOP_REPEATED_SIGNATURE', action: 'ESCALATE', evidence: ['signature repeated 3 times', 'signature: a'] });
    expect(classifyLoopRecovery({ signatures: ['a', 'a', 'a'], repeatThreshold: 3, maxSignatures: 2 }))
      .toEqual({ reason: 'NOT_STUCK', evidence: [], action: 'NONE' });
    expect(classifyLoopRecovery({ signatures: ['a', 'b'], repeatThreshold: 3 }))
      .toEqual({ reason: 'NOT_STUCK', evidence: [], action: 'NONE' });
  });
});
