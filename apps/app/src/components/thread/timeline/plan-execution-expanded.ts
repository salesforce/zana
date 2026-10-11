const STORAGE_KEY = 'zcc:plan-card-expanded:v1';
const MAX_ENTRIES = 100;
const MAX_BYTES = 64_000;
const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();
let hydrated = false;

function readStore(): Map<string, boolean> {
  if (hydrated) return memory;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length <= MAX_BYTES) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(-MAX_ENTRIES)) {
          if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'boolean') {
            memory.set(item[0], item[1]);
          }
        }
      }
    }
  } catch { /* the choice still holds for this session when storage is unavailable */ }
  return memory;
}

/** The reader's last open/closed choice for a plan card, if they made one. */
export function planCardExpanded(key: string): boolean | undefined {
  return readStore().get(key);
}

export function setPlanCardExpanded(key: string, expanded: boolean): void {
  const store = readStore();
  // Re-insert so the newest choice is the last one evicted.
  store.delete(key);
  store.set(key, expanded);
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...store]));
  } catch { /* best effort; memory is the fallback */ }
  for (const listener of listeners) listener();
}

export function subscribePlanCardExpanded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
