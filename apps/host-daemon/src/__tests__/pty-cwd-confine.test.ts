import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 0.4 / Rule 2: PtyManager re-confines a LOCAL spawn cwd at the moment of spawn.
 * A path is only trusted after realpath-matching a REGISTERED project root, so a
 * symlink whose target escapes every root (e.g. a hand-edited project path that
 * links to `/`) must be REJECTED at spawn — the last chokepoint before
 * `pty.spawn`, catching direct core callers (scheduler/goal-manager) that pass a
 * raw `project.path`. When no roots supplier is injected (the historical unit
 * tests), the check is a no-op, so those tests are unaffected.
 *
 * `realpathSync` runs for real (not mocked), so we build real temp dirs +
 * symlinks; node-pty is mocked so no subprocess is launched.
 */

const spawned: Array<{ cwd: string }> = [];

vi.mock('node-pty', () => ({
  spawn: (_command: string, _args: string[], opts: { cwd: string }) => {
    spawned.push({ cwd: opts.cwd });
    return {
      pid: 5000 + spawned.length,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      kill() {}
    };
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

function cfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    version: 1,
    theme: 'dark',
    shell: '/bin/zsh',
    claudeBinary: 'claude',
    fontSize: 13,
    lastProjectId: null,
    ...over
  } as AppConfig;
}

describe('PtyManager — spawn-time cwd confinement (Rule 2 / 0.4)', () => {
  let root: string; // a registered project root
  let outside: string; // a dir OUTSIDE every root
  let ptys: PtyManager;

  beforeEach(async () => {
    spawned.length = 0;
    root = await mkdtemp(join(tmpdir(), 'cc-pty-root-'));
    outside = await mkdtemp(join(tmpdir(), 'cc-pty-outside-'));
    ptys = new PtyManager();
    // Inject the single registered root.
    ptys.setProjectRoots(() => [root]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('spawns when the cwd resolves inside a registered root', () => {
    const session = ptys.create({
      projectId: 'p1',
      profile: 'shell',
      cwd: root,
      cols: 80,
      rows: 24,
      config: cfg()
    });
    expect(session.status).toBe('running');
    expect(spawned).toHaveLength(1);
    expect(realpathSync(spawned[0].cwd)).toBe(realpathSync(root));
  });

  it('spawns when the cwd is a subdir of a registered root', async () => {
    const sub = join(root, 'nested');
    await mkdir(sub, { recursive: true });
    ptys.create({ projectId: 'p1', profile: 'shell', cwd: sub, cols: 80, rows: 24, config: cfg() });
    expect(spawned).toHaveLength(1);
  });

  it('REJECTS a symlink-escape cwd that resolves outside every root', async () => {
    // A "project path" that is actually a symlink pointing outside the root.
    const escapeLink = join(root, '..', 'cc-escape-link');
    await symlink(outside, escapeLink, 'dir');
    try {
      expect(() =>
        ptys.create({
          projectId: 'p1',
          profile: 'shell',
          cwd: escapeLink,
          cols: 80,
          rows: 24,
          config: cfg()
        })
      ).toThrow(/escapes every registered project root/);
      expect(spawned).toHaveLength(0);
    } finally {
      await rm(escapeLink, { force: true });
    }
  });

  it('REJECTS a cwd that does not resolve at all', () => {
    expect(() =>
      ptys.create({
        projectId: 'p1',
        profile: 'shell',
        cwd: join(outside, 'no', 'such', 'dir'),
        cols: 80,
        rows: 24,
        config: cfg()
      })
    ).toThrow(/does not resolve|escapes/);
    expect(spawned).toHaveLength(0);
  });

  it('is a NO-OP when no roots supplier is injected (unit-test default)', () => {
    const bare = new PtyManager();
    bare.create({ projectId: 'p1', profile: 'shell', cwd: outside, cols: 80, rows: 24, config: cfg() });
    expect(spawned).toHaveLength(1);
  });

  it('trusts a cwd under a SECOND injected root — the managed worktree root anchor', async () => {
    // Isolated worktrees live OUTSIDE the project root, under the app-managed
    // `~/zcc-worktrees` root, which index.ts adds as a second trust anchor. Model
    // it here: a supplier returning [projectRoot, worktreeRoot] must accept a cwd
    // under EITHER, and still reject one under neither.
    const wtRoot = await mkdtemp(join(tmpdir(), 'cc-pty-wtroot-'));
    const wt = join(wtRoot, 'proj', 'featx');
    await mkdir(wt, { recursive: true });
    try {
      const mgr = new PtyManager();
      mgr.setProjectRoots(() => [root, wtRoot]);
      mgr.create({ projectId: 'p1', profile: 'shell', cwd: wt, cols: 80, rows: 24, config: cfg() });
      expect(spawned).toHaveLength(1);
      expect(realpathSync(spawned[0].cwd)).toBe(realpathSync(wt));

      // A path under NEITHER root is still rejected.
      expect(() =>
        mgr.create({ projectId: 'p1', profile: 'shell', cwd: outside, cols: 80, rows: 24, config: cfg() })
      ).toThrow(/escapes every registered project root/);
      expect(spawned).toHaveLength(1);
    } finally {
      await rm(wtRoot, { recursive: true, force: true });
    }
  });
});
