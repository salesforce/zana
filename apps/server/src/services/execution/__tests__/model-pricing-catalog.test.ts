import { describe, expect, it } from 'vitest';
import { estimateModelInputUsd, MODEL_PRICING_CATALOG_CURRENCY, MODEL_PRICING_CATALOG_EFFECTIVE_AT, MODEL_PRICING_CATALOG_ID, MODEL_PRICING_CATALOG_VERSION } from '../model-pricing-catalog.js';

describe('model routing pricing catalogue', () => {
  it('has stable provenance and returns unknown instead of a free estimate', () => {
    expect({ id: MODEL_PRICING_CATALOG_ID, version: MODEL_PRICING_CATALOG_VERSION, effectiveAt: MODEL_PRICING_CATALOG_EFFECTIVE_AT, currency: MODEL_PRICING_CATALOG_CURRENCY })
      .toEqual({ id: 'routing-pricing-2026-09-15', version: 1, effectiveAt: '2026-09-15T00:00:00.000Z', currency: 'USD' });
    expect(estimateModelInputUsd('claude', 'claude-sonnet', 4_000_000)).toBe(3);
    expect(estimateModelInputUsd('unknown', 'model', 4_000_000)).toBeUndefined();
  });
});
