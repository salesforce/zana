import { describe, expect, it, vi } from 'vitest';
import { OpenCodeProvider } from '@zana-ai/zcc-host-daemon/harness/opencode/provider';
import { providerFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { withLiveModelTargets } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { liveScopedProviderFor, memoizedLiveScopedProviderFor, resolveSlotModel } from './team-model-routing.js';

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

describe('memoizedLiveScopedProviderFor', () => {
  it('lists each harness once per cwd, and does not cache a failed listing', async () => {
    const shared = new OpenCodeProvider();
    const live = vi.fn(async <P,>(provider: P) => provider);
    const view = memoizedLiveScopedProviderFor(live as never);
    await Promise.all([view(shared, { cwd: '/a', config }), view(shared, { cwd: '/a', config }), view(shared, { cwd: '/b', config })]);
    expect(live).toHaveBeenCalledTimes(2);

    const flaky = vi.fn().mockRejectedValueOnce(new Error('listing failed')).mockResolvedValueOnce(shared);
    const retrying = memoizedLiveScopedProviderFor(flaky as never);
    await expect(retrying(shared, { cwd: '/a', config })).rejects.toThrow('listing failed');
    await expect(retrying(shared, { cwd: '/a', config })).resolves.toBe(shared);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('defaults to the unshared live view', async () => {
    const plain = providerFor('claude');
    expect(await memoizedLiveScopedProviderFor()(plain, { cwd: '/a', config })).toBe(plain);
  });
});

describe('resolveSlotModel', () => {
  const tierConfig = { harnessRouting: { schemaVersion: 1 as const, byAdapter: { opencode: { modelTierRules: { medium: ['terra'] } } } } } as never;
  const input = { config: tierConfig, profile: 'opencode' as const, extraArgs: [], scope: 'local' as const, persona: { id: 'p', name: 'P', modelLevel: 'medium' as const } };

  it('resolves on the given provider without a live listing when the tier maps there', async () => {
    const provider = withLiveModelTargets(providerFor('opencode'), ['gw/alpha-10-terra']);
    const live = vi.fn();
    const routed = await resolveSlotModel(provider, input, { cwd: '/a', config: tierConfig }, live as never);
    expect(routed.model.targetId).toBe('gw/alpha-10-terra');
    expect(routed.provider).toBe(provider);
    expect(live).not.toHaveBeenCalled();
  });

  it('retries an unmapped tier once on the live view', async () => {
    const shared = providerFor('opencode');
    const view = withLiveModelTargets(shared, ['gw/alpha-9-terra', 'gw/alpha-10-terra']);
    const live = vi.fn(async () => view);
    const routed = await resolveSlotModel(shared, input, { cwd: '/a', config: tierConfig }, live as never);
    expect(routed.model.targetId).toBe('gw/alpha-10-terra');
    expect(routed.provider).toBe(view);
    expect(live).toHaveBeenCalledTimes(1);
  });

  it('rethrows a resolution error that is not about an unmapped tier', async () => {
    const shared = providerFor('opencode');
    const live = vi.fn();
    const bad = { ...input, perTabRouting: { schemaVersion: 1 as const, byAdapter: { opencode: { modelTargetId: '-bad' } } } };
    await expect(resolveSlotModel(shared, bad as never, { cwd: '/a', config: tierConfig }, live as never)).rejects.toThrow();
    expect(live).not.toHaveBeenCalled();
  });
});
