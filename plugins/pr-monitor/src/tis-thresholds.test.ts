import { describe, it, expect } from 'vitest';
import {
  resolveTisThresholds,
  resolveBuildThresholds,
  resolveReviewThresholds,
  TIS_PRESETS,
  REVIEW_TIS_PRESETS,
  type MonitoredRepo,
} from '../lib/types.js';

/**
 * Per-repo time-in-status preset override (R-REPO-014 / AC-REPO-14.2/14.3,
 * AC-LIST-13.3 build, AC-LIST-25.3 review). A repo's assigned preset OVERRIDES
 * the global thresholds; a repo with no match (or unresolvable preset) falls back
 * to the passed globals. Two independent families now: build (hours) + review (days).
 */

function repo(over: Partial<MonitoredRepo> = {}): MonitoredRepo {
  return {
    owner: 'acme',
    repo: 'widgets',
    host: 'github.com',
    orgLogin: 'acme',
    active: true,
    buildTisPreset: 'standard',
    reviewTisPreset: 'standard',
    createdAt: 0,
    notifyInApp: true,
    ...over,
  };
}

describe('resolveBuildThresholds — per-repo build preset override (hours)', () => {
  it('AC-REPO-14.2: a repo assigned long-running escalates on its build preset, not the globals', () => {
    const t = resolveBuildThresholds('acme/widgets', [repo({ buildTisPreset: 'long-running' })], 4, 6);
    expect(t).toEqual({
      warnHours: TIS_PRESETS['long-running'].warnHours,
      dangerHours: TIS_PRESETS['long-running'].dangerHours,
    });
  });

  it('AC-REPO-14.2: a repo assigned fast escalates on the fast preset', () => {
    const t = resolveBuildThresholds('acme/widgets', [repo({ buildTisPreset: 'fast' })], 4, 6);
    expect(t).toEqual({ warnHours: 1, dangerHours: 2 });
  });

  it('AC-REPO-14.3: standard preset resolves to the standard (4h/6h) bar', () => {
    const t = resolveBuildThresholds('acme/widgets', [repo({ buildTisPreset: 'standard' })], 4, 6);
    expect(t).toEqual({ warnHours: 4, dangerHours: 6 });
  });

  it('AC-LIST-13.3: an unknown repo falls back to the passed globals', () => {
    const t = resolveBuildThresholds('other/repo', [repo({ buildTisPreset: 'fast' })], 4, 6);
    expect(t).toEqual({ warnHours: 4, dangerHours: 6 });
  });

  it('legacy: a repo carrying only the old `tisPreset` resolves it as the build preset', () => {
    const legacy = { ...repo(), buildTisPreset: undefined, tisPreset: 'fast' as const };
    const t = resolveBuildThresholds('acme/widgets', [legacy], 4, 6);
    expect(t).toEqual({ warnHours: 1, dangerHours: 2 });
  });

  it('a matched repo with no build preset at all resolves to Standard, not the globals', () => {
    const bare = { ...repo(), buildTisPreset: undefined, tisPreset: undefined };
    const t = resolveBuildThresholds('acme/widgets', [bare], 9, 12);
    expect(t).toEqual({ warnHours: 4, dangerHours: 6 });
  });

  it('matching is case-insensitive on owner/repo', () => {
    const t = resolveBuildThresholds('ACME/Widgets', [repo({ buildTisPreset: 'fast' })], 4, 6);
    expect(t).toEqual({ warnHours: 1, dangerHours: 2 });
  });

  it('empty repo name → globals', () => {
    const t = resolveBuildThresholds('', [repo({ buildTisPreset: 'fast' })], 5, 9);
    expect(t).toEqual({ warnHours: 5, dangerHours: 9 });
  });
});

describe('resolveReviewThresholds — per-repo review preset override (days)', () => {
  it('AC-SYS-9.1: a repo assigned long-running review preset escalates on its days bar', () => {
    const t = resolveReviewThresholds('acme/widgets', [repo({ reviewTisPreset: 'long-running' })], 3, 5);
    expect(t).toEqual({
      warnDays: REVIEW_TIS_PRESETS['long-running'].warnDays,
      dangerDays: REVIEW_TIS_PRESETS['long-running'].dangerDays,
    });
  });

  it('AC-SYS-9.1: a repo assigned fast review preset escalates on 1d/2d', () => {
    const t = resolveReviewThresholds('acme/widgets', [repo({ reviewTisPreset: 'fast' })], 3, 5);
    expect(t).toEqual({ warnDays: 1, dangerDays: 2 });
  });

  it('AC-SYS-9.2: standard review preset resolves to 3d/5d', () => {
    const t = resolveReviewThresholds('acme/widgets', [repo({ reviewTisPreset: 'standard' })], 3, 5);
    expect(t).toEqual({ warnDays: 3, dangerDays: 5 });
  });

  it('AC-SYS-9.2: a matched repo with no review preset resolves to Standard (3d/5d), not the globals', () => {
    const bare = { ...repo(), reviewTisPreset: undefined };
    const t = resolveReviewThresholds('acme/widgets', [bare], 9, 12);
    expect(t).toEqual({ warnDays: 3, dangerDays: 5 });
  });

  it('an unknown repo falls back to the passed review globals', () => {
    const t = resolveReviewThresholds('other/repo', [repo({ reviewTisPreset: 'fast' })], 3, 5);
    expect(t).toEqual({ warnDays: 3, dangerDays: 5 });
  });

  it('empty repo name → review globals', () => {
    const t = resolveReviewThresholds('', [repo({ reviewTisPreset: 'fast' })], 4, 8);
    expect(t).toEqual({ warnDays: 4, dangerDays: 8 });
  });
});

describe('resolveTisThresholds — back-compat shim delegates to build resolver', () => {
  it('returns the build thresholds for the repo', () => {
    const t = resolveTisThresholds('acme/widgets', [repo({ buildTisPreset: 'fast' })], 4, 6);
    expect(t).toEqual({ warnHours: 1, dangerHours: 2 });
  });
});
