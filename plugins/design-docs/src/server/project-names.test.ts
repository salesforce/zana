import { describe, expect, it, vi } from 'vitest';
import { createProjectNames } from './project-names.js';

describe('createProjectNames', () => {
  it('fetches once per TTL and shares an in-flight fetch', async () => {
    let clock = 0;
    const list = vi.fn(async () => [
      { id: 'p1', name: 'App' },
      { id: 'p2', name: '' }
    ]);
    const names = createProjectNames(list, { ttlMs: 1_000, now: () => clock });
    expect(names.name('p1')).toBeNull();
    await Promise.all([names.refresh(), names.refresh()]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(names.name('p1')).toBe('App');
    expect(names.name('p2')).toBeNull();
    expect(names.name(null)).toBeNull();
    clock = 999;
    await names.refresh();
    expect(list).toHaveBeenCalledTimes(1);
    clock = 1_000;
    await names.refresh();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps the last names when a fetch fails, and waits a TTL to retry', async () => {
    let clock = 0;
    const list = vi.fn(async () => [{ id: 'p1', name: 'App' }]);
    const names = createProjectNames(list, { ttlMs: 10, now: () => clock });
    await names.refresh();
    list.mockRejectedValueOnce(new Error('host down'));
    clock = 20;
    await expect(names.refresh()).resolves.toBeUndefined();
    expect(names.name('p1')).toBe('App');
    await names.refresh();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
