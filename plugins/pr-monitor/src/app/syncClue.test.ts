import { describe, it, expect } from 'vitest';
import { deriveSyncClue } from './syncClue.js';
import { EMPTY_SYNC_HEALTH, type SyncHealth } from '../../lib/types.js';

/**
 * The single-clue precedence (AC-REPO-13.5): disconnect > remote-gone > outage,
 * one affordance, kept-gone never a clue of its own.
 */
function health(over: Partial<SyncHealth>): SyncHealth {
  return { ...EMPTY_SYNC_HEALTH, ...over };
}

describe('deriveSyncClue', () => {
  it('healthy → no clue', () => {
    expect(deriveSyncClue(EMPTY_SYNC_HEALTH)).toBeNull();
    expect(deriveSyncClue(null)).toBeNull();
    expect(deriveSyncClue(undefined)).toBeNull();
  });

  it('AC-REPO-13.5: disconnect wins over remote-gone and outage', () => {
    const clue = deriveSyncClue(
      health({ disconnectedHosts: ['git.soma'], remoteGone: ['a/b'], outageHosts: ['github.com'] })
    );
    expect(clue?.kind).toBe('disconnect');
    expect(clue?.action).toBe('settings');
    expect(clue?.subjects).toEqual(['git.soma']);
  });

  it('remote-gone wins over outage', () => {
    const clue = deriveSyncClue(health({ remoteGone: ['a/b'], outageHosts: ['github.com'] }));
    expect(clue?.kind).toBe('remote-gone');
    expect(clue?.action).toBe('resolve');
    expect(clue?.subjects).toEqual(['a/b']);
  });

  it('outage alone → informational, no action', () => {
    const clue = deriveSyncClue(health({ outageHosts: ['github.com'] }));
    expect(clue?.kind).toBe('outage');
    expect(clue?.action).toBe('none');
  });

  it('kept-gone alone is NOT a clue (AC-REPO-16.4 — already decided)', () => {
    expect(deriveSyncClue(health({ keptGone: ['a/b'] }))).toBeNull();
  });

  it('pluralizes disconnect host list', () => {
    const one = deriveSyncClue(health({ disconnectedHosts: ['github.com'] }));
    expect(one?.message).toContain('github.com');
    const two = deriveSyncClue(health({ disconnectedHosts: ['github.com', 'git.soma'] }));
    expect(two?.message).toContain('github.com and git.soma');
  });

  it('pluralizes remote-gone count', () => {
    expect(deriveSyncClue(health({ remoteGone: ['a/b'] }))?.message).toContain('1 repository is');
    expect(deriveSyncClue(health({ remoteGone: ['a/b', 'c/d'] }))?.message).toContain(
      '2 repositories are'
    );
  });
});
