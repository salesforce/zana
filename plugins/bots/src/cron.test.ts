import { expect, it } from 'vitest';
import { cronMatches, nextRoutineRun } from './cron.js';

const at = (h: number, m: number, weekday = 1) => new Date(2026, 10, 15 + weekday, h, m); // 2026-11-16 is a Monday

it('matches stars, lists and steps', () => {
  expect(cronMatches('* * * * *', at(3, 7))).toBe(true);
  expect(cronMatches('0 8 * * 1,2,3,4,5', at(8, 0, 1))).toBe(true);
  expect(cronMatches('0 8 * * 1,2,3,4,5', at(8, 0, 6))).toBe(false);
  expect(cronMatches('0 8 * * 1', at(8, 1))).toBe(false);
  expect(cronMatches('*/15 * * * *', at(1, 30))).toBe(true);
  expect(cronMatches('*/15 * * * *', at(1, 31))).toBe(false);
  expect(cronMatches('5/10 * * * *', at(1, 25))).toBe(true);
  expect(cronMatches('5/10 * * * *', at(1, 3))).toBe(false);
  expect(cronMatches('0 0 16 11 *', new Date(2026, 10, 16, 0, 0))).toBe(true);
});

it('rejects malformed expressions', () => {
  expect(cronMatches('* * * *', at(1, 1))).toBe(false);
  expect(cronMatches('*/0 * * * *', at(1, 0))).toBe(false);
  expect(cronMatches('x/5 * * * *', at(1, 0))).toBe(false);
  expect(cronMatches('abc * * * *', at(1, 0))).toBe(false);
});

it('forecasts the next matching host minute strictly after the current one', () => {
  expect(nextRoutineRun('0 9 * * 1,2,3,4,5', at(9, 0, 5).getTime())).toBe(at(9, 0, 8).getTime());
  expect(nextRoutineRun('5/10 * * * *', at(8, 5).getTime())).toBe(at(8, 15).getTime());
  expect(nextRoutineRun('0 0 29 2 *', new Date(2026, 0, 1).getTime())).toBe(new Date(2028, 1, 29).getTime());
  expect(nextRoutineRun('0 0 30 2 *', Date.now())).toBeNull();
  expect(nextRoutineRun('61 * * * *', Date.now())).toBeNull();
  expect(nextRoutineRun('bad', Date.now())).toBeNull();
});
