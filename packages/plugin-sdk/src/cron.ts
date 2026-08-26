/**
 * Minimal 5-field cron matcher used by `zcc.background.schedule`.
 * Supports star, comma lists, and step tokens. Named schedules persist the last
 * fired minute so a 60s poll cannot double-fire.
 */
export function cronMatches(expr: string, date: Date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return true;
  const [minute, hour, day, month, weekday] = parts;
  return (
    fieldMatches(minute, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(day, date.getDate()) &&
    fieldMatches(month, date.getMonth() + 1) &&
    fieldMatches(weekday, date.getDay())
  );
}

function fieldMatches(field: string | undefined, value: number): boolean {
  if (!field || field === '*') return true;
  return field.split(',').some((token) => tokenMatches(token, value));
}

function tokenMatches(token: string, value: number): boolean {
  if (token === '*') return true;
  if (token.includes('/')) {
    const [range, stepRaw] = token.split('/');
    const step = Number(stepRaw);
    if (!Number.isFinite(step) || step <= 0) return false;
    const base = range === '*' || range === undefined ? 0 : Number(range);
    if (!Number.isFinite(base)) return false;
    return (value - base) % step === 0;
  }
  return Number(token) === value;
}

export function cronMinuteKey(date: Date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());
  const hour = String(date.getHours());
  const minute = String(date.getMinutes());
  return [year, month, day].join('-') + 'T' + hour + ':' + minute;
}
