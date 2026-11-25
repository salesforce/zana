import { describe, expect, it } from 'vitest';
import { trimTrailingSlashes } from './trim-slashes.js';

function* allStrings(alphabet: string, maxLength: number): Generator<string> {
  let layer = [''];
  yield '';
  for (let n = 1; n <= maxLength; n += 1) {
    const next: string[] = [];
    for (const prefix of layer) for (const ch of alphabet) next.push(prefix + ch);
    yield* next;
    layer = next;
  }
}

describe('trimTrailingSlashes', () => {
  it('strips only trailing slashes', () => {
    expect(trimTrailingSlashes('http://x/')).toBe('http://x');
    expect(trimTrailingSlashes('http://x///')).toBe('http://x');
    expect(trimTrailingSlashes('http://x')).toBe('http://x');
    expect(trimTrailingSlashes('/a//b')).toBe('/a//b');
    expect(trimTrailingSlashes('///')).toBe('');
    expect(trimTrailingSlashes('')).toBe('');
  });

  it('matches the regex it replaced on every short string', () => {
    const mismatches: string[] = [];
    for (const input of allStrings('a/b', 7)) {
      if (trimTrailingSlashes(input) !== input.replace(/\/+$/, '')) mismatches.push(input);
    }
    expect(mismatches).toEqual([]);
  });

  it('is linear on a long run of slashes followed by a non-slash', () => {
    // The old regex restarted at every slash: quadratic on this shape.
    const input = `${'/'.repeat(200_000)}x`;
    const start = performance.now();
    expect(trimTrailingSlashes(input)).toBe(input);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});
