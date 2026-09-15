import { describe, expect, it } from 'vitest';
import { finalSessionStats } from '../session-stats-cache.js';

describe('finalSessionStats', () => {
  const cached = { tokens: { input: 8, output: 2, cacheRead: 0, cacheWrite: 0 }, files: [], queue: [] };

  it('falls back to last successful cached stats when forced exit read returns null', async () => {
    await expect(finalSessionStats(null, cached)).resolves.toBe(cached);
  });

  it('recovers an in-flight successful read when the forced exit read returns null', async () => {
    await expect(finalSessionStats(null, undefined, Promise.resolve(cached))).resolves.toBe(cached);
  });

  it('prefers fresh exit counters and preserves null when neither read succeeded', async () => {
    const fresh = { ...cached, tokens: { ...cached.tokens, input: 9 } };
    await expect(finalSessionStats(fresh, cached)).resolves.toBe(fresh);
    await expect(finalSessionStats(null, null, Promise.reject(new Error('read failed')))).resolves.toBeNull();
  });
});
