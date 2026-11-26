/**
 * 5-field cron matcher with the same semantics as the host's
 * `zcc.background.schedule` matcher (star, comma lists, `/` steps). Kept local
 * because path-installed plugins cannot import SDK runtime values; ranges are
 * already expanded by `normalizeCron` before routines are stored.
 */
export function cronMatches(expr: string, date: Date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string];
  return (
    fieldMatches(minute, date.getMinutes())
    && fieldMatches(hour, date.getHours())
    && fieldMatches(day, date.getDate())
    && fieldMatches(month, date.getMonth() + 1)
    && fieldMatches(weekday, date.getDay())
  );
}

function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((token) => tokenMatches(token, value));
}

function tokenMatches(token: string, value: number): boolean {
  if (token === '*') return true;
  const [base, stepRaw] = token.split('/');
  if (stepRaw === undefined) return Number(token) === value;
  const step = Number(stepRaw);
  if (!Number.isInteger(step) || step <= 0) return false;
  const start = base === '*' ? 0 : Number(base);
  if (!Number.isInteger(start)) return false;
  return value >= start && (value - start) % step === 0;
}

/** Forecast in the scheduler host's local time, including repeated DST minutes.
 * Skip nonmatching calendar days before walking the actual minutes of a matching day. */
export function nextRoutineRun(expr: string, after: number): number | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const values = (field: string, low: number, high: number) => new Set(
    Array.from({ length: high - low + 1 }, (_, index) => low + index).filter(value => fieldMatches(field, value))
  );
  const minutes = values(minute, 0, 59);
  const hours = values(hour, 0, 23);
  const months = values(month, 1, 12);
  const days = values(day, 1, 31);
  const weekdays = values(weekday, 0, 6);
  if (![minutes, hours, months, days, weekdays].every(set => set.size > 0)) return null;
  const cursor = new Date(Math.floor(after / 60_000) * 60_000 + 60_000);
  // A weekday-constrained leap day can take decades to recur.
  const endYear = cursor.getFullYear() + 40;
  while (cursor.getFullYear() < endYear) {
    if (months.has(cursor.getMonth() + 1) && days.has(cursor.getDate()) && weekdays.has(cursor.getDay())) {
      const today = cursor.getDate();
      do {
        if (hours.has(cursor.getHours()) && minutes.has(cursor.getMinutes())) return cursor.getTime();
        cursor.setTime(cursor.getTime() + 60_000);
      } while (cursor.getDate() === today);
    } else {
      cursor.setHours(24, 0, 0, 0);
    }
  }
  return null;
}
