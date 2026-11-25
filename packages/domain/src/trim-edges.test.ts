import { describe, expect, it } from 'vitest';
import { LINEAR_TIME_BUDGET_MS, allStrings } from './linear-time-testing.js';
import { trimChar, trimLeadingChar, trimTrailingAny, trimTrailingChar } from './trim-edges.js';

describe('trim-edges', () => {
  it('matches the regexes it replaces on every short string', () => {
    for (const value of allStrings('-a/', 8)) {
      expect(trimLeadingChar(value, '-')).toBe(value.replace(/^-+/, ''));
      expect(trimTrailingChar(value, '-')).toBe(value.replace(/-+$/, ''));
      expect(trimChar(value, '-')).toBe(value.replace(/^-+|-+$/g, ''));
      expect(trimTrailingChar(value, '/')).toBe(value.replace(/\/+$/u, ''));
    }
  });

  it('returns the input unchanged when there is nothing to trim', () => {
    expect(trimChar('abc', '-')).toBe('abc');
    expect(trimChar('', '-')).toBe('');
    expect(trimChar('---', '-')).toBe('');
  });

  it('stays linear on a long run followed by another character', () => {
    // "-----…-x": the old trailing alternative restarted at every dash.
    const run = '-'.repeat(200_000);
    const started = performance.now();
    expect(trimChar(`${run}x`, '-')).toBe('x');
    expect(trimTrailingChar(`x${run}y`, '-')).toBe(`x${run}y`);
    expect(trimTrailingChar(`${'/'.repeat(200_000)}x`, '/')).toBe(`${'/'.repeat(200_000)}x`);
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});

describe('trimTrailingAny', () => {
  it('strips a trailing run of any listed character', () => {
    expect(trimTrailingAny('C:\\\\/', '\\/')).toBe('C:');
    expect(trimTrailingAny('abc', '\\/')).toBe('abc');
    expect(trimTrailingAny('//', '\\/')).toBe('');
    expect(trimTrailingAny('', '\\/')).toBe('');
    expect(trimTrailingAny('a/b', '\\/')).toBe('a/b');
  });

  it('is linear on a long run of listed characters followed by another one', () => {
    const input = `${'/\\'.repeat(100_000)}x`;
    const started = performance.now();
    expect(trimTrailingAny(input, '\\/')).toBe(input);
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});
