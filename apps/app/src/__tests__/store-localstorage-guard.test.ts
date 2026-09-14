/**
 * Regression for https://github.com/salesforce/zana/issues/93 — Node 22+ can
 * expose a global `localStorage` object without Web Storage methods. Module-scope
 * zustand initializers in store.ts used to throw during collection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('store localStorage guard', () => {
  afterEach(() => {
    try {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } catch {
      /* ignore */
    }
    vi.resetModules();
  });

  it('loads when localStorage exists but getItem is not a function', async () => {
    vi.resetModules();
    (globalThis as { localStorage?: object }).localStorage = {};
    const { useUi } = await import('../store.js');
    expect(useUi.getState().favoritesDrawerOpen).toBe(false);
    expect(useUi.getState().notificationsDrawerOpen).toBe(false);
    expect(useUi.getState().sidebarCollapsed).toBe(false);
    expect(useUi.getState().hideIdleProjects).toBe(false);
    expect(useUi.getState().hideSchedulelessProjects).toBe(false);
  }, 20_000);

  it('hydrates drawer flags from a working localStorage', async () => {
    vi.resetModules();
    const store = new Map<string, string>([['zcc.favoritesDrawerOpen', '1']]);
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0
    } as Storage;
    const { useUi } = await import('../store.js');
    expect(useUi.getState().favoritesDrawerOpen).toBe(true);
    useUi.getState().setFavoritesDrawerOpen(false);
    expect(store.get('zcc.favoritesDrawerOpen')).toBe('0');
  }, 20_000);
});
