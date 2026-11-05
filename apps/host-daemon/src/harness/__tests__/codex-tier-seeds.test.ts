import { describe, expect, it } from 'vitest';
import { resolveTierFromRules } from '@zana-ai/zcc-domain/tier-rules';
import { CodexProvider } from '../codex/provider.js';

describe('Codex tier seed rules against the static catalog', () => {
  const descriptor = new CodexProvider().adapter.descriptor;
  const ids = (descriptor.targets?.models ?? []).map((m) => m.id);
  const seeds = descriptor.targets?.defaultModelTierRules ?? {};

  it('Low picks the cheap GPT model, not the o1 reasoning one', () => {
    expect(resolveTierFromRules(seeds.low, ids)).toBe('gpt-4o-mini');
  });

  it('Medium, High and Extra-high resolve offline instead of falling to the harness default', () => {
    expect(resolveTierFromRules(seeds.medium, ids)).toBe('gpt-4o');
    expect(resolveTierFromRules(seeds.high, ids)).toBe('gpt-5.6-sol');
    expect(resolveTierFromRules(seeds['extra-high'], ids)).toBe('gpt-5.6-sol');
  });
});
