/**
 * Versioned routing estimate catalogue. These estimates rank existing slots only;
 * they never participate in launch target resolution or usage attribution.
 */
export const MODEL_PRICING_CATALOG_VERSION = 1;
export const MODEL_PRICING_CATALOG_ID = 'routing-pricing-2026-09-15';
export const MODEL_PRICING_CATALOG_EFFECTIVE_AT = '2026-09-15T00:00:00.000Z';
export const MODEL_PRICING_CATALOG_CURRENCY = 'USD' as const;

export interface ModelPricingRateV1 {
  provider: string;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const RATES: readonly ModelPricingRateV1[] = [
  { provider: 'claude', model: 'haiku', inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
  { provider: 'claude', model: 'sonnet', inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  { provider: 'claude', model: 'opus', inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  { provider: 'codex', model: 'gpt-5', inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
  { provider: 'codex', model: 'codex', inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
  { provider: 'codex', model: 'o3', inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
  { provider: 'codex', model: 'gpt-4', inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 }
];

/** Missing price is intentionally undefined, never a free model. */
export function estimateModelInputUsd(provider: string, model: string, inputBytes: number): number | undefined {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = model.toLowerCase();
  const rate = RATES.filter((candidate) => candidate.provider === normalizedProvider && normalizedModel.includes(candidate.model))
    .sort((left, right) => right.model.length - left.model.length)[0];
  if (!rate || !Number.isFinite(inputBytes) || inputBytes < 0) return undefined;
  return (inputBytes / 4 / 1_000_000) * rate.inputPerMillionUsd;
}
