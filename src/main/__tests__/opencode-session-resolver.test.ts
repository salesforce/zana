/**
 * OpenCodeSessionResolver tests. Injects a fake `runList` (no real `opencode`
 * subprocess spawns) and verifies the detect-not-mint heuristic: match a
 * session row by (directory, created ≥ spawn) and cache the result per key.
 */

import { describe, it, expect } from 'vitest';
import { OpenCodeSessionResolver } from '../opencode-session-resolver.js';

function fakeRunList(rows: Array<{ id: string; created: number; directory: string }>) {
  return async (_cwd: string, _limit: number) => rows;
}

describe('OpenCodeSessionResolver', () => {
  it('matches a session row by directory and returns its minted id', async () => {
    const cwd = '/Users/me/project-a';
    const resolver = new OpenCodeSessionResolver({
      runList: fakeRunList([{ id: 'ses_abc123', created: 1_000_000, directory: cwd }])
    });

    const match = await resolver.resolve('sess-1', cwd, 999_000);
    expect(match).toEqual({ sessionId: 'ses_abc123' });
  });

  it('does not match a row in a different directory', async () => {
    const resolver = new OpenCodeSessionResolver({
      runList: fakeRunList([{ id: 'ses_abc123', created: 1_000_000, directory: '/Users/me/project-a' }])
    });

    const match = await resolver.resolve('sess-1', '/Users/me/OTHER', 999_000);
    expect(match).toBeNull();
  });

  it('does not match a row created before the spawn floor', async () => {
    const cwd = '/Users/me/project-a';
    const resolver = new OpenCodeSessionResolver({
      // Created well before spawn (beyond the 5s clock-skew slack).
      runList: fakeRunList([{ id: 'ses_old', created: 900_000, directory: cwd }])
    });

    const match = await resolver.resolve('sess-1', cwd, 1_000_000);
    expect(match).toBeNull();
  });

  it('picks the EARLIEST-created match among candidates in the same cwd', async () => {
    const cwd = '/Users/me/project-a';
    const resolver = new OpenCodeSessionResolver({
      runList: fakeRunList([
        { id: 'ses_later', created: 1_010_000, directory: cwd },
        { id: 'ses_earliest', created: 1_000_000, directory: cwd }
      ])
    });

    const match = await resolver.resolve('sess-1', cwd, 999_000);
    expect(match).toEqual({ sessionId: 'ses_earliest' });
  });

  it('does not assign one OpenCode session row to sibling PTYs in the same cwd', async () => {
    const cwd = '/Users/me/project-a';
    const resolver = new OpenCodeSessionResolver({
      runList: fakeRunList([
        { id: 'ses_second', created: 1_001_000, directory: cwd },
        { id: 'ses_first', created: 1_000_000, directory: cwd }
      ])
    });

    expect(await resolver.resolve('pty-first', cwd, 999_000)).toEqual({ sessionId: 'ses_first' });
    expect(await resolver.resolve('pty-second', cwd, 999_000)).toEqual({ sessionId: 'ses_second' });
    resolver.forget('pty-first');
    expect(await resolver.resolve('pty-third', cwd, 999_000)).toEqual({ sessionId: 'ses_first' });
  });

  it('caches a successful match (per key) and exposes forget()', async () => {
    const cwd = '/Users/me/project-a';
    let calls = 0;
    const resolver = new OpenCodeSessionResolver({
      runList: async () => {
        calls++;
        return [{ id: 'ses_abc123', created: 1_000_000, directory: cwd }];
      }
    });

    await resolver.resolve('sess-1', cwd, 999_000);
    expect(resolver.size).toBe(1);
    await resolver.resolve('sess-1', cwd, 999_000);
    expect(calls).toBe(1); // second call hit the cache, no re-list

    resolver.forget('sess-1');
    expect(resolver.size).toBe(0);
  });

  it('returns null (uncached) when no row exists yet, then matches once it appears', async () => {
    const cwd = '/Users/me/project-a';
    let rows: Array<{ id: string; created: number; directory: string }> = [];
    const resolver = new OpenCodeSessionResolver({
      runList: async () => rows
    });

    expect(await resolver.resolve('sess-1', cwd, 999_000)).toBeNull();
    expect(resolver.size).toBe(0); // negative result NOT cached

    rows = [{ id: 'ses_abc123', created: 1_000_000, directory: cwd }];
    const match = await resolver.resolve('sess-1', cwd, 999_000);
    expect(match?.sessionId).toBe('ses_abc123');
  });

  it('never throws when the subprocess call fails', async () => {
    const resolver = new OpenCodeSessionResolver({
      runList: async () => null
    });
    expect(await resolver.resolve('sess-1', '/x', 0)).toBeNull();
  });
});
