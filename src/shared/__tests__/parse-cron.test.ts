import { describe, it, expect } from 'vitest';
import {
  describeCron,
  isValidCron,
  nextCronRunAt,
  nextCronRuns
} from '../parse-cron.js';

describe('isValidCron', () => {
  it('accepts standard 5-field expressions', () => {
    expect(isValidCron('0 9 * * 1-5')).toBe(true);
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('0 0 1 * *')).toBe(true);
  });

  it('rejects empty / garbage', () => {
    expect(isValidCron('')).toBe(false);
    expect(isValidCron('   ')).toBe(false);
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('90 9 * * *')).toBe(false); // minute out of range
  });

  it('rejects an impossible date (parseable but no next run)', () => {
    // Feb 30 never occurs → croner parses it but yields no next run.
    expect(isValidCron('0 0 30 2 *')).toBe(false);
  });

  it('validates against a timezone', () => {
    expect(isValidCron('0 9 * * *', 'Europe/Paris')).toBe(true);
    expect(isValidCron('0 9 * * *', 'Not/AZone')).toBe(false);
  });
});

describe('nextCronRunAt', () => {
  it('returns the next slot strictly after `from`', () => {
    // A Wednesday at 08:00 UTC; weekdays-at-09:00 should be 09:00 same day.
    const from = new Date('2026-07-15T08:00:00Z');
    const next = nextCronRunAt('0 9 * * *', 'UTC', from);
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-07-15T09:00:00.000Z');
  });

  it('rolls to the next day when the slot already passed', () => {
    const from = new Date('2026-07-15T10:00:00Z');
    const next = nextCronRunAt('0 9 * * *', 'UTC', from);
    expect(next!.toISOString()).toBe('2026-07-16T09:00:00.000Z');
  });

  it('skips to the next weekday for a weekday-only cron', () => {
    // 2026-07-18 is a Saturday; weekdays cron should skip to Monday the 20th.
    const from = new Date('2026-07-18T00:00:00Z');
    const next = nextCronRunAt('0 9 * * 1-5', 'UTC', from);
    expect(next!.toISOString()).toBe('2026-07-20T09:00:00.000Z');
  });

  it('returns null on invalid input', () => {
    expect(nextCronRunAt('garbage', undefined, new Date())).toBeNull();
    expect(nextCronRunAt('', undefined, new Date())).toBeNull();
  });
});

describe('nextCronRuns', () => {
  it('enumerates N future runs', () => {
    const from = new Date('2026-07-15T00:00:00Z');
    const runs = nextCronRuns('0 9 * * *', 'UTC', 3, from);
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-07-15T09:00:00.000Z',
      '2026-07-16T09:00:00.000Z',
      '2026-07-17T09:00:00.000Z'
    ]);
  });

  it('returns empty for invalid or non-positive n', () => {
    expect(nextCronRuns('0 9 * * *', 'UTC', 0, new Date())).toEqual([]);
    expect(nextCronRuns('bad', 'UTC', 3, new Date())).toEqual([]);
  });
});

describe('describeCron', () => {
  it('paraphrases common shapes', () => {
    expect(describeCron('0 9 * * *')).toBe('daily at 09:00');
    expect(describeCron('0 9 * * 1-5')).toBe('weekdays at 09:00');
    expect(describeCron('30 17 * * 0,6')).toBe('weekends at 17:30');
    expect(describeCron('0 8 * * 1')).toBe('Mon at 08:00');
    expect(describeCron('0 8 1 * *')).toBe('day 1 at 08:00');
  });

  it('falls back to the raw expression for exotic patterns', () => {
    expect(describeCron('*/15 * * * *')).toBe('*/15 * * * *');
    expect(describeCron('0 9 * * 1-3')).toBe('0 9 * * 1-3');
    expect(describeCron('not five fields')).toBe('not five fields');
  });
});
