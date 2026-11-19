import { vi } from 'vitest';

/** In-memory localStorage so keyboard overrides can be written from node-environment tests. */
export function stubKeybindingStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  });
}
