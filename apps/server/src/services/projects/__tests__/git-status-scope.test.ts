import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getGitStatus } from '../git.js';
import type { GitStatus } from '@zana-ai/zcc-domain/product';

const execFileP = promisify(execFile);

// See git-worktree.test.ts / install-from-git.e2e.test.ts: purge inherited
// GIT_* repo-context vars once, up front. When this suite runs under this
// repo's pre-push hook (which invokes `npm test`), git exports GIT_DIR /
// GIT_INDEX_FILE / GIT_WORK_TREE / GIT_COMMON_DIR / GIT_PREFIX into the
// environment. Those OVERRIDE an explicit `cwd`, so this file's `git init` /
// `git commit` would operate on the OUTER repo instead of the per-test temp
// repo — landing a stray `init` commit on the branch being pushed. Vitest
// isolates each test file in its own child process, so scrubbing here can't
// affect other files.
beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) delete process.env[key];
  }
});

/** `GitStatus.files` is optional in the type; normalize for assertions. */
function filesOf(status: GitStatus | null): Record<string, string> {
  expect(status).not.toBeNull();
  return status!.files ?? {};
}

// Inherit everything EXCEPT the GIT_* repo-context vars, then pin a
// deterministic identity — the same guard the other git suites use so this
// file behaves identically standalone and under the pre-push hook.
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

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileP('git', args, { cwd, env: cleanGitEnv() });
}

/**
 * Regression coverage for the "Changes panel shows nothing" bug: git's default
 * untracked handling COLLAPSES a directory of new files into a single `?? dir/`
 * entry, so the renderer's write-set intersection dropped every file the agent
 * CREATED. Passing the write-set as a pathspec scope forces git to enumerate
 * each new file individually. See `getGitStatus` doc comment.
 */
describe('getGitStatus write-set scoping', () => {
  let repo: string;

  beforeEach(async () => {
    repo = realpathSync(await mkdtemp(join(tmpdir(), 'cc-status-')));
    await git(repo, 'init', '-b', 'main');
    await writeFile(join(repo, 'tracked.txt'), 'v1\n');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'init');
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('enumerates NEW files under a fresh dir individually when scoped (the bug)', async () => {
    // A directory of brand-new untracked files — exactly what git collapses.
    const newDir = join(repo, 'created', 'nested');
    await mkdir(newDir, { recursive: true });
    const a = join(newDir, 'a.js');
    const b = join(newDir, 'b.js');
    await writeFile(a, 'a\n');
    await writeFile(b, 'b\n');

    // Unscoped: git collapses to the top untracked dir — the individual files
    // are NOT keys in `files`, which is the root of the intersection bug.
    const unscoped = filesOf(await getGitStatus(repo));
    expect(Object.keys(unscoped)).not.toContain(a);
    expect(Object.keys(unscoped)).not.toContain(b);

    // Scoped to the write-set: each new file appears individually as Untracked.
    const scoped = filesOf(await getGitStatus(repo, [a, b]));
    expect(scoped[a]).toBe('?');
    expect(scoped[b]).toBe('?');
  });

  it('reports a scoped modified tracked file', async () => {
    const tracked = join(repo, 'tracked.txt');
    await writeFile(tracked, 'v2\n');
    const scoped = filesOf(await getGitStatus(repo, [tracked]));
    expect(scoped[tracked]).toBe('M');
  });

  it('drops out-of-repo scope paths instead of fatal-aborting the whole status', async () => {
    const tracked = join(repo, 'tracked.txt');
    await writeFile(tracked, 'v2\n');
    // An out-of-repo path in the write-set (e.g. an agent that also wrote to
    // ~/.claude/.../memory/) would make `git status -- <path>` fatal and abort
    // the entire read. It must be confined out, leaving the in-repo file.
    const outside = join(tmpdir(), 'definitely-not-in-repo', 'x.md');
    const scoped = filesOf(await getGitStatus(repo, [tracked, outside]));
    expect(scoped[tracked]).toBe('M');
    expect(Object.keys(scoped)).not.toContain(outside);
  });

  it('returns an empty file set (not a full-tree read) when scope is entirely out-of-repo', async () => {
    // A dirty repo, but the write-set touches nothing here → no files, and we
    // must NOT fall back to the whole dirty tree.
    await writeFile(join(repo, 'tracked.txt'), 'v2\n');
    const outside = join(tmpdir(), 'elsewhere', 'y.md');
    const status = await getGitStatus(repo, [outside]);
    expect(status).not.toBeNull();
    expect(Object.keys(status!.files ?? {})).toHaveLength(0);
    expect(status!.branch).toBe('main');
  });

  it('respects .gitignore even when an ignored file is named in the scope', async () => {
    await writeFile(join(repo, '.gitignore'), '*.log\n');
    await git(repo, 'add', '.gitignore');
    await git(repo, 'commit', '-m', 'ignore logs');
    const ignored = join(repo, 'debug.log');
    await writeFile(ignored, 'noise\n');
    const scoped = filesOf(await getGitStatus(repo, [ignored]));
    expect(Object.keys(scoped)).not.toContain(ignored);
  });

  it('null/undefined scope reads the full tree (shell-session fallback)', async () => {
    const newFile = join(repo, 'x.txt');
    await writeFile(newFile, 'x\n');
    const full = filesOf(await getGitStatus(repo, null));
    expect(full[newFile]).toBe('?');
  });
});
