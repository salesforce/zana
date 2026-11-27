import { describe, expect, it, vi } from 'vitest';
import type { ProviderStatusResult } from '@zana-ai/zcc-contracts/host-rpc';
import { createProviderStatusCache, PROVIDER_STATUS_CACHE_TTL_MS } from './provider-status-cache.js';

const status = (tag: string): ProviderStatusResult => ({ providers: [], extraInstalledAgents: [{ providerId: tag, installed: true }] });
const key = (hostId = 'h1', connectionKey = 'c1', settingsKey = 's1') => ({ hostId, connectionKey, settingsKey });
const always = () => true;

describe('provider status cache', () => {
  it('serves repeated calls from one fetch and refetches after the TTL', async () => {
    let t = 0;
    const cache = createProviderStatusCache({ now: () => t });
    const fetch = vi.fn(async () => status('a'));
    for (let i = 0; i < 7; i++) await cache.get(key(), fetch, always);
    expect(fetch).toHaveBeenCalledTimes(1);
    t = PROVIDER_STATUS_CACHE_TTL_MS - 1;
    await cache.get(key(), fetch, always);
    expect(fetch).toHaveBeenCalledTimes(1);
    t = PROVIDER_STATUS_CACHE_TTL_MS;
    await cache.get(key(), fetch, always);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight promise between concurrent callers', async () => {
    const cache = createProviderStatusCache();
    let release!: (value: ProviderStatusResult) => void;
    const fetch = vi.fn(() => new Promise<ProviderStatusResult>(resolve => { release = resolve; }));
    const calls = [1, 2, 3].map(() => cache.get(key(), fetch, always));
    release(status('a'));
    const results = await Promise.all(calls);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[2]);
  });

  it('never keeps a failure', async () => {
    const cache = createProviderStatusCache();
    const fetch = vi.fn<() => Promise<ProviderStatusResult>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(status('a'));
    await expect(cache.get(key(), fetch, always)).rejects.toThrow('offline');
    await expect(cache.get(key(), fetch, always)).resolves.toEqual(status('a'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not keep a result that is not usable and refetches when a stored one stops being usable', async () => {
    const cache = createProviderStatusCache();
    const fetch = vi.fn(async () => status('a'));
    await cache.get(key(), fetch, () => false);
    await cache.get(key(), fetch, always);
    expect(fetch).toHaveBeenCalledTimes(2);
    await cache.get(key(), fetch, () => false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('never serves one host, connection or settings state to another', async () => {
    const cache = createProviderStatusCache();
    const fetch = vi.fn(async () => status('a'));
    await cache.get(key('h1'), fetch, always);
    await cache.get(key('h2'), fetch, always);
    await cache.get(key('h1', 'c2'), fetch, always);
    await cache.get(key('h1', 'c2', 's2'), fetch, always);
    expect(fetch).toHaveBeenCalledTimes(4);
    await cache.get(key('h2'), fetch, always);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not let a request from an old connection satisfy a new one', async () => {
    const cache = createProviderStatusCache();
    let release!: (value: ProviderStatusResult) => void;
    const slow = vi.fn(() => new Promise<ProviderStatusResult>(resolve => { release = resolve; }));
    const fast = vi.fn(async () => status('b'));
    const old = cache.get(key('h1', 'c1'), slow, always);
    await expect(cache.get(key('h1', 'c2'), fast, always)).resolves.toEqual(status('b'));
    release(status('a'));
    await old;
    expect(fast).toHaveBeenCalledTimes(1);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('invalidates one host or all hosts', async () => {
    const cache = createProviderStatusCache();
    const fetch = vi.fn(async () => status('a'));
    await cache.get(key('h1'), fetch, always);
    await cache.get(key('h2'), fetch, always);
    cache.invalidate('h1');
    await cache.get(key('h1'), fetch, always);
    await cache.get(key('h2'), fetch, always);
    expect(fetch).toHaveBeenCalledTimes(3);
    cache.invalidate();
    await cache.get(key('h2'), fetch, always);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
