/**
 * Shared interval parser used by both the main process scheduler and the
 * renderer's inline validation. Lives in `shared/` so the renderer can show
 * the same green "≈ every 1h 30m" preview the main process will accept.
 */

/** Hard floor: shorter intervals would pile up faster than terminals can boot. */
export const MIN_INTERVAL_MS = 60_000;

/** Hard cap: Node's setTimeout clamps delays > ~24.85d to 1ms. We cap below that. */
export const MAX_INTERVAL_MS = 24 * 86_400_000;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
};

function isDigit(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 48 && code <= 57;
}

/**
 * Parse a human interval ("5m", "1h30m", "300000ms") into milliseconds.
 * Returns null on garbage input. Coerces below the minimum (60s) up to the
 * minimum, and above the maximum (24d) down to the maximum.
 */
export function parseEvery(every: string): number | null {
  const trimmed = (every ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  // Single left-to-right pass: `<number><unit>` repeated, nothing in between.
  // A global regex here restarts from every digit of a long digit run, which
  // is quadratic on input such as "000...0".
  let total = 0;
  let i = 0;
  while (i < trimmed.length) {
    const numberStart = i;
    while (isDigit(trimmed, i)) i += 1;
    if (i === numberStart) return null;
    if (trimmed[i] === '.' && isDigit(trimmed, i + 1)) {
      i += 1;
      while (isDigit(trimmed, i)) i += 1;
    }
    const value = parseFloat(trimmed.slice(numberStart, i));
    const unit = trimmed.startsWith('ms', i) ? 'ms' : trimmed.charAt(i);
    const ms = UNIT_MS[unit];
    if (!ms) return null;
    total += value * ms;
    i += unit.length;
  }
  if (total <= 0) return null;
  const rounded = Math.round(total);
  if (rounded > MAX_INTERVAL_MS) return MAX_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, rounded);
}

/** Human-readable label for a parsed interval, e.g. "1h 30m". */
export function formatInterval(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const remM = totalMinutes % 60;
  if (hours < 24) return remM ? `${hours}h ${remM}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}
