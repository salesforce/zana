import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const gitCalls = vi.hoisted(() => [] as Array<{ args: readonly string[]; options: Record<string, unknown> }>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (command: string, args: readonly string[], options: Record<string, unknown>, callback: never) => {
      if (command === 'git') gitCalls.push({ args, options });
      return actual.execFile(command, args, options, callback);
    }
  };
});

const git = await import('../git.js');
const { execFileSync } = await import('node:child_process');

// Every git call from the server runs under Electron (a GUI process), so on
// Windows each one needs windowsHide or it opens a visible console window.
describe('server git calls hide their console window', () => {
  let base: string;
  let repo: string;
  const run = (...args: string[]) => execFileSync('git', args, {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' }
  });

  beforeAll(async () => {
    base = realpathSync(await mkdtemp(join(tmpdir(), 'zcc-git-hide-')));
    repo = join(base, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    await writeFile(join(repo, 'a.txt'), 'one\n');
    run('add', '.');
    run('commit', '-q', '-m', 'init');
  });
  afterAll(async () => { await rm(base, { recursive: true, force: true }); });

  it('passes windowsHide on every read, worktree and mutation call', async () => {
    expect(await git.isGitRepo(repo)).toBe(true);
    expect(await git.getRecentCommits(repo)).toHaveLength(1);
    expect(await git.gitCommonDir(repo)).not.toBeNull();
    expect((await git.listBranches(repo)).map((b) => b.name)).toContain('main');
    expect(await git.listWorktrees(repo)).toHaveLength(1);

    const target = join(base, 'wt');
    expect((await git.createWorktree(repo, target, 'zcc/hide', undefined, true)).ok).toBe(true);
    expect((await git.worktreeState(target)).commits).toBe(0);

    await writeFile(join(repo, 'a.txt'), 'two\n');
    expect((await git.showHead(join(repo, 'a.txt'))).ok).toBe(true);
    expect((await git.discardChanges(join(repo, 'a.txt'))).ok).toBe(true);

    await writeFile(join(repo, 'b.txt'), 'new\n');
    const preview = await git.previewProjectCommit(repo, 'project', 'preview', Date.now() + 60_000);
    expect(preview).not.toBeNull();
    run('config', 'user.name', 'T');
    run('config', 'user.email', 't@example.com');
    expect((await git.commitProjectChanges(repo, 'add b', preview!)).ok).toBe(true);

    const subcommands = new Set(gitCalls.map((call) => call.args.find((arg) => !arg.startsWith('-'))));
    for (const sub of ['status', 'log', 'rev-parse', 'for-each-ref', 'worktree', 'show-ref', 'config', 'rev-list', 'show', 'checkout', 'add', 'commit']) {
      expect(subcommands).toContain(sub);
    }
    expect(gitCalls.filter((call) => call.options.windowsHide !== true)).toEqual([]);
  });
});
