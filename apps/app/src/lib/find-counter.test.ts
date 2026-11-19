import { describe, expect, it } from 'vitest';
import { THREAD_SEARCH_PARTIAL_NOTE, threadSearchAnnouncement, threadSearchCounterText } from './find-counter.js';

describe('find counter text', () => {
  it('shows position over count, 0/0 without matches, and + for a partial count', () => {
    expect(threadSearchCounterText(2, 7)).toBe('3/7');
    expect(threadSearchCounterText(-1, 0)).toBe('0/0');
    expect(threadSearchCounterText(0, 4, true)).toBe('1/4+');
  });

  it('announces the match, the total before a first match, and no matches', () => {
    expect(threadSearchAnnouncement(1, 3)).toBe('Match 2 of 3');
    expect(threadSearchAnnouncement(-1, 1)).toBe('1 match');
    expect(threadSearchAnnouncement(-1, 5)).toBe('5 matches');
    expect(threadSearchAnnouncement(0, 0)).toBe('No matches');
    expect(threadSearchAnnouncement(0, 2, true)).toBe(`Match 1 of 2. ${THREAD_SEARCH_PARTIAL_NOTE}`);
  });
});
