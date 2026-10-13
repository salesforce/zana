import { describe, expect, it, vi } from 'vitest';
import { OpenCodeProvider } from '@zana-ai/zcc-host-daemon/harness/opencode/provider';
import { providerFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { liveScopedProviderFor } from './team-model-routing.js';

const config = {} as never;
const lowOf = (provider: OpenCodeProvider) => provider.adapter.descriptor.targets?.modelLevelMapping.low;

describe('liveScopedProviderFor', () => {
  it('resolves through a per-call live view and never mutates the shared provider', async () => {
    const shared = new OpenCodeProvider();
    const baseline = lowOf(shared);
    vi.spyOn(shared, 'discoverModelTargets').mockImplementation(async ({ cwd }) => (cwd === '/a' ? ['llmgw/gpt-7-luna'] : ['llmgw/gpt-8-luna']));
    const [a, b] = await Promise.all([
      liveScopedProviderFor(shared, { cwd: '/a', config }),
      liveScopedProviderFor(shared, { cwd: '/b', config })
    ]);
    expect(lowOf(a)).toBe('llmgw/gpt-7-luna');
    expect(lowOf(b)).toBe('llmgw/gpt-8-luna');
    expect(lowOf(shared)).toBe(baseline);
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
