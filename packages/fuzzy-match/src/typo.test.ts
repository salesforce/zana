import { describe, expect, it } from 'vitest';
import { typoDistance, typoMaxEdits } from './typo.js';

describe('typoMaxEdits', () => {
  it('budgets 0 edits under 4 chars, 1 for 4 to 7, 2 for 8 and longer', () => {
    expect([1, 3, 4, 7, 8, 20].map(typoMaxEdits)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('typoDistance', () => {
  it('is 0 for equal strings and the other length for an empty one', () => {
    expect(typoDistance('tmux', 'tmux', 2)).toBe(0);
    expect(typoDistance('', 'abc', 5)).toBe(3);
    expect(typoDistance('abc', '', 5)).toBe(3);
  });

  it('counts one insertion, deletion, substitution or adjacent swap as a single edit', () => {
    expect(typoDistance('tmux', 'tmuxx', 2)).toBe(1); // insertion
    expect(typoDistance('tmux', 'tmx', 2)).toBe(1); // deletion
    expect(typoDistance('tmux', 'tmax', 2)).toBe(1); // substitution
    expect(typoDistance('tmxu', 'tmux', 2)).toBe(1); // transposition (optimal string alignment)
    expect(typoDistance('heartbaet', 'heartbeat', 2)).toBe(1);
  });

  it('exits early above the budget, reporting max + 1', () => {
    expect(typoDistance('abcdef', 'uvwxyz', 1)).toBe(2);
    expect(typoDistance('short', 'muchlongerword', 2)).toBe(3); // length gap alone exceeds the budget
  });
});
