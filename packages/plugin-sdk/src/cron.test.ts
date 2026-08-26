import { describe, expect, it } from 'vitest';
import { cronMatches, cronMinuteKey } from './cron.js';

describe('cronMatches', () => {
  it('treats a non-5-field expression as always matching', () => {
    expect(cronMatches('* * * *', new Date('2026-08-26T12:30:00Z'))).toBe(true);
  });

  it('matches wildcards, lists, and steps', () => {
    const noon = new Date(2026, 7, 26, 12, 0, 0);
    expect(cronMatches('* * * * *', noon)).toBe(true);
    expect(cronMatches('0 12 * * *', noon)).toBe(true);
    expect(cronMatches('0,30 12 * * *', noon)).toBe(true);
    expect(cronMatches('*/15 12 * * *', noon)).toBe(true);
    expect(cronMatches('5 12 * * *', noon)).toBe(false);
  });
});

describe('cronMinuteKey', () => {
  it('is unique per local minute', () => {
    const date = new Date(2026, 7, 26, 12, 4, 0);
    expect(cronMinuteKey(date)).toBe('2026-8-26T12:4');
  });
});
