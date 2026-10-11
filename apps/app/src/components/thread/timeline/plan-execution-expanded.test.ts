// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'zcc:plan-card-expanded:v1';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.resetModules(); });

describe('plan card expanded choices', () => {
  it('returns no choice until the reader toggles, then survives a reload', async () => {
    const mod = await import('./plan-execution-expanded.js');
    expect(mod.planCardExpanded('plan-a')).toBeUndefined();
    mod.setPlanCardExpanded('plan-a', false);
    mod.setPlanCardExpanded('plan-b', true);
    vi.resetModules();
    const reloaded = await import('./plan-execution-expanded.js');
    expect(reloaded.planCardExpanded('plan-a')).toBe(false);
    expect(reloaded.planCardExpanded('plan-b')).toBe(true);
    expect(reloaded.planCardExpanded('plan-c')).toBeUndefined();
  });

  it('notifies subscribers on every change and stops after unsubscribe', async () => {
    const mod = await import('./plan-execution-expanded.js');
    const listener = vi.fn();
    const unsubscribe = mod.subscribePlanCardExpanded(listener);
    mod.setPlanCardExpanded('plan-a', false);
    mod.setPlanCardExpanded('plan-a', true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    mod.setPlanCardExpanded('plan-a', false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps only the 100 most recent choices, refreshing a re-toggled key', async () => {
    const mod = await import('./plan-execution-expanded.js');
    for (let i = 0; i < 100; i++) mod.setPlanCardExpanded(`plan-${i}`, false);
    // Touching the oldest key makes it the newest, so plan-1 is evicted instead.
    mod.setPlanCardExpanded('plan-0', true);
    mod.setPlanCardExpanded('plan-100', false);
    expect(mod.planCardExpanded('plan-0')).toBe(true);
    expect(mod.planCardExpanded('plan-1')).toBeUndefined();
    expect(mod.planCardExpanded('plan-100')).toBe(false);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as unknown[];
    expect(stored).toHaveLength(100);
  });

  it('ignores malformed, oversized, and wrongly typed stored entries', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([['good', false], ['bad', 'no'], [1, true], 'junk']));
    const mod = await import('./plan-execution-expanded.js');
    expect(mod.planCardExpanded('good')).toBe(false);
    expect(mod.planCardExpanded('bad')).toBeUndefined();

    vi.resetModules();
    localStorage.setItem(STORAGE_KEY, '{not json');
    const corrupt = await import('./plan-execution-expanded.js');
    expect(corrupt.planCardExpanded('good')).toBeUndefined();

    vi.resetModules();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ good: false }));
    const notList = await import('./plan-execution-expanded.js');
    expect(notList.planCardExpanded('good')).toBeUndefined();

    vi.resetModules();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([['good', false], ['pad', 'x'.repeat(64_000)]]));
    const oversized = await import('./plan-execution-expanded.js');
    expect(oversized.planCardExpanded('good')).toBeUndefined();
  });

  it('falls back to memory when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const mod = await import('./plan-execution-expanded.js');
    const listener = vi.fn();
    mod.subscribePlanCardExpanded(listener);
    mod.setPlanCardExpanded('plan-a', false);
    expect(mod.planCardExpanded('plan-a')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
