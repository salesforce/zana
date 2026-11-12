import { describe, expect, it } from 'vitest';
import { compareCheapestFit, evaluateSlotEligibility, LEVEL_UNMET_REASON, NOMINAL_CONTEXT_BYTES, slotRankingPriceUsd } from '../routing-policy.js';

const slot = {
  slotId: 'slot-1', personaId: 'reviewer', provider: 'claude', model: 'sonnet', level: 'medium' as const,
  capabilities: ['review'], modalities: ['text'], maxContextBytes: 10_000, health: 'available' as const,
  observedAt: 100, maxAgeMs: 1_000
};

describe('evaluateSlotEligibility', () => {
  const deliveryReviewer = { ...slot, personaId: 'builtin:squad-worker-high', label: 'Reviewer', level: 'high' as const };

  it('admits a required role matching the slot label', () => {
    expect(evaluateSlotEligibility({ version: 1, requiredRole: 'Reviewer' }, deliveryReviewer, 200))
      .toMatchObject({ status: 'PASS', reasons: [] });
  });

  it('preserves existing persona-id roles with or without a slot label', () => {
    for (const candidate of [deliveryReviewer, { ...deliveryReviewer, label: undefined }]) {
      expect(evaluateSlotEligibility({ version: 1, requiredRole: 'builtin:squad-worker-high' }, candidate, 200))
        .toMatchObject({ status: 'PASS', reasons: [] });
    }
  });

  it('rejects roles matching neither the exact persona id nor the exact label', () => {
    for (const requiredRole of ['builtin:reviewer', 'Writer', 'reviewer', ' Reviewer ']) {
      expect(evaluateSlotEligibility({ version: 1, requiredRole }, deliveryReviewer, 200))
        .toMatchObject({ status: 'FAIL', reasons: ['required role mismatch'] });
    }
    expect(evaluateSlotEligibility({ version: 1, requiredRole: 'Reviewer' }, { ...deliveryReviewer, label: undefined }, 200))
      .toMatchObject({ status: 'FAIL', reasons: ['required role mismatch'] });
  });

  it('does not let a matching label bypass other hard requirements', () => {
    expect(evaluateSlotEligibility({ version: 1, requiredRole: 'Reviewer', hardSlotId: 'other' }, deliveryReviewer, 200))
      .toMatchObject({ status: 'FAIL', reasons: ['hard slot mismatch'] });
    expect(evaluateSlotEligibility({ version: 1, requiredRole: 'Reviewer', minimumLevel: 'extra-high' }, deliveryReviewer, 200))
      .toMatchObject({ status: 'FAIL', reasons: [LEVEL_UNMET_REASON] });
  });

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
  });

  it('treats slot health as advisory — stale or unknown health never blocks dispatch', () => {
    // Stale (observedAt=100, maxAgeMs=1_000, now=2_000): out of window. Even a
    // stale 'unavailable' reading must not block — it is no longer evidence.
    expect(evaluateSlotEligibility({ version: 1 }, { ...slot, health: 'unavailable' }, 2_000))
      .toMatchObject({ status: 'PASS' });
    expect(evaluateSlotEligibility({ version: 1 }, { ...slot, health: 'available' }, 2_000))
      .toMatchObject({ status: 'PASS' });
    // Fresh but 'unknown' health: unresolved liveness, still advisory → PASS.
    expect(evaluateSlotEligibility({ version: 1 }, { ...slot, health: 'unknown' }, 200))
      .toMatchObject({ status: 'PASS' });
    // Only fresh, positive 'unavailable' fails closed.
    expect(evaluateSlotEligibility({ version: 1 }, { ...slot, health: 'unavailable' }, 200))
      .toMatchObject({ status: 'FAIL' });
  });

  it('does not reject role-owned model unknown without a hard model requirement', () => {
    expect(evaluateSlotEligibility({ version: 1, requiredRole: 'reviewer' }, {
      ...slot, model: undefined, level: undefined, roleOwnedModel: true
    }, 200)).toMatchObject({ status: 'PASS' });
  });
});

describe('slotRankingPriceUsd', () => {
  const priced = { provider: 'claude', model: 'claude-haiku-4' };
  it('uses the nominal size when no estimate is given, and an explicit size otherwise', () => {
    expect(slotRankingPriceUsd(priced)).toBe(slotRankingPriceUsd(priced, NOMINAL_CONTEXT_BYTES));
    expect(slotRankingPriceUsd(priced, NOMINAL_CONTEXT_BYTES * 4)!).toBeGreaterThan(slotRankingPriceUsd(priced)!);
    expect(slotRankingPriceUsd(priced, 0)).not.toBe(slotRankingPriceUsd(priced));
  });
  it('is undefined with missing provider/model or an uncatalogued model', () => {
    expect(slotRankingPriceUsd({})).toBeUndefined();
    expect(slotRankingPriceUsd({ provider: 'claude' })).toBeUndefined();
    expect(slotRankingPriceUsd({ model: 'claude-haiku-4' })).toBeUndefined();
    expect(slotRankingPriceUsd({ provider: 'nope', model: 'nope' })).toBeUndefined();
  });
});

describe('compareCheapestFit', () => {
  it('orders by price, unpriced last, equal prices tie', () => {
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 2 })).toBeLessThan(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 2 }, { slotId: 'b', priceUsd: 1 })).toBeGreaterThan(0);
    expect(compareCheapestFit({ slotId: 'a' }, { slotId: 'b', priceUsd: 9 })).toBe(1);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 9 }, { slotId: 'b' })).toBe(-1);
    expect(compareCheapestFit({ slotId: 'a' }, { slotId: 'b' })).toBe(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 1 })).toBe(0);
  });
  it('ranks live before deferred only at equal price', () => {
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 1, deferred: true })).toBeLessThan(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1, deferred: true }, { slotId: 'b', priceUsd: 1 })).toBeGreaterThan(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 2, deferred: false }, { slotId: 'b', priceUsd: 1, deferred: true })).toBeGreaterThan(0);
  });
  it('deprioritises the just-finished slot last, after price and live/deferred', () => {
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 1 }, 'a')).toBeGreaterThan(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 1 }, 'b')).toBeLessThan(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 2 }, 'a')).toBeLessThan(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1, deferred: true }, { slotId: 'b', priceUsd: 1 }, 'b')).toBeGreaterThan(0);
    expect(compareCheapestFit({ slotId: 'a', priceUsd: 1 }, { slotId: 'b', priceUsd: 1 }, 'c')).toBe(0);
  });
});

describe('LEVEL_UNMET_REASON', () => {
  it('is the exact reason evaluateSlotEligibility emits for a level shortfall', () => {
    expect(evaluateSlotEligibility({ version: 1, minimumLevel: 'high' }, slot, 200).reasons).toEqual([LEVEL_UNMET_REASON]);
  });
});
