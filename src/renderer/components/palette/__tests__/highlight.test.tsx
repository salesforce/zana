import { describe, it, expect } from 'vitest';
import { isValidElement } from 'react';
import { highlightMatches } from '../highlight.js';

// highlightMatches returns either the raw string (no matches) or an array of
// string segments and <mark> elements. We assert on that structure without a
// DOM by inspecting the returned React nodes.

function marks(node: ReturnType<typeof highlightMatches>): string[] {
  if (!Array.isArray(node)) return [];
  return node
    .filter((n) => isValidElement(n))
    .map((n) => (n as { props: { children: string } }).props.children);
}

describe('highlightMatches', () => {
  it('returns the plain string when there are no matches', () => {
    expect(highlightMatches('settings', [])).toBe('settings');
  });

  it('wraps a single matched char in a <mark>', () => {
    const out = highlightMatches('abc', [1]);
    expect(marks(out)).toEqual(['b']);
  });

  it('coalesces a contiguous run of matches into one <mark>', () => {
    const out = highlightMatches('claude', [0, 1, 2]);
    expect(marks(out)).toEqual(['cla']);
  });

  it('handles a match at index 0 and a trailing match', () => {
    const out = highlightMatches('abcd', [0, 3]);
    expect(marks(out)).toEqual(['a', 'd']);
  });

  it('handles an all-match string', () => {
    const out = highlightMatches('go', [0, 1]);
    expect(marks(out)).toEqual(['go']);
  });
});
