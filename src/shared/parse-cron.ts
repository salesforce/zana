/**
 * Shared cron helpers used by both the main-process scheduler and the renderer's
 * inline validation / "next runs" preview. Lives in `shared/` (twin of
 * {@link ./parse-every.ts}) so the renderer shows the same next-fire preview the
 * main process will actually schedule.
 *
 * Backed by `croner` — a zero-dependency, DST/timezone-aware cron engine. We use
 * it purely as a *pattern parser + next-run calculator* here; the actual firing
 * still runs through the scheduler's own `setTimeout` re-arm loop (so cron and
 * interval schedules share one code path in `SchedulerManager`).
 *
 * Expressions are standard 5-field cron (`min hour day-of-month month
 * day-of-week`). croner also accepts 6-field (with seconds) and named
 * shortcuts; we deliberately keep the UI/story on 5-field but don't reject the
 * richer forms croner understands.
 */
import { Cron } from 'croner';

/**
 * Validate a cron expression (optionally against a timezone). Returns true only
 * if croner can parse it AND compute a next run — a syntactically-parseable but
 * impossible pattern (e.g. `0 0 30 2 *`, Feb 30) yields no next run and is
 * treated as invalid so it never arms a dead timer.
 */
export function isValidCron(expr: string, tz?: string): boolean {
  const trimmed = (expr ?? '').trim();
  if (!trimmed) return false;
  try {
    const cron = new Cron(trimmed, tz ? { timezone: tz } : undefined);
    return cron.nextRun() !== null;
  } catch {
    return false;
  }
}

/**
 * Next fire time strictly after `from`, or null if the expression is invalid /
 * has no future run. `tz` is an IANA zone (e.g. `Europe/Paris`); omitted =
 * host local time.
 */
export function nextCronRunAt(expr: string, tz: string | undefined, from: Date): Date | null {
  const trimmed = (expr ?? '').trim();
  if (!trimmed) return null;
  try {
    const cron = new Cron(trimmed, tz ? { timezone: tz } : undefined);
    return cron.nextRun(from) ?? null;
  } catch {
    return null;
  }
}

/**
 * Enumerate the next `n` fire times after `from` (for the form's live preview).
 * Returns an empty array on an invalid expression.
 */
export function nextCronRuns(
  expr: string,
  tz: string | undefined,
  n: number,
  from: Date
): Date[] {
  const trimmed = (expr ?? '').trim();
  if (!trimmed || n <= 0) return [];
  try {
    const cron = new Cron(trimmed, tz ? { timezone: tz } : undefined);
    return cron.nextRuns(n, from) ?? [];
  } catch {
    return [];
  }
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Best-effort human label for common cron shapes (`0 9 * * 1-5` → "weekdays at
 * 09:00"). Falls back to the raw expression for anything exotic — the goal is a
 * friendly hint in the rail, not a full cron-to-English compiler.
 */
export function describeCron(expr: string): string {
  const trimmed = (expr ?? '').trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return trimmed;
  const [min, hour, dom, mon, dow] = parts;

  const timeLabel = (): string | null => {
    if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
    const h = Number(hour);
    const m = Number(min);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const time = timeLabel();
  // Only produce a friendly label when the minute+hour are concrete; otherwise
  // (e.g. "*/15 * * * *") the raw form is clearer than a lossy paraphrase.
  if (!time) return trimmed;

  const everyDay = dom === '*' && mon === '*' && dow === '*';
  if (everyDay) return `daily at ${time}`;

  if (dom === '*' && mon === '*') {
    if (dow === '1-5') return `weekdays at ${time}`;
    if (dow === '0,6' || dow === '6,0') return `weekends at ${time}`;
    if (/^\d$/.test(dow)) return `${DOW[Number(dow)] ?? dow} at ${time}`;
  }

  if (dow === '*' && mon === '*' && /^\d+$/.test(dom)) {
    return `day ${dom} at ${time}`;
  }

  return trimmed;
}
