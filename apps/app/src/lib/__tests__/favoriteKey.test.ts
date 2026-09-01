import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  favoriteKey,
  isThreadFavoriteKey,
  mergeFavoritesFromMain,
  ptyFavoriteKeys,
  threadFavoriteKey
} from '../../store.js';

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

  it('namespaces conversation threads so they cannot collide with a PTY key', () => {
    expect(threadFavoriteKey('thr-1')).toBe('thread:thr-1');
    expect(favoriteKey({ id: 'thr-1', kind: 'thread' })).toBe('thread:thr-1');
    expect(favoriteKey({ id: 'thr-1', kind: 'thread', claudeSessionId: 'conv-abc' })).toBe(
      'thread:thr-1'
    );
    expect(isThreadFavoriteKey('thread:thr-1')).toBe(true);
    expect(isThreadFavoriteKey('conv-abc')).toBe(false);
  });

  it('strips thread keys from the set reported to auto-close-idle', () => {
    expect(ptyFavoriteKeys({ 'conv-abc': true, 'thread:thr-1': true, 'shell-1': true })).toEqual([
      'conv-abc',
      'shell-1'
    ]);
  });

  it('keeps thread follows when main echoes the PTY pin set', () => {
    const current = { 'conv-abc': true as const, 'thread:thr-1': true as const };
    expect(mergeFavoritesFromMain(current, ['conv-xyz'])).toEqual({
      'thread:thr-1': true,
      'conv-xyz': true
    });
    expect(mergeFavoritesFromMain(current, [])).toEqual({ 'thread:thr-1': true });
    expect(mergeFavoritesFromMain(current, ['thread:forged', 'conv-abc'])).toEqual({
      'thread:thr-1': true,
      'conv-abc': true
    });
  });

  it('App reports only PTY keys and merges main echoes without dropping threads', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('product.terminals.setFavorites(ptyFavoriteKeys(favoriteIds))');
    expect(app).toContain('mergeFavoritesFromMain(current, keys)');
  });
});
