import { describe, expect, it } from 'vitest';
import { ACTIVE_USE_MAX, ACTIVE_USE_WINDOW_MS, PeerActiveUse } from './peer-active-use.js';

describe('PeerActiveUse', () => {
  it('counts a plugin active for the 10 s window after a successful call, per computer', () => {
    let now = 0;
    const active = new PeerActiveUse(() => now);
    expect(ACTIVE_USE_WINDOW_MS).toBe(10_000);
    expect(active.isActive('p', 'c')).toBe(false);
    active.recordSuccess('p', 'c');
    now = 9_000;
    expect(active.isActive('p', 'c')).toBe(true);
    expect(active.isActive('p', 'other')).toBe(false);
    expect(active.activePlugins('c')).toEqual(['p']);
    now = 10_000;
    expect(active.isActive('p', 'c')).toBe(false);
    now = 11_000;
    expect(active.activePlugins('c')).toEqual([]);
  });

  it('a newer call renews the window and orders plugins by their last call', () => {
    let now = 0;
    const active = new PeerActiveUse(() => now);
    active.recordSuccess('a', 'c');
    now = 1_000; active.recordSuccess('b', 'c');
    now = 2_000; active.recordSuccess('a', 'c');
    expect(active.activePlugins('c')).toEqual(['b', 'a']);
    now = 11_500;
    expect(active.activePlugins('c')).toEqual(['a']);
  });

  it('forgets one use or a whole computer', () => {
    const active = new PeerActiveUse(() => 0);
    active.recordSuccess('a', 'c'); active.recordSuccess('b', 'c'); active.recordSuccess('a', 'd');
    active.forgetUse('a', 'c');
    expect(active.activePlugins('c')).toEqual(['b']);
    active.forget('c');
    expect(active.activePlugins('c')).toEqual([]);
    expect(active.activePlugins('d')).toEqual(['a']);
  });

  it('keeps at most ACTIVE_USE_MAX pairs, dropping the oldest', () => {
    const active = new PeerActiveUse();
    for (let i = 0; i <= ACTIVE_USE_MAX; i++) active.recordSuccess(`p${i}`, 'c');
    expect(active.isActive('p0', 'c')).toBe(false);
    expect(active.isActive(`p${ACTIVE_USE_MAX}`, 'c')).toBe(true);
    expect(active.activePlugins('c')).toHaveLength(ACTIVE_USE_MAX);
  });
});
