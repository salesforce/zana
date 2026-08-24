import { describe, expect, it } from 'vitest';
import {
  HARNESS_MONITOR_FACTS_VERSION,
  MONITOR_FACT_TTL_MS,
  resolveMonitorFacts,
  validateMonitorFact,
  type HarnessMonitorFacts
} from '../harness-monitor-facts.js';

const now = 100_000;
const fact = (over: Partial<HarnessMonitorFacts> = {}): HarnessMonitorFacts => ({
  version: HARNESS_MONITOR_FACTS_VERSION,
  sessionId: 'session',
  profile: 'claude',
  source: 'test',
  observedAt: now,
  capability: 'supported',
  kind: 'visual',
  state: 'idle',
  ...over
});

describe('harness monitor facts', () => {
  it('uses deterministic precedence: exit, blocked, active, finished, visual', () => {
    expect(resolveMonitorFacts([fact(), fact({ kind: 'blocked' })], now)).toMatchObject({ state: 'blocked', reason: 'blocked' });
    expect(resolveMonitorFacts([fact(), fact({ kind: 'turn-active' })], now)).toMatchObject({ state: 'working', reason: 'active' });
    expect(resolveMonitorFacts([fact({ state: 'working' }), fact({ kind: 'turn-finished' })], now)).toMatchObject({ state: 'idle', reason: 'finished' });
    expect(resolveMonitorFacts([fact({ kind: 'blocked' }), fact({ kind: 'process-exited' })], now)).toMatchObject({ state: 'done', reason: 'process-exited' });
  });

  it('fails closed for conflicts, stale data, invalid versions, and unavailable capability', () => {
    expect(resolveMonitorFacts([fact({ state: 'idle' }), fact({ state: 'working' })], now)).toEqual({ state: 'unknown', reason: 'conflict' });
    expect(validateMonitorFact(fact({ observedAt: now - MONITOR_FACT_TTL_MS - 1 }), now)).toBe('stale');
    expect(validateMonitorFact(fact({ version: 2 }), now)).toBe('invalid-fact');
    expect(validateMonitorFact(fact({ capability: 'unsupported' }), now)).toBe('unsupported');
    expect(resolveMonitorFacts([fact(), fact({ sessionId: 'other' })], now)).toEqual({ state: 'unknown', reason: 'mis-correlated' });
  });
});
