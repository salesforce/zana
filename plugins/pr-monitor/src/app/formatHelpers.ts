/**
 * Small presentational helpers shared by the panel components — pure functions
 * with no React/host dependencies so each component can import what it needs
 * without dragging the whole panel in.
 */

import type { CheckRun, PrRollupStatus } from '../../lib/types.js';

/** Friendly relative-time formatter — "2m ago", "3h ago", "yesterday". */
export function formatRelative(epochMs: number): string {
  const now = Date.now();
  const delta = Math.max(0, now - epochMs);
  const s = Math.floor(delta / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

const STATUS_LABELS: Record<PrRollupStatus, string> = {
  pending: 'Pending',
  failed: 'Failing',
  conflict: 'Merge conflict',
  yellow: 'Merge blocked',
  'review-required': 'Review required',
  integrating: 'Merging',
  green: 'All checks passing',
  'closed-merged': 'Merged',
  'closed-abandoned': 'Closed',
};

export function statusLabel(s: PrRollupStatus): string {
  return STATUS_LABELS[s];
}

/**
 * Short display host (AC-ORG-3.1 rule, mirrored here for the host filter):
 * strip a trailing `.salesforce.com` (`gitcore.soma.salesforce.com` →
 * `gitcore.soma`); every other host — including `github.com` — is shown as-is.
 * `src/main/pr-main.ts`'s `shortHost` is the canonical rule; this copy exists
 * because the host filter derives its hosts from `pr.url` client-side (no
 * `host.call` round trip), unlike the Organizations/Repositories areas which
 * get `shortHost` pre-computed in a main payload.
 */
export function shortHost(host: string): string {
  return host.endsWith('.salesforce.com') ? host.slice(0, -'.salesforce.com'.length) : host;
}

/**
 * Coarse summary of a list of check runs — used in card headers where there is
 * no room for the full breakdown. Returns counts grouped as
 * `pass / fail / pending`.
 */
export function summarizeChecks(checks: CheckRun[]): {
  pass: number;
  fail: number;
  pending: number;
} {
  let pass = 0;
  let fail = 0;
  let pending = 0;
  for (const c of checks) {
    const s = c.state.toUpperCase();
    if (s === 'SUCCESS' || s === 'PASS' || s === 'PASSED') pass++;
    else if (s === 'FAILURE' || s === 'FAILED' || s === 'ERROR' || s === 'CANCELLED') fail++;
    else pending++;
  }
  return { pass, fail, pending };
}

const CHECK_STATE_CLASS: Record<string, string> = {
  SUCCESS: 'pass',
  PASS: 'pass',
  PASSED: 'pass',
  FAILURE: 'fail',
  FAILED: 'fail',
  ERROR: 'fail',
  CANCELLED: 'fail',
};

/** Map a raw `gh` check state to a small set of UI classes. */
export function checkStateClass(state: string): 'pass' | 'fail' | 'pending' {
  return (CHECK_STATE_CLASS[state.toUpperCase()] as 'pass' | 'fail' | 'pending') ?? 'pending';
}

/**
 * Render a status as a colored word pill (replaces the subtle dot in tile view).
 * Returns { label, className } where className = 'prm-status-pill--<status>'.
 */
export function statusPill(status: PrRollupStatus): { label: string; className: string } {
  return {
    label: statusLabel(status),
    className: `prm-status-pill--${status}`,
  };
}

/**
 * Default BUILD-pill escalation preset (hours, AC-LIST-13.3 / §3.6 Standard):
 * normal below 4h, warning from 4h up to 6h, danger above 6h. A per-repo build
 * preset (R-SYS-008 / AC-REPO-14.x) overrides these; the caller passes the
 * effective thresholds and these are the fallback.
 */
export const DEFAULT_TIS_WARN_HOURS = 4;
export const DEFAULT_TIS_DANGER_HOURS = 6;

/**
 * Default REVIEW-pill escalation preset (days, R-SYS-009 / §3.6 Standard): ok
 * 1–2d, warn from 3d, danger from 5d. Overridden by the repo's review preset.
 */
export const DEFAULT_REVIEW_TIS_WARN_DAYS = 3;
export const DEFAULT_REVIEW_TIS_DANGER_DAYS = 5;

/**
 * Format elapsed time-in-status as "Xm" / "Xh" / "Xd" (AC-LIST-13.1 / §3.5 unit
 * auto-switch). `since` is an epoch-ms clock origin (the build pill's
 * `lastStatusChange`, or the review pill's `reviewClockStartedAt`). A just-added
 * / just-changed PR reads "0m" (AC-LIST-13.4). Returns '' when there is no
 * timestamp. Shared by both pills (§6.3).
 */
export function formatTimeInStatus(since: number | undefined): string {
  if (!since) return '';
  const delta = Math.max(0, Date.now() - since);
  const m = Math.floor(delta / (1000 * 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/**
 * BUILD-pill escalation level from an hours-based preset (§6.3). `since` is the
 * build clock origin (`lastStatusChange`); thresholds default to the standard
 * build preset. A PR at 0 elapsed is always 'ok' (AC-LIST-13.4).
 */
export function buildTisColor(
  since: number | undefined,
  warnHours = DEFAULT_TIS_WARN_HOURS,
  dangerHours = DEFAULT_TIS_DANGER_HOURS
): 'ok' | 'warn' | 'danger' {
  if (!since) return 'ok';
  const h = Math.max(0, Date.now() - since) / (1000 * 60 * 60);
  if (h >= dangerHours) return 'danger';
  if (h >= warnHours) return 'warn';
  return 'ok';
}

/**
 * REVIEW-pill escalation level from a DAYS-based preset (§6.3). `since` is the
 * review clock origin (`reviewClockStartedAt`); thresholds default to the
 * standard review preset. A PR at 0 elapsed is always 'ok'.
 */
export function reviewTisColor(
  since: number | undefined,
  warnDays = DEFAULT_REVIEW_TIS_WARN_DAYS,
  dangerDays = DEFAULT_REVIEW_TIS_DANGER_DAYS
): 'ok' | 'warn' | 'danger' {
  if (!since) return 'ok';
  const d = Math.max(0, Date.now() - since) / (1000 * 60 * 60 * 24);
  if (d >= dangerDays) return 'danger';
  if (d >= warnDays) return 'warn';
  return 'ok';
}

/**
 * @deprecated Kept for callers not yet split into build/review. Delegates to
 * {@link buildTisColor} (hours) — the historical single-clock behavior.
 */
export function timeInStatusColor(
  since: number | undefined,
  warnHours = DEFAULT_TIS_WARN_HOURS,
  dangerHours = DEFAULT_TIS_DANGER_HOURS
): 'ok' | 'warn' | 'danger' {
  return buildTisColor(since, warnHours, dangerHours);
}

/**
 * Non-color escalation cue (AC-LIST-13.2, colorblind users), named for the gate
 * (§6.3). 'ok' surfaces no word; warn/danger read "Build slow"/"Build stalled"
 * or "Review slow"/"Review stalled". The build pill's `merge-stall` state uses
 * {@link tisLabel}('danger','build') with a caller-supplied "Merge" override —
 * see PrTile — so this stays a pure (level, gate) function.
 */
export function tisLabel(level: 'ok' | 'warn' | 'danger', gate: 'build' | 'review'): string {
  const noun = gate === 'build' ? 'Build' : 'Review';
  if (level === 'danger') return `${noun} stalled`;
  if (level === 'warn') return `${noun} slow`;
  return '';
}

/**
 * @deprecated Historical single-clock label. Prefer {@link tisLabel}. Returns the
 * bare word ("Slow"/"Stalled") the old single pill used.
 */
export function timeInStatusLabel(level: 'ok' | 'warn' | 'danger'): string {
  if (level === 'danger') return 'Stalled';
  if (level === 'warn') return 'Slow';
  return '';
}

/**
 * Two-letter initials for a reviewer/author avatar.
 *
 * Prefers the display name, else the login. Splits on whitespace AND the common
 * login word-separators (`.`, `_`, `-`) so a hyphenated login yields the two
 * "word" initials rather than the first two letters:
 *   "Jane Doe"   -> "JD"  (two whitespace parts)
 *   "octocat"    -> "OC"  (single part -> first two chars)
 *   "dan-cohen"  -> "DC"  (hyphen split)
 *   "dan.cohen"  -> "DC"  (dot split)
 *   "dan_cohen"  -> "DC"  (underscore split)
 */
export function initialsOf(who: { name?: string; login: string }): string {
  const src = who.name || who.login;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

/**
 * The tile's trailing action set (mark read/unread · favorite/unfavorite ·
 * mute/unmute · dismiss), all rendered inline as icon buttons on the row.
 */
export type RowActionId = 'seen' | 'favorite' | 'mute' | 'dismiss';
