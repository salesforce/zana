// Persistent usage stats for command-palette items, backing the recency boost.
// Stored under the established `cc.*` localStorage convention (cf.
// `zcc.collapsedSections`). Keyed by the palette item's stable `key`
// (`project:…`, `tab:…`, `action:…`, `ext:<id>:…`) so the namespace is implicit
// — one extension's stats never bleed into another's.
//
// The boost is intentionally GENTLE: it floats recently/frequently used items
// up in the EMPTY-query state and acts only as a final tiebreaker on typed
// queries. It is capped well below what a fuzzy label match scores, so it can
// never shadow a strong typed match (the classic frequency-ranking footgun).

const STORAGE_KEY = 'zcc.paletteRecents';

interface UsageEntry {
  count: number;
  /** epoch ms of last use. */
  lastUsedAt: number;
}

type UsageMap = Record<string, UsageEntry>;

/** Drop entries older than this so the store doesn't grow unbounded. */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
/** Half-life for the recency component of the boost. */
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
/** Hard cap on the total boost — must stay below a meaningful fuzzy score. */
const MAX_BOOST = 5;

function load(): UsageMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: UsageMap = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue;
      const e = val as Partial<UsageEntry>;
      if (typeof e.count !== 'number' || typeof e.lastUsedAt !== 'number') continue;
      out[key] = { count: e.count, lastUsedAt: e.lastUsedAt };
    }
    return out;
  } catch {
    return {}; // corrupt / unavailable → behave as if no history
  }
}

function save(map: UsageMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — recents are best-effort, never fatal */
  }
}

/** Record that the item with `key` was just run. Prunes entries older than
 *  MAX_AGE_MS (relative to `now`) on the way out so the store stays bounded. */
export function recordUse(key: string, now: number = Date.now()): void {
  const map = load();
  for (const [k, e] of Object.entries(map)) {
    if (now - e.lastUsedAt > MAX_AGE_MS) delete map[k];
  }
  const prev = map[key];
  map[key] = { count: (prev?.count ?? 0) + 1, lastUsedAt: now };
  save(map);
}

/** The raw usage map (for the empty-query ordering and tests). */
export function getRecents(): UsageMap {
  return load();
}

/**
 * Compute a bounded recency/frequency boost for `key`. Combines a log-scaled
 * frequency term with an exponential recency decay, then clamps to MAX_BOOST.
 * Returns 0 for an unseen key. Pure given (map, now) so it's unit-testable.
 */
export function recencyBoost(
  key: string,
  map: UsageMap = load(),
  now: number = Date.now()
): number {
  const e = map[key];
  if (!e) return 0;
  const freq = Math.log2(e.count + 1); // 1→1, 3→2, 7→3 …
  const age = Math.max(0, now - e.lastUsedAt);
  const recency = Math.pow(0.5, age / HALF_LIFE_MS); // 1 now → 0.5 at half-life
  return Math.min(MAX_BOOST, freq * recency);
}

// Test seam: clear persisted state.
export function __clearRecentsForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
