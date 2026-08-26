import { describe, expect, it, afterEach } from 'vitest';
import { readBooleanPreference, writeBooleanPreference } from './boolean-preference.js';

const KEY = 'zcc.test.bool';

afterEach(() => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* node without localStorage */
  }
});

describe('boolean preference', () => {
  it('defaults when unset and round-trips true/false', () => {
    const store = new Map<string, string>();
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
    expect(readBooleanPreference(KEY, true)).toBe(true);
    writeBooleanPreference(KEY, false);
    expect(readBooleanPreference(KEY, true)).toBe(false);
    writeBooleanPreference(KEY, true);
    expect(readBooleanPreference(KEY, false)).toBe(true);
  });
});
