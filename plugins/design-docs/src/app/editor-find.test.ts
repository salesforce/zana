import { describe, expect, it } from 'vitest';
import { findMatchOffsets, highlightSegments, MAX_PAINTED_MATCHES, PAINT_WINDOW_CHARS, stepIndex } from './editor-find.js';

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

describe('highlightSegments', () => {
  it('splits the text into plain and highlighted runs that rebuild it exactly', () => {
    const text = 'a beta b Beta c';
    const segments = highlightSegments(text, findMatchOffsets(text, 'beta'), 4, 1);
    expect(segments).toEqual([{ text: 'a ' }, { text: 'beta', hit: 'match' }, { text: ' b ' }, { text: 'Beta', hit: 'current' }, { text: ' c' }]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('returns the text unchanged when there is no current match', () => {
    expect(highlightSegments('abc', [], 2, -1)).toEqual([{ text: 'abc' }]);
    expect(highlightSegments('abc', [0], 0, 0)).toEqual([{ text: 'abc' }]);
  });

  it('paints only matches near the current one, capped, and still returns all the text', () => {
    const text = 'e'.repeat(PAINT_WINDOW_CHARS * 3);
    const offsets = findMatchOffsets(text, 'e');
    const segments = highlightSegments(text, offsets, 1, 0);
    expect(segments.filter((segment) => segment.hit)).toHaveLength(MAX_PAINTED_MATCHES);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    const far = highlightSegments('x'.repeat(PAINT_WINDOW_CHARS * 2) + 'zz', findMatchOffsets('zz' + 'x'.repeat(PAINT_WINDOW_CHARS * 2) + 'zz', 'zz'), 2, 0);
    expect(far.filter((segment) => segment.hit)).toHaveLength(1);
  });
});
