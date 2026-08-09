import { describe, it, expect } from 'vitest';
import { favoriteKey } from '../../store';

describe('favoriteKey', () => {
  it('prefers the stable claudeSessionId so a star survives restart', () => {
    // A restored agent gets a NEW session.id but resumes the SAME claudeSessionId
    // (--resume <id>), so keying on claudeSessionId keeps the two equal.
    const before = favoriteKey({ id: 'pty-uuid-1', claudeSessionId: 'conv-abc' });
    const afterRestart = favoriteKey({ id: 'pty-uuid-2-DIFFERENT', claudeSessionId: 'conv-abc' });
    expect(before).toBe('conv-abc');
    expect(afterRestart).toBe(before); // reattaches across restart
  });

  it('falls back to session.id for a non-claude agent (no claudeSessionId)', () => {
    expect(favoriteKey({ id: 'shell-1' })).toBe('shell-1');
  });
});
