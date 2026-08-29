/**
 * Pure state machines for the two time-in-status pills (R-LIST-013 build /
 * R-LIST-025 review) plus the build-happy / ignored-check primitives they read.
 *
 * Lives in `shared/` (not `main/status.ts`) because BOTH tiers consume it: the
 * renderer computes pill states live from the data already on a `MonitoredPr`,
 * and the poller uses the same helpers to cache advisory verdicts. No I/O, no ctx
 * — every function is a pure function of its structured inputs.
 *
 * The nine rollup statuses and their `computeStatus`/`computeClosedStatus`
 * classifiers (main-only) are UNCHANGED — these readings are an advisory OVERLAY
 * on top of the existing status (plan §4). Ignored-check failures affect only the
 * build/merge stall computation here, never the rollup badge.
 */

import type { CheckRun, PrRollupStatus } from './types.js';

// Check-state buckets — mirror the private sets in `main/status.ts`. Kept in sync
// by `pillState.test.ts` (a drift guard) rather than shared, so `computeStatus`
// stays byte-for-byte unchanged (plan §6.2 "existing classifiers unchanged").
const DONE_OK = new Set(['pass', 'success', 'neutral', 'skipped', 'skipping', 'cancelled', 'cancel']);
const FAIL = new Set(['fail', 'failure']);
const RUNNING = new Set(['pending', 'in_progress', 'queued']);

function normalize(s: string | undefined): string {
  return (s ?? '').toLowerCase().trim() || 'pending';
}

/**
 * The build pill's state (R-LIST-013 / R-LIST-014):
 *   - 'ok' / 'warn' / 'danger' — live build clock escalating on the build preset;
 *     'danger' renders "Build stalled" (AC-LIST-14.1).
 *   - 'done'      — build is happy / propagating / terminal → passive "Build ✓"
 *     (AC-LIST-13.7), no live clock, never stalls (AC-LIST-14.6).
 *   - 'blocked'   — SFCI-gated repo with no `tok-gimlet` job comment yet: the user
 *     can't act, so the pill NEVER stalls; renders a plain clock (AC-LIST-14.5).
 *   - 'merge-stall' — build-happy + review-approved + merge-blocked + unmerged,
 *     past the (refreshed) build danger threshold → "Merge stalled" (AC-LIST-14.7).
 */
export type BuildPillState = 'ok' | 'warn' | 'danger' | 'done' | 'blocked' | 'merge-stall';

/** The review pill's state (R-LIST-025). 'done' = approved & unmerged → "Review ✓". */
export type ReviewPillState = 'ok' | 'warn' | 'danger' | 'done';

/**
 * Does `name` match any ignored-check substring (AC-REPO-18.2)? Case-insensitive
 * substring containment. The "Ignore Snyk" toggle maps to `['Snyk']`.
 */
export function isIgnoredFailingCheck(name: string, ignored: string[] | undefined): boolean {
  if (!ignored || ignored.length === 0) return false;
  const n = (name ?? '').toLowerCase();
  return ignored.some((entry) => {
    const e = (entry ?? '').toLowerCase();
    return e.length > 0 && n.includes(e);
  });
}

/**
 * Is the build "happy" (AC-LIST-13.7)? True when there is at least one check and
 * every check is done AND either passing or an ignored-list failure. A running
 * check, or an un-ignored failure, makes it not-happy. Zero checks → not happy
 * (unknown — a fresh PR reads a plain clock, not a false "Build ✓").
 */
export function isBuildHappy(checks: CheckRun[], opts: { ignoredFailingChecks?: string[] } = {}): boolean {
  if (!checks || checks.length === 0) return false;
  const ignored = opts.ignoredFailingChecks;
  for (const c of checks) {
    const st = normalize(c.bucket || c.state);
    if (RUNNING.has(st)) return false;
    if (FAIL.has(st) && !isIgnoredFailingCheck(c.name, ignored)) return false;
  }
  return true;
}

/**
 * The build pill state machine (§3.3a/§3.3b). Pure over already-derived inputs so
 * the renderer can call it directly.
 *   - `status`        — the PR's rollup status (drives terminal/merge-step reads).
 *   - `buildHappy`    — {@link isBuildHappy} over the PR's checks + repo ignore list.
 *   - `reviewApproved`— `reviewDecision === 'APPROVED'`.
 *   - `sfciGated`     — repo's `sfciGated` flag; `hasSfciJob` — the cached tok-gimlet
 *     comment verdict (only meaningful when gated).
 *   - `elapsedHours`  — hours since the build clock origin (`lastStatusChange`,
 *     refreshed on entry to the merge step, §6.7); `warnHours`/`dangerHours` = the
 *     repo's build preset thresholds.
 */
export function buildStallState(input: {
  status: PrRollupStatus;
  buildHappy: boolean;
  reviewApproved: boolean;
  sfciGated: boolean;
  hasSfciJob: boolean;
  elapsedHours: number;
  warnHours: number;
  dangerHours: number;
}): BuildPillState {
  const { status, buildHappy, reviewApproved, sfciGated, hasSfciJob, elapsedHours, warnHours, dangerHours } = input;

  // Terminal / propagating: the change is landing or landed — no live build clock,
  // and a PR already propagating (Merging/integrating) shows no merge-stall (§3.3b).
  if (status === 'integrating' || status === 'closed-merged' || status === 'closed-abandoned') {
    return 'done';
  }

  // Gated repo with no SFCI-job comment yet: the user cannot act (job not created,
  // can take ~30m). The pill NEVER stalls — plain clock (AC-LIST-14.5 / AC-REPO-17.3).
  const gatedBlocked = sfciGated && !hasSfciJob;

  // Merge step: build finished its checks, review approved, but the commit hasn't
  // reached the destination branch (merge-blocked = 'yellow'). This rides the BUILD
  // clock; its danger level is labelled "Merge stalled" (AC-LIST-14.7).
  const inMergeStep = buildHappy && reviewApproved && status === 'yellow';
  if (inMergeStep) {
    if (gatedBlocked) return 'blocked';
    if (elapsedHours >= dangerHours) return 'merge-stall';
    if (elapsedHours >= warnHours) return 'warn';
    return 'ok';
  }

  // Build happy and NOT in the merge step (green, or waiting on review) → the build
  // has done its part: passive "Build ✓" (AC-LIST-13.7), never stalls (AC-LIST-14.6).
  if (buildHappy) return 'done';

  // Build still running / not happy.
  if (gatedBlocked) return 'blocked';
  if (elapsedHours >= dangerHours) return 'danger';
  if (elapsedHours >= warnHours) return 'warn';
  return 'ok';
}

/**
 * The review pill state machine (R-LIST-025). Pure. The caller only renders this
 * for Open (non-Draft) PRs (AC-LIST-25.1).
 *   - 'done'  — approved & unmerged → passive "Review ✓" (AC-LIST-25.5).
 *   - 'warn'/'danger'/'ok' — live review clock on the review preset (days).
 */
export function reviewState(input: {
  reviewApproved: boolean;
  merged: boolean;
  elapsedDays: number;
  warnDays: number;
  dangerDays: number;
}): ReviewPillState {
  const { reviewApproved, merged, elapsedDays, warnDays, dangerDays } = input;
  if (reviewApproved && !merged) return 'done';
  if (elapsedDays >= dangerDays) return 'danger';
  if (elapsedDays >= warnDays) return 'warn';
  return 'ok';
}
