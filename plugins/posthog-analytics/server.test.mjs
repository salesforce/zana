import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin from './server.mjs';

describe('retired PostHog server', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([false, true])('never starts analytics with saved enabled=%s and an old key', async enabled => {
    vi.stubEnv('ZCC_POSTHOG_API_KEY', 'phc_old_environment_key');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const define = vi.fn(() => ({ get: async () => ({ enabled, apiKey: 'phc_old_saved_key', trackUiClicks: true, trackPageViews: true }) }));
    const on = vi.fn();
    const method = vi.fn();
    const get = vi.fn();
    const set = vi.fn();
    await plugin({ settings: { define }, events: { on }, rpc: { method }, storage: { kv: { get, set } } });
    for (const operation of [fetch, define, on, method, get, set]) expect(operation).not.toHaveBeenCalled();
  });

  it('does not access the host API at all', () => {
    const host = new Proxy({}, { get() { throw new Error('retired plugin accessed host API'); } });
    expect(() => plugin(host)).not.toThrow();
  });
});
