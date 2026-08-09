import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  listWorktrees,
  listBranches,
  gitCommonDir,
  createWorktree,
  removeWorktree,
  worktreeState,
  isGitRepo,
  parseWorktreePorcelain,
  sanitizeBranchSlug
} from '../git.js';

const execFileP = promisify(execFile);

// Purge inherited git repo-context vars from this worker's process.env once,
// up front. When the suite runs under a git hook (e.g. this repo's pre-push
// hook, which invokes `npm test`), git exports GIT_DIR / GIT_INDEX_FILE /
// GIT_WORK_TREE / GIT_COMMON_DIR / GIT_PREFIX into the environment. Both this
// file's own git subprocesses AND the production code under test (git.ts,
// which spawns git with the inherited env) would then operate on the OUTER
// repo instead of each test's temp repo — making commits/reads fail or read
// the wrong repo. Vitest isolates each test file in its own child process
// (forks pool, isolate:true), so scrubbing here can't affect other files.
beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) delete process.env[key];
  }
});

// A clean environment for git subprocesses: inherit everything EXCEPT the
// `GIT_*` repo-context vars, then pin a deterministic identity. Git exports
// GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE / GIT_COMMON_DIR / GIT_PREFIX into
// the environment of any hook it runs (e.g. this repo's pre-push hook, which
// runs the test suite). If those leak into these subprocesses they redirect
// git at the OUTER repo instead of the per-test temp repo — so `git commit`
// fails with "index file open failed" / "Not a directory". Stripping them
// makes the test behave identically whether run standalone or under a hook.
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_')) env[k] = v;
  }
  env.GIT_AUTHOR_NAME = 'T';
  env.GIT_AUTHOR_EMAIL = 't@example.com';
  env.GIT_COMMITTER_NAME = 'T';
  env.GIT_COMMITTER_EMAIL = 't@example.com';
  return env;
}

// Run a git command in `cwd`, with deterministic identity/branch config so the
// test doesn't depend on the host's global git config (or an inherited hook env).
async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileP('git', args, { cwd, env: cleanGitEnv() });
}

