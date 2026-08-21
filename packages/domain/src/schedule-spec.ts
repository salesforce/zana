/**
 * One place to interpret a schedule's cadence (`{ every }` vs `{ cron, tz }`),
 * shared by the main-process scheduler and every renderer display site so a
 * cron schedule never falls through a code path that assumed `every` is always
 * present. Pairs with {@link ./parse-every.ts} and {@link ./parse-cron.ts}.
 */
import { formatInterval, parseEvery } from './parse-every.js';
import { describeCron, isValidCron, nextCronRunAt } from './parse-cron.js';

/** The cadence half of a schedule (subset of `ScheduledTask.schedule`). */
export interface ScheduleCadence {
  every?: string;
  cron?: string;
  tz?: string;
}

/** True when the cadence is cron-based (as opposed to interval-based). */
export function isCronCadence(s: ScheduleCadence): boolean {
  return typeof s.cron === 'string' && s.cron.trim().length > 0;
}

/**
 * Validate that a cadence sets exactly one of `every` / `cron` AND that the
 * chosen one parses. Returns null on success or a human reason on failure —
 * the single gate used by store validation and the manager's create/update.
 */
export function validateCadence(s: ScheduleCadence): string | null {
  const hasEvery = typeof s.every === 'string' && s.every.trim().length > 0;
  const hasCron = typeof s.cron === 'string' && s.cron.trim().length > 0;
  if (hasEvery && hasCron) return 'set exactly one of every / cron, not both';
  if (!hasEvery && !hasCron) return 'missing schedule cadence (every or cron)';
  if (hasEvery && parseEvery(s.every!) === null) return `invalid interval: ${s.every}`;
  if (hasCron && !isValidCron(s.cron!, s.tz)) return `invalid cron: ${s.cron}`;
  return null;
}

/**
 * Short label for a cadence, used across the rail, palette, and agent board:
 *  - cron  → a friendly paraphrase ("weekdays at 09:00") or the raw expression.
 *  - every → "every 1h 30m" via the interval formatter.
 * Never throws; degrades to the raw string it was given.
 */
export function scheduleSummary(s: ScheduleCadence): string {
  if (isCronCadence(s)) {
    const label = describeCron(s.cron!);
    return s.tz ? `${label} (${s.tz})` : label;
  }
  if (s.every) {
    const ms = parseEvery(s.every);
    return ms !== null ? `every ${formatInterval(ms)}` : s.every;
  }
  return '—';
}

/**
 * Next fire time (epoch ms) for a cadence relative to `from`, or null if it
 * can't be computed. For `every` this is `from + interval` (the scheduler's
 * `arm` applies the smarter lastRun-relative math; this is the simple preview
 * form). For `cron` it's the true next wall-clock slot.
 */
export function nextRunMsFrom(s: ScheduleCadence, from: Date): number | null {
  if (isCronCadence(s)) {
    const next = nextCronRunAt(s.cron!, s.tz, from);
    return next ? next.getTime() : null;
  }
  if (s.every) {
    const ms = parseEvery(s.every);
    return ms !== null ? from.getTime() + ms : null;
  }
  return null;
}
