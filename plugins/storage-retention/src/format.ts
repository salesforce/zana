import type { Policy } from "./state-types.js";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), UNITS.length - 1);
  return `${Number((value / 1024 ** index).toFixed(1))} ${UNITS[index]}`;
}

export function ago(timestamp: number, now = Date.now()): string {
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function duration(days: number): string {
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  if (days % 7 === 0 && days <= 28) return days === 7 ? "1 week" : `${days / 7} weeks`;
  return days === 1 ? "1 day" : `${days} days`;
}

export function plural(count: number, noun: string, nouns = `${noun}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : nouns}`;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * True when `next` can only keep more than `current` does: a policy turned off
 * or given a longer wait, nothing newly switched on. Those save without a
 * review; anything more aggressive is previewed and confirmed first.
 */
export function isRelaxation(current: Policy, next: Policy): boolean {
  const longer = (before: number | null, after: number | null) =>
    after === null || (before !== null && after >= before);
  return (
    longer(current.archiveAfterDays, next.archiveAfterDays) &&
    longer(current.clearAfterDays, next.clearAfterDays) &&
    (!next.clearStorageOnArchive || current.clearStorageOnArchive)
  );
}
