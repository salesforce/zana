/**
 * Time-in-status formatting/escalation tests.
 *
 * AC-SYS-8.3: the per-repo TIS preset governs the escalation LEVEL/color +
 * stalled threshold (warn/danger hours) ONLY — it does NOT change the elapsed
 * TIME VALUE (AC-LIST-13.1) or PR age. So `formatTimeInStatus` is independent of
 * the preset, while `timeInStatusColor` consumes the preset's warn/danger hours.
 */
import { describe, it, expect } from 'vitest';
import {
  formatTimeInStatus,
  timeInStatusColor,
  timeInStatusLabel,
  buildTisColor,
  reviewTisColor,
  tisLabel,
  statusPill,
  statusLabel,
  initialsOf,
  DEFAULT_TIS_WARN_HOURS,
  DEFAULT_TIS_DANGER_HOURS,
  DEFAULT_REVIEW_TIS_WARN_DAYS,
  DEFAULT_REVIEW_TIS_DANGER_DAYS,
} from './formatHelpers.js';
import type { PrRollupStatus } from '../../lib/types.js';

const HOUR = 60 * 60 * 1000;

describe('statusPill (AC-LIST-12.1/12.2 severity styling, label never replaced)', () => {
  // The exact 9-word label set from AC-LIST-12.1, and no others.
  const CASES: Array<[PrRollupStatus, string]> = [
    ['pending', 'Pending'],
    ['failed', 'Failing'],
    ['conflict', 'Merge conflict'],
    ['yellow', 'Merge blocked'],
    ['review-required', 'Review required'],
    ['integrating', 'Merging'],
    ['green', 'All checks passing'],
    ['closed-merged', 'Merged'],
    ['closed-abandoned', 'Closed'],
  ];

  it('AC-LIST-12.1: every status maps to its exact canonical label', () => {
    for (const [status, label] of CASES) {
      expect(statusLabel(status)).toBe(label);
      expect(statusPill(status).label).toBe(label);
    }
  });

  it('AC-LIST-12.2: pill is styled by severity via a per-status className, and the label is always present (never replaced by an icon)', () => {
    for (const [status, label] of CASES) {
      const pill = statusPill(status);
      // Severity/activity styling is carried by a per-status class...
      expect(pill.className).toBe(`prm-status-pill--${status}`);
      // ...but the textual label is ALWAYS present — the class reinforces it,
      // it never replaces the word (the load-bearing AC-LIST-12.2 invariant).
      expect(pill.label).toBe(label);
      expect(pill.label.length).toBeGreaterThan(0);
    }
  });
});

describe('formatTimeInStatus (AC-LIST-13.1 / AC-SYS-8.3 value independence)', () => {
  it('returns empty string when there is no timestamp', () => {
    expect(formatTimeInStatus(undefined)).toBe('');
  });

  it('formats minutes / hours / days from elapsed', () => {
    const now = Date.now();
    expect(formatTimeInStatus(now)).toBe('0m');
    expect(formatTimeInStatus(now - 30 * 60 * 1000)).toBe('30m');
    expect(formatTimeInStatus(now - 5 * HOUR)).toBe('5h');
    expect(formatTimeInStatus(now - 50 * HOUR)).toBe('2d');
  });

  it('unit auto-switch at the day boundary: <24h reads "Xh", ≥24h reads "Xd"', () => {
    const now = Date.now();
    // 23h stays hours, 25h flips to days — one shared formatter, both pills.
    expect(formatTimeInStatus(now - 23 * HOUR)).toBe('23h');
    expect(formatTimeInStatus(now - 24 * HOUR)).toBe('1d');
    expect(formatTimeInStatus(now - 25 * HOUR)).toBe('1d');
  });

  it('AC-SYS-8.3: elapsed value takes no preset — same "5h" regardless of thresholds', () => {
    // formatTimeInStatus has no threshold parameter at all: the same elapsed time
    // reads identically whether the repo uses a strict or relaxed preset.
    const since = Date.now() - 5 * HOUR;
    expect(formatTimeInStatus(since)).toBe('5h');
  });
});

describe('timeInStatusColor (AC-LIST-13.2/13.3 / AC-SYS-8.3 preset governs escalation)', () => {
  it('a fresh PR (0 elapsed / no timestamp) is always ok', () => {
    expect(timeInStatusColor(undefined)).toBe('ok');
    expect(timeInStatusColor(Date.now())).toBe('ok');
  });

  it('escalates ok → warn → danger against the DEFAULT preset thresholds', () => {
    const now = Date.now();
    expect(timeInStatusColor(now - 1 * HOUR)).toBe('ok');
    expect(timeInStatusColor(now - (DEFAULT_TIS_WARN_HOURS + 0.5) * HOUR)).toBe('warn');
    expect(timeInStatusColor(now - (DEFAULT_TIS_DANGER_HOURS + 0.5) * HOUR)).toBe('danger');
  });

  it('AC-SYS-8.3: the preset governs the level — same elapsed, different color per thresholds', () => {
    // A PR at 5h elapsed: 'warn' under the default (4h/6h) preset, but 'danger'
    // under a stricter (2h/4h) preset. The escalation follows the PRESET, while
    // the elapsed value ("5h") stays fixed (asserted above).
    const since = Date.now() - 5 * HOUR;
    expect(timeInStatusColor(since, DEFAULT_TIS_WARN_HOURS, DEFAULT_TIS_DANGER_HOURS)).toBe('warn');
    expect(timeInStatusColor(since, 2, 4)).toBe('danger');
    // And a relaxed (8h/12h) preset keeps the very same PR 'ok'.
    expect(timeInStatusColor(since, 8, 12)).toBe('ok');
  });

  it('the escalation label is the colorblind cue: Slow / Stalled / none', () => {
    expect(timeInStatusLabel('ok')).toBe('');
    expect(timeInStatusLabel('warn')).toBe('Slow');
    expect(timeInStatusLabel('danger')).toBe('Stalled');
  });
});

