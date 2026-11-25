import { describe, expect, it } from 'vitest';
import { trimChar, trimLeadingChar, trimTrailingChar } from './trim-edges.js';

/** Every string over a small alphabet up to `maxLength`, including "". */
function* strings(alphabet: string, maxLength: number): Generator<string> {
  let layer = [''];
  yield '';
  for (let length = 1; length <= maxLength; length += 1) {
    const next: string[] = [];
    for (const prefix of layer) {
      for (const ch of alphabet) next.push(prefix + ch);
    }
    yield* next;
    layer = next;
  }
}

describe('trim-edges', () => {
  it('matches the regexes it replaces on every short string', () => {
    for (const value of strings('-a/', 8)) {
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
    expect(trimChar(`${run}x`, '-')).toBe('x'.padStart(1, 'x'));
    expect(trimTrailingChar(`x${run}y`, '-')).toBe(`x${run}y`);
    expect(trimTrailingChar(`${'/'.repeat(200_000)}x`, '/')).toBe(`${'/'.repeat(200_000)}x`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
