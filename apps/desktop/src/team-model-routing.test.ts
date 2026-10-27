import { describe, expect, it, vi } from 'vitest';
import { OpenCodeProvider } from '@zana-ai/zcc-host-daemon/harness/opencode/provider';
import { providerFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { liveScopedProviderFor } from './team-model-routing.js';

const config = {} as never;
const modelsOf = (provider: OpenCodeProvider) => provider.adapter.descriptor.targets?.models.map(model => model.id);

describe('liveScopedProviderFor', () => {
  it('resolves through a per-call live view and never mutates the shared provider', async () => {
    const shared = new OpenCodeProvider();
    const baseline = shared.adapter;
    vi.spyOn(shared, 'discoverModelTargets').mockImplementation(async ({ cwd }) => (cwd === '/a' ? ['fixture-provider/gpt-7-luna'] : ['fixture-provider/gpt-8-luna']));
    const [a, b] = await Promise.all([
      liveScopedProviderFor(shared, { cwd: '/a', config }),
      liveScopedProviderFor(shared, { cwd: '/b', config })
    ]);
    expect(modelsOf(a)).toEqual(['fixture-provider/gpt-7-luna']);
    expect(modelsOf(b)).toEqual(['fixture-provider/gpt-8-luna']);
    expect(a.adapter.descriptor.targets?.modelLevelMapping.low).toBeUndefined();
    expect(b.adapter.descriptor.targets?.modelLevelMapping.low).toBeUndefined();
    expect(shared.adapter).toBe(baseline);
  });

  it('returns the shared provider when the probe is unavailable or empty', async () => {
    const shared = new OpenCodeProvider();
    const probe = vi.spyOn(shared, 'discoverModelTargets');
    probe.mockResolvedValueOnce(undefined);
    expect(await liveScopedProviderFor(shared, { cwd: '/a', config })).toBe(shared);
    probe.mockResolvedValueOnce([]);
    expect(await liveScopedProviderFor(shared, { cwd: '/a', config })).toBe(shared);
  });

  it('skips discovery for providers without a live probe', async () => {
    const plain = providerFor('claude');
    expect(plain.discoverModelTargets).toBeUndefined();
    expect(await liveScopedProviderFor(plain, { cwd: '/a', config })).toBe(plain);
  });

  it('propagates a probe failure to the caller', async () => {
    const shared = new OpenCodeProvider();
    vi.spyOn(shared, 'discoverModelTargets').mockRejectedValue(new Error('probe down'));
    await expect(liveScopedProviderFor(shared, { cwd: '/a', config })).rejects.toThrow('probe down');
  });
});
