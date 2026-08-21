/**
 * OpenCodeSessionResolver tests. Injects a fake `runList` (no real `opencode`
 * subprocess spawns) and verifies the detect-not-mint heuristic: match a
 * session row by (directory, created ≥ spawn) and cache the result per key.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeSessionResolver } from '../session-resolver.js';

function fakeRunList(rows: Array<{ id: string; created: number; directory: string }>) {
  return async (_cwd: string, _limit: number) => rows;
}

const identityRealpath = async (path: string) => path;

describe('OpenCodeSessionResolver', () => {
  it('matches a session row by directory and returns its minted id', async () => {
    const cwd = '/Users/me/project-a';
    const resolver = new OpenCodeSessionResolver({
      runList: fakeRunList([{ id: 'ses_abc123', created: 1_000_000, directory: cwd }]),
      realpath: identityRealpath
    });

    const match = await resolver.resolve('sess-1', cwd, 999_000);
    expect(match).toEqual({ sessionId: 'ses_abc123' });
  });

  it('matches a session row whose directory is the realpath of the spawned cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zcc-opencode-resolver-'));
    const alias = `${root}-alias`;
    try {
      await symlink(root, alias, 'dir');
      const canonical = await realpath(root);
      const resolver = new OpenCodeSessionResolver({
        runList: fakeRunList([{ id: 'ses_abc123', created: 1_000_000, directory: canonical }])
      });

      await expect(resolver.resolve('sess-1', alias, 999_000)).resolves.toEqual({ sessionId: 'ses_abc123' });
    } finally {
      await rm(alias, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not match a row in a different directory', async () => {
    const resolver = new OpenCodeSessionResolver({
      runList: fakeRunList([{ id: 'ses_abc123', created: 1_000_000, directory: '/Users/me/project-a' }]),
      realpath: identityRealpath
    });

    const match = await resolver.resolve('sess-1', '/Users/me/OTHER', 999_000);
    expect(match).toBeNull();
  });

  it('does not match a row created before the spawn floor', async () => {
    const cwd = '/Users/me/project-a';
    const resolver = new OpenCodeSessionResolver({
      // Created well before spawn (beyond the 5s clock-skew slack).
      runList: fakeRunList([{ id: 'ses_old', created: 900_000, directory: cwd }]),
      realpath: identityRealpath
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
      ]),
      realpath: identityRealpath
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
      ]),
      realpath: identityRealpath
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
      },
      realpath: identityRealpath
    });

    await resolver.resolve('sess-1', cwd, 999_000);
    expect(resolver.size).toBe(1);
    await resolver.resolve('sess-1', cwd, 999_000);
    expect(calls).toBe(1); // second call hit the cache, no re-list

    resolver.forget('sess-1');
    expect(resolver.size).toBe(0);
  });

  it('shares an in-flight lookup for the same PTY', async () => {
    const cwd = '/Users/me/project-a';
    let calls = 0;
    let release!: (rows: Array<{ id: string; created: number; directory: string }>) => void;
    const resolver = new OpenCodeSessionResolver({
      runList: () => new Promise((resolve) => {
        calls++;
        release = resolve;
      }),
      realpath: identityRealpath
    });

    const first = resolver.resolve('sess-1', cwd, 999_000);
    const second = resolver.resolve('sess-1', cwd, 999_000);
    await Promise.resolve();
    expect(calls).toBe(1);
    release([{ id: 'ses_abc123', created: 1_000_000, directory: cwd }]);
    await expect(first).resolves.toEqual({ sessionId: 'ses_abc123' });
    await expect(second).resolves.toEqual({ sessionId: 'ses_abc123' });
  });

  it('returns null (uncached) when no row exists yet, then matches once it appears', async () => {
    const cwd = '/Users/me/project-a';
    let rows: Array<{ id: string; created: number; directory: string }> = [];
    const resolver = new OpenCodeSessionResolver({
      runList: async () => rows,
      realpath: identityRealpath
    });

    expect(await resolver.resolve('sess-1', cwd, 999_000)).toBeNull();
    expect(resolver.size).toBe(0); // negative result NOT cached

    rows = [{ id: 'ses_abc123', created: 1_000_000, directory: cwd }];
    const match = await resolver.resolve('sess-1', cwd, 999_000);
    expect(match?.sessionId).toBe('ses_abc123');
  });

  it('never throws when the subprocess call fails', async () => {
    const resolver = new OpenCodeSessionResolver({
      runList: async () => null,
      realpath: identityRealpath
    });
    expect(await resolver.resolve('sess-1', '/x', 0)).toBeNull();
  });
});