describe('buildTisColor — build/merge pill escalates on the HOURS clock', () => {
  it('a fresh build clock (0 elapsed / no timestamp) is ok', () => {
    expect(buildTisColor(undefined, DEFAULT_TIS_WARN_HOURS, DEFAULT_TIS_DANGER_HOURS)).toBe('ok');
    expect(buildTisColor(Date.now(), DEFAULT_TIS_WARN_HOURS, DEFAULT_TIS_DANGER_HOURS)).toBe('ok');
  });

  it('escalates ok → warn → danger against the HOURS thresholds', () => {
    const now = Date.now();
    expect(buildTisColor(now - 1 * HOUR, DEFAULT_TIS_WARN_HOURS, DEFAULT_TIS_DANGER_HOURS)).toBe('ok');
    expect(buildTisColor(now - (DEFAULT_TIS_WARN_HOURS + 0.5) * HOUR, DEFAULT_TIS_WARN_HOURS, DEFAULT_TIS_DANGER_HOURS)).toBe('warn');
    expect(buildTisColor(now - (DEFAULT_TIS_DANGER_HOURS + 0.5) * HOUR, DEFAULT_TIS_WARN_HOURS, DEFAULT_TIS_DANGER_HOURS)).toBe('danger');
  });

  it('the preset governs the level — same 5h elapsed, different color per thresholds', () => {
    const since = Date.now() - 5 * HOUR;
    expect(buildTisColor(since, DEFAULT_TIS_WARN_HOURS, DEFAULT_TIS_DANGER_HOURS)).toBe('warn'); // 4h/6h
    expect(buildTisColor(since, 2, 4)).toBe('danger'); // strict
    expect(buildTisColor(since, 8, 12)).toBe('ok'); // relaxed
  });
});

describe('reviewTisColor — review pill escalates on the DAYS clock', () => {
  const DAY = 24 * HOUR;

  it('a fresh review clock (0 elapsed / no timestamp) is ok', () => {
    expect(reviewTisColor(undefined, DEFAULT_REVIEW_TIS_WARN_DAYS, DEFAULT_REVIEW_TIS_DANGER_DAYS)).toBe('ok');
    expect(reviewTisColor(Date.now(), DEFAULT_REVIEW_TIS_WARN_DAYS, DEFAULT_REVIEW_TIS_DANGER_DAYS)).toBe('ok');
  });

  it('escalates ok → warn → danger against the DAYS thresholds', () => {
    const now = Date.now();
    expect(reviewTisColor(now - 1 * DAY, DEFAULT_REVIEW_TIS_WARN_DAYS, DEFAULT_REVIEW_TIS_DANGER_DAYS)).toBe('ok');
    expect(reviewTisColor(now - (DEFAULT_REVIEW_TIS_WARN_DAYS + 0.5) * DAY, DEFAULT_REVIEW_TIS_WARN_DAYS, DEFAULT_REVIEW_TIS_DANGER_DAYS)).toBe('warn');
    expect(reviewTisColor(now - (DEFAULT_REVIEW_TIS_DANGER_DAYS + 0.5) * DAY, DEFAULT_REVIEW_TIS_WARN_DAYS, DEFAULT_REVIEW_TIS_DANGER_DAYS)).toBe('danger');
  });

  it('uses a DAYS scale, not hours: 5h elapsed is still ok on the default review preset', () => {
    // The review clock is coarse — a PR open only hours reads ok even though the
    // same elapsed time would be 'warn' on the build (hours) clock.
    const since = Date.now() - 5 * HOUR;
    expect(reviewTisColor(since, DEFAULT_REVIEW_TIS_WARN_DAYS, DEFAULT_REVIEW_TIS_DANGER_DAYS)).toBe('ok');
  });
});

describe('tisLabel — gate-named colorblind cue (build vs review)', () => {
  it('ok is silent for both gates', () => {
    expect(tisLabel('ok', 'build')).toBe('');
    expect(tisLabel('ok', 'review')).toBe('');
  });

  it('warn / danger name the gate: Build slow/stalled, Review slow/stalled', () => {
    expect(tisLabel('warn', 'build')).toBe('Build slow');
    expect(tisLabel('danger', 'build')).toBe('Build stalled');
    expect(tisLabel('warn', 'review')).toBe('Review slow');
    expect(tisLabel('danger', 'review')).toBe('Review stalled');
  });
});

describe('initialsOf (item 12: split on whitespace AND . _ - word-separators)', () => {
  it('takes the first char of the first two parts for multi-part names/logins', () => {
    expect(initialsOf({ login: 'x', name: 'Jane Doe' })).toBe('JD');
    expect(initialsOf({ login: 'dan-cohen' })).toBe('DC');
    expect(initialsOf({ login: 'dan.cohen' })).toBe('DC');
    expect(initialsOf({ login: 'dan_cohen' })).toBe('DC');
  });

  it('falls back to the first two chars for a single-part login', () => {
    expect(initialsOf({ login: 'octocat' })).toBe('OC');
  });

  it('prefers the display name over the login', () => {
    // A hyphenated login is ignored when a real name is present.
    expect(initialsOf({ login: 'dan-cohen', name: 'Daniel Cohen' })).toBe('DC');
  });
});
