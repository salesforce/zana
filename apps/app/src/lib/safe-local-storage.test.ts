import { afterEach, describe, expect, it } from 'vitest';
import {
  readLocalStorageItem,
  removeLocalStorageItem,
  safeLocalStorage,
  writeLocalStorageItem
} from './safe-local-storage.js';

function clearStub(): void {
  try {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: undefined
    });
  }
}

afterEach(() => {
  clearStub();
});

function installMemoryStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
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
  return store;
}

describe('safeLocalStorage', () => {
  it('returns null when the global is missing', () => {
    clearStub();
    expect(safeLocalStorage()).toBeNull();
    expect(readLocalStorageItem('zcc.favoritesDrawerOpen')).toBeNull();
  });

  it('returns null when localStorage exists but getItem is not a function', () => {
    (globalThis as { localStorage?: object }).localStorage = {};
    expect(safeLocalStorage()).toBeNull();
    expect(readLocalStorageItem('zcc.favoritesDrawerOpen')).toBeNull();
    expect(() => writeLocalStorageItem('zcc.favoritesDrawerOpen', '1')).not.toThrow();
    expect(() => removeLocalStorageItem('zcc.favoritesDrawerOpen')).not.toThrow();
  });

  it('returns null when accessing localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('experimental-webstorage');
      }
    });
    expect(safeLocalStorage()).toBeNull();
    expect(readLocalStorageItem('k')).toBeNull();
    expect(() => writeLocalStorageItem('k', '1')).not.toThrow();
  });

  it('reads, writes, and removes when Web Storage methods exist', () => {
    const store = installMemoryStorage({ 'zcc.favoritesDrawerOpen': '1' });
    expect(readLocalStorageItem('zcc.favoritesDrawerOpen')).toBe('1');
    writeLocalStorageItem('zcc.notificationsDrawerOpen', '1');
    expect(store.get('zcc.notificationsDrawerOpen')).toBe('1');
    removeLocalStorageItem('zcc.favoritesDrawerOpen');
    expect(store.has('zcc.favoritesDrawerOpen')).toBe(false);
  });

  it('swallows getItem/setItem throws after a successful feature detect', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('quota');
      },
      clear: () => {},
      key: () => null,
      length: 0
    } as Storage;
    expect(readLocalStorageItem('k')).toBeNull();
    expect(() => writeLocalStorageItem('k', '1')).not.toThrow();
    expect(() => removeLocalStorageItem('k')).not.toThrow();
  });
});
