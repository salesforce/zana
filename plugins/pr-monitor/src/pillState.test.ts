import { describe, it, expect } from 'vitest';
import {
  isIgnoredFailingCheck,
  isBuildHappy,
  buildStallState,
  reviewState,
} from '../lib/pillState.js';
import type { CheckRun } from '../lib/types.js';

const pass = (name: string): CheckRun => ({ name, state: 'SUCCESS', bucket: 'pass' });
const fail = (name: string): CheckRun => ({ name, state: 'FAILURE', bucket: 'fail' });
const running = (name: string): CheckRun => ({ name, state: 'IN_PROGRESS', bucket: 'pending' });

describe('isIgnoredFailingCheck (AC-REPO-18.2)', () => {
  it('substring, case-insensitive', () => {
    expect(isIgnoredFailingCheck('Snyk Open Source', ['Snyk'])).toBe(true);
    expect(isIgnoredFailingCheck('security/snyk-scan', ['Snyk'])).toBe(true);
    expect(isIgnoredFailingCheck('Build', ['Snyk'])).toBe(false);
  });

  it('empty / undefined ignore list ignores nothing', () => {
    expect(isIgnoredFailingCheck('Snyk', [])).toBe(false);
    expect(isIgnoredFailingCheck('Snyk', undefined)).toBe(false);
  });

  it('an empty-string entry never matches (no accidental match-all)', () => {
    expect(isIgnoredFailingCheck('anything', [''])).toBe(false);
  });
});

describe('isBuildHappy (AC-LIST-13.7)', () => {
  it('all done + passing → happy', () => {
    expect(isBuildHappy([pass('Build'), pass('Tests')])).toBe(true);
  });

  it('a running check → not happy', () => {
    expect(isBuildHappy([pass('Build'), running('Tests')])).toBe(false);
  });

  it('an un-ignored failure → not happy', () => {
    expect(isBuildHappy([pass('Build'), fail('Tests')])).toBe(false);
  });

  it('an ignored (Snyk) failure counts as pass → happy', () => {
    expect(isBuildHappy([pass('Build'), fail('Snyk')], { ignoredFailingChecks: ['Snyk'] })).toBe(true);
  });

  it('an ignored Snyk fail but ALSO a real fail → still not happy', () => {
    expect(isBuildHappy([fail('Snyk'), fail('Tests')], { ignoredFailingChecks: ['Snyk'] })).toBe(false);
  });

  it('zero checks → not happy (unknown, not a false Build ✓)', () => {
    expect(isBuildHappy([])).toBe(false);
  });
});

describe('buildStallState (R-LIST-013/014, §3.3a/§3.3b)', () => {
  const base = {
    status: 'pending' as const,
    buildHappy: false,
    reviewApproved: false,
    sfciGated: false,
    hasSfciJob: false,
    elapsedHours: 0,
    warnHours: 4,
    dangerHours: 6,
  };

  it('non-gated build running: ok → warn → danger across thresholds (AC-LIST-14.1)', () => {
    expect(buildStallState({ ...base, elapsedHours: 1 })).toBe('ok');
    expect(buildStallState({ ...base, elapsedHours: 4 })).toBe('warn');
    expect(buildStallState({ ...base, elapsedHours: 6 })).toBe('danger');
  });

  it('build-happy → done, never stalls even past danger (AC-LIST-13.7/14.6)', () => {
    expect(buildStallState({ ...base, status: 'green', buildHappy: true, elapsedHours: 99 })).toBe('done');
  });

  it('AC-LIST-14.5: gated repo with NO tok-gimlet comment → blocked, never stalls', () => {
    expect(buildStallState({ ...base, sfciGated: true, hasSfciJob: false, elapsedHours: 99 })).toBe('blocked');
  });

  it('AC-LIST-14.5: gated repo WITH the comment → escalates like a normal build', () => {
    expect(buildStallState({ ...base, sfciGated: true, hasSfciJob: true, elapsedHours: 6 })).toBe('danger');
  });

  it('AC-LIST-14.7: merge step (build-happy + approved + yellow) past danger → merge-stall', () => {
    const mergeBlocked = { ...base, status: 'yellow' as const, buildHappy: true, reviewApproved: true };
    expect(buildStallState({ ...mergeBlocked, elapsedHours: 1 })).toBe('ok');
    expect(buildStallState({ ...mergeBlocked, elapsedHours: 4 })).toBe('warn');
    expect(buildStallState({ ...mergeBlocked, elapsedHours: 6 })).toBe('merge-stall');
  });

  it('AC-LIST-14.7: gated merge step with no SFCI comment → blocked, not merge-stall', () => {
    const gatedMerge = {
      ...base,
      status: 'yellow' as const,
      buildHappy: true,
      reviewApproved: true,
      sfciGated: true,
      hasSfciJob: false,
      elapsedHours: 99,
    };
    expect(buildStallState(gatedMerge)).toBe('blocked');
  });

  it('AC-LIST-14.7: a propagating PR (integrating) shows no merge-stall → done', () => {
    expect(buildStallState({ ...base, status: 'integrating', buildHappy: true, reviewApproved: true, elapsedHours: 99 })).toBe('done');
  });

  it('terminal (closed-merged / closed-abandoned) → done', () => {
    expect(buildStallState({ ...base, status: 'closed-merged', elapsedHours: 99 })).toBe('done');
    expect(buildStallState({ ...base, status: 'closed-abandoned', elapsedHours: 99 })).toBe('done');
  });
});

describe('reviewState (R-LIST-025)', () => {
  const base = { reviewApproved: false, merged: false, elapsedDays: 0, warnDays: 3, dangerDays: 5 };

  it('escalates ok → warn → danger across day thresholds', () => {
    expect(reviewState({ ...base, elapsedDays: 1 })).toBe('ok');
    expect(reviewState({ ...base, elapsedDays: 3 })).toBe('warn');
    expect(reviewState({ ...base, elapsedDays: 5 })).toBe('danger');
  });

  it('AC-LIST-25.5: approved & unmerged → done (Review ✓), no clock', () => {
    expect(reviewState({ ...base, reviewApproved: true, elapsedDays: 99 })).toBe('done');
  });

  it('approved but already merged → not done (falls through to clock)', () => {
    expect(reviewState({ ...base, reviewApproved: true, merged: true, elapsedDays: 1 })).toBe('ok');
  });
});
