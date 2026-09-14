import { safeLocalStorage } from './safe-local-storage.js';

const PREFS_EVENT = 'zcc-prefs';

export function readBooleanPreference(key: string, defaultValue: boolean): boolean {
  try {
    const raw = safeLocalStorage()?.getItem(key);
    if (raw === null || raw === undefined) return defaultValue;
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export function writeBooleanPreference(key: string, value: boolean): void {
  try {
    safeLocalStorage()?.setItem(key, value ? '1' : '0');
  } catch {
    /* quota / private mode */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREFS_EVENT));
  }
}

export function subscribeBooleanPreference(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => onChange();
  window.addEventListener(PREFS_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(PREFS_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
