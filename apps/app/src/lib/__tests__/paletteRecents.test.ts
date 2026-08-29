import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordUse, getRecents, recencyBoost, __clearRecentsForTest } from '../paletteRecents.js';

// Minimal in-memory localStorage stub (the test runs in node, no jsdom).
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  } as Storage;
}

describe('paletteRecents', () => {
  beforeEach(() => {
    installLocalStorage();
    __clearRecentsForTest();
  });

  it('round-trips a recorded use', () => {
    recordUse('action:settings', 1_000);
    const map = getRecents();
    expect(map['action:settings']).toEqual({ count: 1, lastUsedAt: 1_000 });
  });

  it('increments count and updates lastUsedAt on repeat use', () => {
    recordUse('action:settings', 1_000);
    recordUse('action:settings', 2_000);
    expect(getRecents()['action:settings']).toEqual({ count: 2, lastUsedAt: 2_000 });
  });

  it('returns 0 boost for an unseen key', () => {
    expect(recencyBoost('never-run', getRecents(), 5_000)).toBe(0);
  });

  it('gives a positive, bounded boost to a recent key', () => {
    recordUse('tab:abc', 10_000);
    const boost = recencyBoost('tab:abc', getRecents(), 10_000);
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(5); // MAX_BOOST cap
  });

  it('decays the boost as the entry ages', () => {
    recordUse('tab:abc', 0);
    const fresh = recencyBoost('tab:abc', getRecents(), 0);
    const aged = recencyBoost('tab:abc', getRecents(), 14 * 24 * 60 * 60 * 1000); // one half-life
    expect(aged).toBeLessThan(fresh);
    expect(aged).toBeCloseTo(fresh * 0.5, 5);
  });

  it('a more frequently used key boosts higher than a once-used one (same time)', () => {
    recordUse('a', 1_000);
    recordUse('b', 1_000);
    recordUse('b', 1_000);
    recordUse('b', 1_000);
    const map = getRecents();
    expect(recencyBoost('b', map, 1_000)).toBeGreaterThan(recencyBoost('a', map, 1_000));
  });

  it('fails soft to empty on corrupt storage', () => {
    localStorage.setItem('zcc.paletteRecents', '{not json');
    expect(getRecents()).toEqual({});
    // and a subsequent record still works (overwrites the garbage)
    recordUse('x', 1);
    expect(getRecents()['x']).toEqual({ count: 1, lastUsedAt: 1 });
  });

  it('fails soft when localStorage is entirely unavailable', () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(() => recordUse('x', 1)).not.toThrow();
    expect(getRecents()).toEqual({});
    expect(recencyBoost('x')).toBe(0);
  });
});