describe('git worktree support', () => {
  let base: string;
  let main: string;

  beforeEach(async () => {
    base = realpathSync(await mkdtemp(join(tmpdir(), 'cc-wt-')));
    main = join(base, 'repo');
    await git(base, 'init', '-b', 'main', 'repo');
    await writeFile(join(main, 'README.md'), '# hi\n');
    await git(main, 'add', '.');
    await git(main, 'commit', '-m', 'init');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('lists the main checkout as the sole, isMain worktree', async () => {
    const trees = await listWorktrees(main);
    expect(trees).toHaveLength(1);
    expect(trees[0].isMain).toBe(true);
    expect(trees[0].path).toBe(realpathSync(main));
    expect(trees[0].branch).toBe('main');
    expect(trees[0].detached).toBe(false);
  });

  it('parses NUL-delimited paths containing newlines without splitting records', () => {
    const path = join(base, 'line\nbreak');
    const trees = parseWorktreePorcelain(
      `worktree ${path}\0HEAD abc123\0branch refs/heads/main\0\0`
    );
    expect(trees).toHaveLength(1);
    expect(trees[0].path).toBe(path);
    expect(trees[0].branch).toBe('main');
  });

  it('enumerates a linked worktree with its own branch, main flagged isMain', async () => {
    const wtPath = join(base, 'feature');
    await git(main, 'worktree', 'add', '-b', 'featureX', wtPath);

    const trees = await listWorktrees(main);
    expect(trees).toHaveLength(2);

    const mainEntry = trees.find((t) => t.isMain);
    const linked = trees.find((t) => !t.isMain);
    expect(mainEntry?.branch).toBe('main');
    expect(linked).toBeDefined();
    expect(linked!.path).toBe(realpathSync(wtPath));
    expect(linked!.branch).toBe('featureX');

    // Listing from inside the worktree yields the same set (order may differ).
    const fromWt = await listWorktrees(wtPath);
    expect(fromWt.map((t) => t.path).sort()).toEqual(trees.map((t) => t.path).sort());
  });

  it('marks a detached worktree as detached with a null branch', async () => {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: main, env: cleanGitEnv() });
    const sha = stdout.trim();
    const wtPath = join(base, 'detached');
    await git(main, 'worktree', 'add', '--detach', wtPath, sha);

    const linked = (await listWorktrees(main)).find((t) => !t.isMain);
    expect(linked?.detached).toBe(true);
    expect(linked?.branch).toBeNull();
    expect(linked?.head).toBe(sha);
  });

  it('gitCommonDir matches across a repo and its worktree (the trust-anchor test)', async () => {
    const wtPath = join(base, 'feature');
    await git(main, 'worktree', 'add', '-b', 'featureX', wtPath);

    const mainCommon = await gitCommonDir(main);
    const wtCommon = await gitCommonDir(wtPath);
    expect(mainCommon).not.toBeNull();
    expect(wtCommon).toBe(mainCommon);
  });

  it('gitCommonDir differs across unrelated repos', async () => {
    const other = join(base, 'other');
    await git(base, 'init', '-b', 'main', 'other');
    const a = await gitCommonDir(main);
    const b = await gitCommonDir(other);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it('returns [] / null for a non-repo directory', async () => {
    const plain = realpathSync(await mkdtemp(join(tmpdir(), 'cc-norepo-')));
    try {
      expect(await listWorktrees(plain)).toEqual([]);
      expect(await gitCommonDir(plain)).toBeNull();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it('rejects relative / empty paths defensively', async () => {
    expect(await listWorktrees('')).toEqual([]);
    expect(await listWorktrees('relative/path')).toEqual([]);
    expect(await gitCommonDir('')).toBeNull();
    expect(await gitCommonDir('relative/path')).toBeNull();
  });

  describe('listBranches', () => {
    it('lists the sole branch, flagged current, for a fresh repo', async () => {
      const branches = await listBranches(main);
      expect(branches).toHaveLength(1);
      expect(branches[0].name).toBe('main');
      expect(branches[0].current).toBe(true);
    });

    it('lists every local branch — including ones with no worktree — and marks current', async () => {
      // A branch with a worktree, plus a branch that only exists as a ref.
      await git(main, 'worktree', 'add', '-b', 'featureX', join(base, 'feature'));
      await git(main, 'branch', 'orphan');

      const branches = await listBranches(main);
      const names = branches.map((b) => b.name).sort();
      expect(names).toEqual(['featureX', 'main', 'orphan']);

      // Only the branch checked out in `main` is current when listing from main.
      expect(branches.find((b) => b.name === 'main')?.current).toBe(true);
      expect(branches.find((b) => b.name === 'featureX')?.current).toBe(false);
      expect(branches.find((b) => b.name === 'orphan')?.current).toBe(false);
    });

    it('returns [] for a non-repo and for relative / empty paths', async () => {
      const plain = realpathSync(await mkdtemp(join(tmpdir(), 'cc-norepo-br-')));
      try {
        expect(await listBranches(plain)).toEqual([]);
      } finally {
        await rm(plain, { recursive: true, force: true });
      }
      expect(await listBranches('')).toEqual([]);
      expect(await listBranches('relative/path')).toEqual([]);
    });
  });

  describe('isGitRepo', () => {
    it('is true inside a repo (and its linked worktree), false outside', async () => {
      expect(await isGitRepo(main)).toBe(true);
      const wtPath = join(base, 'feature');
      await git(main, 'worktree', 'add', '-b', 'featureX', wtPath);
      expect(await isGitRepo(realpathSync(wtPath))).toBe(true);

      const plain = realpathSync(await mkdtemp(join(tmpdir(), 'cc-norepo-isrepo-')));
      try {
        expect(await isGitRepo(plain)).toBe(false);
      } finally {
        await rm(plain, { recursive: true, force: true });
      }
    });

    it('rejects relative / empty paths defensively', async () => {
      expect(await isGitRepo('')).toBe(false);
      expect(await isGitRepo('relative/path')).toBe(false);
    });
  });

  describe('sanitizeBranchSlug', () => {
    it('lowercases, single-segments, and strips git-illegal characters', () => {
      expect(sanitizeBranchSlug('Fix the Login Bug')).toBe('fix_the_login_bug');
      expect(sanitizeBranchSlug('Fix login / OAuth!')).toBe('fix_login_oauth');
      // Path separators collapse to a single segment (no nested refs).
      expect(sanitizeBranchSlug('feat/foo/bar')).not.toContain('/');
      // Leading/trailing punctuation trimmed; internal runs collapsed.
      const slug = sanitizeBranchSlug('  --weird__name!!  ');
      expect(slug).toBeTruthy();
      expect(slug!.startsWith('-')).toBe(false);
      expect(slug!.endsWith('-')).toBe(false);
    });

    it('returns null for empty / unusable input', () => {
      expect(sanitizeBranchSlug('')).toBeNull();
      expect(sanitizeBranchSlug(undefined)).toBeNull();
      expect(sanitizeBranchSlug('   ')).toBeNull();
      expect(sanitizeBranchSlug('///')).toBeNull();
    });
  });

  describe('createWorktree', () => {
    it('mints a fresh branch + checkout under the target dir', async () => {
      const target = join(base, 'wt', 'featx');
      const res = await createWorktree(main, target, 'zcc/featx');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.reused).toBe(false);
      expect(res.branch).toBe('zcc/featx');
      expect(res.path).toBe(realpathSync(target));

      const linked = (await listWorktrees(main)).find((t) => !t.isMain);
      expect(linked?.branch).toBe('zcc/featx');
    });

    it('adopts an existing checkout for the same branch (reused: true), idempotent', async () => {
      const target = join(base, 'wt', 'again');
      const first = await createWorktree(main, target, 'zcc/again');
      expect(first.ok).toBe(true);

      // Second call for the same branch adopts the existing checkout rather than
      // failing (git refuses one branch in two worktrees).
      const second = await createWorktree(main, target, 'zcc/again');
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.reused).toBe(true);
      if (first.ok) expect(second.path).toBe(first.path);
    });

    it('serializes simultaneous allocation of the same named worktree', async () => {
      const target = join(base, 'wt', 'parallel');
      const [first, second] = await Promise.all([
        createWorktree(main, target, 'zcc/parallel'),
        createWorktree(main, target, 'zcc/parallel')
      ]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.path).toBe(second.path);
      expect([first.reused, second.reused].sort()).toEqual([false, true]);
    });

    it('checks out an EXISTING branch into a new dir (not -b)', async () => {
      await git(main, 'branch', 'preexisting');
      const target = join(base, 'wt', 'pre');
      const res = await createWorktree(main, target, 'preexisting');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.reused).toBe(false);
      expect(res.branch).toBe('preexisting');
    });

    it('fails cleanly for a non-repo / invalid path (never throws)', async () => {
      const plain = realpathSync(await mkdtemp(join(tmpdir(), 'cc-norepo-cw-')));
      try {
        const res = await createWorktree(plain, join(plain, 'wt'), 'zcc/x');
        expect(res.ok).toBe(false);
      } finally {
        await rm(plain, { recursive: true, force: true });
      }
      const rel = await createWorktree('relative', 'also-relative', 'zcc/x');
      expect(rel.ok).toBe(false);
    });

    it('fails closed when the repository declares submodules', async () => {
      await writeFile(join(main, '.gitmodules'), '[submodule "lib"]\n\tpath = lib\n\turl = ../lib\n');
      const res = await createWorktree(main, join(base, 'wt', 'submodules'), 'zcc/submodules');
      expect(res).toEqual({
        ok: false,
        reason: 'repositories with submodules are not supported for managed worktrees'
      });
    });

    it('allows an empty historical .gitmodules file', async () => {
      await writeFile(join(main, '.gitmodules'), '# no active submodules\n');
      const res = await createWorktree(main, join(base, 'wt', 'empty-submodules'), 'zcc/empty_submodules');
      expect(res.ok).toBe(true);
    });

    it('rejects reusing a matching branch checked out outside its managed destination', async () => {
      const outside = join(base, 'outside');
      await git(main, 'worktree', 'add', '-b', 'zcc/outside', outside);
      const res = await createWorktree(main, join(base, 'wt', 'outside'), 'zcc/outside');
      expect(res).toEqual({
        ok: false,
        reason: 'branch is checked out outside its managed destination'
      });
    });
  });

  describe('worktreeState + removeWorktree', () => {
    it('reports a fresh, empty worktree as prunable and removes it without --force', async () => {
      const target = join(base, 'wt', 'clean');
      const res = await createWorktree(main, target, 'zcc/clean');
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const state = await worktreeState(res.path);
      expect(state.dirty).toBe(false);
      expect(state.commits).toBe(0);
      expect(state.prunable).toBe(true);

      const removed = await removeWorktree(main, res.path, false);
      expect(removed.ok).toBe(true);
      expect((await listWorktrees(main)).some((t) => t.path === res.path)).toBe(false);
    });

    it('reports a dirty worktree as NOT prunable', async () => {
      const target = join(base, 'wt', 'dirty');
      const res = await createWorktree(main, target, 'zcc/dirty');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      await writeFile(join(res.path, 'scratch.txt'), 'uncommitted\n');

      const state = await worktreeState(res.path);
      expect(state.dirty).toBe(true);
      expect(state.prunable).toBe(false);
    });

    it('reports a worktree with unique commits as NOT prunable', async () => {
      const target = join(base, 'wt', 'committed');
      const res = await createWorktree(main, target, 'zcc/committed');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      await writeFile(join(res.path, 'feature.txt'), 'work\n');
      await git(res.path, 'add', '.');
      await git(res.path, 'commit', '-m', 'agent work');

      const state = await worktreeState(res.path);
      expect(state.dirty).toBe(false);
      expect(state.commits).toBeGreaterThan(0);
      expect(state.prunable).toBe(false);
    });

    it('worktreeState is conservative (keep) for a non-worktree / bad path', async () => {
      expect(await worktreeState('')).toEqual({ dirty: true, commits: 0, prunable: false });
      expect(await worktreeState('relative/path')).toEqual({
        dirty: true,
        commits: 0,
        prunable: false
      });
    });
  });
});
