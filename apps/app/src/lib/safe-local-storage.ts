/**
 * Node 22+ can expose a global `localStorage` that is not a Web Storage
 * implementation unless `--localstorage-file` is set (`typeof` is `"object"`
 * but `getItem` is missing). Access can also throw (Safari private mode,
 * experimental Web Storage without a backing file). Feature-detect methods
 * and never throw.
 */
export function safeLocalStorage(): Storage | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function'
    ) {
      return storage;
    }
  } catch {
    /* experimental Web Storage / private mode */
  }
  return null;
}

export function readLocalStorageItem(key: string): string | null {
  try {
    return safeLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocalStorageItem(key: string, value: string): void {
  try {
    safeLocalStorage()?.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

export function removeLocalStorageItem(key: string): void {
  try {
    safeLocalStorage()?.removeItem(key);
  } catch {
    /* quota / private mode */
  }
}
