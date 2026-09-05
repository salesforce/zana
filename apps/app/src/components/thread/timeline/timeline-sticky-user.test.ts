import { describe, expect, it } from 'vitest';
import { stickyTurnRanges } from './timeline-sticky-user.js';

describe('stickyTurnRanges', () => {
  it('returns no ranges when there is no user conversation row', () => {
    expect(stickyTurnRanges([])).toEqual([]);
    expect(stickyTurnRanges([
      { kind: 'system' },
      { kind: 'conversation', role: 'assistant' },
      { kind: 'work' }
    ])).toEqual([]);
  });

  it('wraps a single user prompt through the following work and assistant', () => {
    expect(stickyTurnRanges([
      { kind: 'conversation', role: 'user' },
      { kind: 'work' },
      { kind: 'conversation', role: 'assistant' }
    ])).toEqual([{ start: 0, end: 3 }]);
  });

  it('splits every user prompt into its own sticky range', () => {
    expect(stickyTurnRanges([
      { kind: 'system' },
      { kind: 'conversation', role: 'user' },
      { kind: 'conversation', role: 'assistant' },
      { kind: 'conversation', role: 'user' },
      { kind: 'work' },
      { kind: 'conversation', role: 'user' }
    ])).toEqual([
      { start: 1, end: 3 },
      { start: 3, end: 5 },
      { start: 5, end: 6 }
    ]);
  });

  it('counts a pending user prompt as a turn start', () => {
    expect(stickyTurnRanges([
      { kind: 'conversation', role: 'user' },
      { kind: 'conversation', role: 'assistant' },
      { kind: 'conversation', role: 'user' }
    ])).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 }
    ]);
  });
});
