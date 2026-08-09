/**
 * TEMPORARY diagnostic instrumentation for the "app freezes when a launcher
 * modal opens" investigation. Remove once the ResizeObserver-coalescing fix is
 * confirmed in the running app.
 *
 * Enabled only when `localStorage.ccPerf === '1'` (set it in the devtools
 * console: `localStorage.ccPerf = '1'`, then reload). When on:
 *   - `perfCount(label)` tallies how many times a hot path ran in the current
 *     animation frame and logs the total once the frame settles — so you see
 *     "terminal-fit ×12 in one frame" instead of 12 separate lines.
 *   - `perfTime(label, fn)` wraps a synchronous call and warns if it blocked the
 *     thread for more than 4ms (roughly a quarter of a 60fps frame budget).
 *
 * Deliberately zero-cost when disabled (a single boolean check, no allocation).
 */
const ENABLED =
  typeof localStorage !== 'undefined' && localStorage.getItem('ccPerf') === '1';

const counts = new Map<string, number>();
let flushRaf = 0;

/** Count one occurrence of `label` this frame; log the per-frame total once. */
export function perfCount(label: string): void {
  if (!ENABLED) return;
  counts.set(label, (counts.get(label) ?? 0) + 1);
  if (flushRaf) return;
  flushRaf = requestAnimationFrame(() => {
    flushRaf = 0;
    for (const [k, n] of counts) {
      // eslint-disable-next-line no-console
      console.log(`[ccPerf] ${k} ×${n} in one frame`);
    }
    counts.clear();
  });
}

/** Run `fn`, warning if it synchronously blocked longer than `budgetMs`. */
export function perfTime<T>(label: string, fn: () => T, budgetMs = 4): T {
  if (!ENABLED) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const dt = performance.now() - t0;
    if (dt > budgetMs) {
      // eslint-disable-next-line no-console
      console.warn(`[ccPerf] ${label} blocked ${dt.toFixed(1)}ms`);
    }
  }
}
