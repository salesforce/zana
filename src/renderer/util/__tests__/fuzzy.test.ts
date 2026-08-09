import { describe, it, expect } from 'vitest';
import { fuzzyScore } from '../fuzzy.js';

describe('fuzzyScore', () => {
  it('returns a zero-score empty match for an empty query', () => {
    expect(fuzzyScore('anything', '')).toEqual({ score: 0, matchIdx: [] });
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('open settings', 'xyz')).toBeNull();
    expect(fuzzyScore('abc', 'abcd')).toBeNull(); // longer than text
  });

  it('records the matched character indices', () => {
    const m = fuzzyScore('Open Settings', 'ops');
    expect(m).not.toBeNull();
    // o(0) p(1) ... s — first 'o','p' consecutive, then the 'S' of Settings.
    expect(m!.matchIdx[0]).toBe(0);
    expect(m!.matchIdx).toContain(1);
  });

  it('rewards consecutive matches over scattered ones', () => {
    const consecutive = fuzzyScore('claude', 'cla')!.score;
    const scattered = fuzzyScore('cellular-a', 'cla')!.score;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('rewards a match right after a separator', () => {
    const afterSep = fuzzyScore('new-shell', 's')!.score;   // 's' after '-'
    const midWord = fuzzyScore('assets', 's')!.score;        // 's' mid-word
    expect(afterSep).toBeGreaterThan(midWord);
  });

  it('rewards a camel-hump transition', () => {
    const camel = fuzzyScore('openSettings', 's')!.score;    // lower→upper at 'S'
    const plain = fuzzyScore('opensettings', 's')!.score;
    expect(camel).toBeGreaterThan(plain);
  });

  it('rewards a match at the start of the basename over a leading-dir match', () => {
    // Each string has exactly one 'p' so the scorer can't pick an earlier one.
    const base = fuzzyScore('src/lib/parse.ts', 'p')!.score;     // 'p' starts basename
    const nonBase = fuzzyScore('parse/lib/x.ts', 'p')!.score;     // 'p' starts a leading dir
    expect(base).toBeGreaterThan(nonBase);
  });

  it('applies a small length penalty so shorter equal matches win', () => {
    const short = fuzzyScore('cat', 'cat')!.score;
    const long = fuzzyScore('cat in the hat', 'cat')!.score;
    expect(short).toBeGreaterThan(long);
  });
});
