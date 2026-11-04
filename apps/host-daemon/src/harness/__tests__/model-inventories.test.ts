import { describe, expect, it, vi } from 'vitest';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { OpenCodeProvider } from '../opencode/provider.js';
import { discoverHarnessModelInventories, harnessAdapterDescriptorsFromVerify, providerFor } from '../registry.js';

const context = { cwd: '/trusted/home', config: { version: 1 } as AppConfig };
const verified = [{ family: 'opencode', enabled: true, installed: true }] as HarnessVerifyResult[];

describe('host-owned model inventories', () => {
  it('uses the trusted context and exact installed IDs without mutating a shared provider', async () => {
    const provider = new OpenCodeProvider();
    const baseline = provider.adapter;
    const discover = vi.spyOn(provider, 'discoverModelTargets').mockResolvedValue(['one/model', 'two/model']);
    const inventories = await discoverHarnessModelInventories(verified, context, [provider]);
    expect(discover).toHaveBeenCalledWith(context);
    expect(inventories).toEqual([{ family: 'opencode', models: ['one/model', 'two/model'] }]);
    const descriptor = harnessAdapterDescriptorsFromVerify(verified, inventories).find(row => row.id === 'opencode')!;
    expect(descriptor.targets?.models.map(row => [row.id, row.provider, row.level])).toEqual([
      ['one/model', 'one', undefined], ['two/model', 'two', undefined]
    ]);
    expect(descriptor.targets?.modelLevelMapping).toEqual({});
    expect(provider.adapter).toBe(baseline);
    expect(providerFor('opencode').adapter.descriptor.targets?.models).toEqual([]);
  });

  it('only probes enabled installed providers that declare discovery', async () => {
    const provider = new OpenCodeProvider();
    const discover = vi.spyOn(provider, 'discoverModelTargets');
    for (const availability of [[], [{ ...verified[0], enabled: false }], [{ ...verified[0], installed: false }]]) {
      expect(await discoverHarnessModelInventories(availability, context, [provider])).toEqual([]);
    }
    expect(discover).not.toHaveBeenCalled();
    expect(await discoverHarnessModelInventories(verified, context, [providerFor('claude')])).toEqual([]);
  });

  it('isolates unavailable and failed probes; a successful empty catalog clears old choices', async () => {
    const provider = new OpenCodeProvider();
    const discover = vi.spyOn(provider, 'discoverModelTargets');
    discover.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([]);
    expect(await discoverHarnessModelInventories(verified, context, [provider])).toEqual([]);
    expect(await discoverHarnessModelInventories(verified, context, [provider])).toEqual([]);
    const empty = await discoverHarnessModelInventories(verified, context, [provider]);
    expect(empty).toEqual([{ family: 'opencode', models: [] }]);
    expect(harnessAdapterDescriptorsFromVerify(verified, empty).find(row => row.id === 'opencode')?.targets?.models).toEqual([]);
  });

  it('bounds, deduplicates and filters model IDs before crossing the host boundary', async () => {
    const provider = new OpenCodeProvider();
    vi.spyOn(provider, 'discoverModelTargets').mockResolvedValue([
      '', 'invalid', 'provider/not a model', 'x/' + 'a'.repeat(512), 'valid/model', 'valid/model',
      ...Array.from({ length: 10_001 }, (_, i) => `provider/model-${i}`)
    ]);
    const [inventory] = await discoverHarnessModelInventories(verified, context, [provider]);
    expect(inventory.models).toHaveLength(10_000);
    expect(inventory.models[0]).toBe('valid/model');
    expect(inventory.models).not.toContain('provider/not a model');
  });
});
