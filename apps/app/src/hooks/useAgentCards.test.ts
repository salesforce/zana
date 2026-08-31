import { describe, expect, it } from 'vitest';
import { liveFavoriteCount } from './useAgentCards.js';

describe('liveFavoriteCount', () => {
  it('counts starred live CLI cards and visible threads together', () => {
    expect(
      liveFavoriteCount(
        { 'conv-abc': true, 'thread:thr-1': true, 'thread:gone': true },
        [{ session: { id: 'pty-1', claudeSessionId: 'conv-abc' } }, { session: { id: 'pty-2' } }],
        ['thr-1']
      )
    ).toBe(2);
  });

  it('ignores persisted stars whose CLI agent or thread is not live', () => {
    expect(
      liveFavoriteCount({ 'conv-abc': true, 'thread:thr-1': true }, [], [])
    ).toBe(0);
  });
});
