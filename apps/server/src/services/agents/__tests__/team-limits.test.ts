import { describe, expect, it } from 'vitest';
import { sanitizeTeamLimits, TEAM_LIMIT_BOUNDS } from '@zana-ai/zcc-domain/product';

const DAY = 24 * 60 * 60_000;

describe('sanitizeTeamLimits', () => {
  it('returns undefined for absent, non-object, array and empty input', () => {
    for (const raw of [undefined, null, 5, 'x', [], {}]) expect(sanitizeTeamLimits(raw)).toBeUndefined();
  });

  it('keeps in-range values and floors fractions', () => {
    expect(sanitizeTeamLimits({ maxConcurrent: 8.9, claimWallClockMs: 90_000.5, claimStallMs: 120_000 }))
      .toEqual({ maxConcurrent: 8, claimWallClockMs: 90_000, claimStallMs: 120_000 });
  });

  it('clamps out-of-range values into the bounds', () => {
    expect(sanitizeTeamLimits({ maxConcurrent: 500, claimWallClockMs: 10, claimStallMs: DAY * 9 })).toEqual({
      maxConcurrent: TEAM_LIMIT_BOUNDS.maxConcurrent.max,
      claimWallClockMs: TEAM_LIMIT_BOUNDS.claimWallClockMs.min,
      claimStallMs: DAY
    });
  });

  it('drops zero, negative, NaN, infinite and non-numeric fields while keeping valid siblings', () => {
    expect(sanitizeTeamLimits({ maxConcurrent: 0, claimWallClockMs: -5, claimStallMs: 300_000 })).toEqual({ claimStallMs: 300_000 });
    for (const bad of [Number.NaN, Infinity, '4', null, true, {}]) {
      expect(sanitizeTeamLimits({ maxConcurrent: bad })).toBeUndefined();
    }
  });

  it('sanitizes the output-only ceiling like the other clocks', () => {
    expect(sanitizeTeamLimits({ claimOutputCeilingMs: 1_800_000.7 })).toEqual({ claimOutputCeilingMs: 1_800_000 });
    expect(sanitizeTeamLimits({ claimOutputCeilingMs: 5 })).toEqual({ claimOutputCeilingMs: TEAM_LIMIT_BOUNDS.claimOutputCeilingMs.min });
    expect(sanitizeTeamLimits({ claimOutputCeilingMs: DAY * 9 })).toEqual({ claimOutputCeilingMs: DAY });
    expect(sanitizeTeamLimits({ claimOutputCeilingMs: -1, claimStallMs: 300_000 })).toEqual({ claimStallMs: 300_000 });
  });
});
