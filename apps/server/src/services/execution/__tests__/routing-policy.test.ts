import { describe, expect, it } from 'vitest';
import { evaluateSlotEligibility } from '../routing-policy.js';

const slot = {
  slotId: 'slot-1', personaId: 'reviewer', provider: 'claude', model: 'sonnet', level: 'medium' as const,
  capabilities: ['review'], modalities: ['text'], maxContextBytes: 10_000, health: 'available' as const,
  observedAt: 100, maxAgeMs: 1_000
};

describe('evaluateSlotEligibility', () => {
  it('requires every hard candidate fact', () => {
    expect(evaluateSlotEligibility({
      version: 1, hardSlotId: 'slot-1', requiredRole: 'reviewer', requiredCapabilities: ['review'],
      requiredModalities: ['text'], minimumLevel: 'medium', estimatedContextBytes: 1_000
    }, slot, 200)).toMatchObject({ status: 'PASS', estimatedInputUsd: expect.any(Number) });
    expect(evaluateSlotEligibility({ version: 1, hardSlotId: 'other' }, slot, 200)).toMatchObject({ status: 'FAIL' });
    expect(evaluateSlotEligibility({ version: 1, requiredRole: 'writer' }, slot, 200)).toMatchObject({ status: 'FAIL' });
    expect(evaluateSlotEligibility({ version: 1, requiredCapabilities: ['write'] }, slot, 200)).toMatchObject({ status: 'FAIL' });
    expect(evaluateSlotEligibility({ version: 1, requiredModalities: ['image'] }, slot, 200)).toMatchObject({ status: 'FAIL' });
    expect(evaluateSlotEligibility({ version: 1, minimumLevel: 'high' }, slot, 200)).toMatchObject({ status: 'FAIL' });
    expect(evaluateSlotEligibility({ version: 1, estimatedContextBytes: 20_000 }, slot, 200)).toMatchObject({ status: 'FAIL' });
    expect(evaluateSlotEligibility({ version: 1 }, { ...slot, health: 'unavailable' }, 200)).toMatchObject({ status: 'FAIL' });
  });

  it('fails closed when a required fact is unknown and never treats missing price as free', () => {
    expect(evaluateSlotEligibility({ version: 1, requiredCapabilities: ['review'] }, { ...slot, capabilities: undefined }, 200))
      .toMatchObject({ status: 'UNKNOWN' });
    expect(evaluateSlotEligibility({ version: 1, estimatedContextBytes: 10 }, { ...slot, provider: 'unknown', model: 'unknown' }, 200))
      .toMatchObject({ status: 'PASS' });
    expect(evaluateSlotEligibility({ version: 1, estimatedContextBytes: 10 }, { ...slot, provider: 'unknown', model: 'unknown' }, 200))
      .not.toHaveProperty('estimatedInputUsd');
    expect(evaluateSlotEligibility({ version: 1 }, { ...slot, health: 'unavailable' }, 2_000))
      .toMatchObject({ status: 'UNKNOWN' });
  });

  it('does not reject role-owned model unknown without a hard model requirement', () => {
    expect(evaluateSlotEligibility({ version: 1, requiredRole: 'reviewer' }, {
      ...slot, model: undefined, level: undefined, roleOwnedModel: true
    }, 200)).toMatchObject({ status: 'PASS' });
  });
});
