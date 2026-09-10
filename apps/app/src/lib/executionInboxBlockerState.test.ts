import { describe, expect, it } from 'vitest';
import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { executionInboxBlockerState } from './executionInboxBlockerState.js';

const entry = { blockerId: 'blocker-1' };
const execution = (resolved: boolean, deliveryState?: 'PENDING' | 'LEASED' | 'DELIVERED' | 'FAILED') => ({
  blockers: [{ id: 'blocker-1', resolved, ...(deliveryState ? { deliveryState } : {}) }]
}) as ExecutionBoardProjection;

describe('executionInboxBlockerState', () => {
  it.each(['PENDING', 'LEASED'] as const)('treats authoritative %s delivery as queued', (state) => {
    expect(executionInboxBlockerState(entry, execution(false, state), false)).toBe('queued');
  });

  it('treats unresolved delivery-free and failed blockers as actionable', () => {
    expect(executionInboxBlockerState(entry, execution(false), true)).toBe('actionable');
    expect(executionInboxBlockerState(entry, execution(false, 'FAILED'), true)).toBe('actionable');
  });

  it('treats authoritative resolution as resolved regardless of local state', () => {
    expect(executionInboxBlockerState(entry, execution(true, 'DELIVERED'), false)).toBe('resolved');
  });

  it('uses local answered state only before authoritative execution state arrives', () => {
    expect(executionInboxBlockerState(entry, undefined, true)).toBe('queued');
    expect(executionInboxBlockerState(entry, undefined, false)).toBe('unknown');
  });
});
