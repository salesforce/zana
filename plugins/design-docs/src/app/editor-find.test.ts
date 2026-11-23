import { describe, expect, it } from 'vitest';
import { findMatchOffsets, stepIndex } from './editor-find.js';

const SPECIALS = 'a.b a+b (x) [y] \\';

describe('findMatchOffsets', () => {
  it('matches case-insensitively and without overlap', () => {
    expect(findMatchOffsets('Foo foo FOO fofoo', 'foo')).toEqual([0, 4, 8, 14]);
    expect(findMatchOffsets('aaaa', 'aa')).toEqual([0, 2]);
  });

  it('returns nothing for an empty query or no match', () => {
    expect(findMatchOffsets('abc', '')).toEqual([]);
    expect(findMatchOffsets('abc', 'z')).toEqual([]);
  });

  it('treats regular-expression characters literally', () => {
    expect(findMatchOffsets(SPECIALS, '.')).toEqual([1]);
    expect(findMatchOffsets(SPECIALS, '(x)')).toEqual([8]);
    expect(findMatchOffsets(SPECIALS, '\\')).toEqual([16]);
  });

  it('keeps offsets valid for characters whose lower case differs in length', () => {
    expect(findMatchOffsets('İİ x', 'x')).toEqual([3]);
  });

  it('finds many matches', () => {
    expect(findMatchOffsets('ab'.repeat(5000), 'b')).toHaveLength(5000);
  });
});

describe('stepIndex', () => {
  it('wraps both ways and handles no matches', () => {
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(1, 1, 3)).toBe(2);
    expect(stepIndex(5, 1, 3)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});
