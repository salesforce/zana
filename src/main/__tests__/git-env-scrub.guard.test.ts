import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Regression guard for the git-env-leak bug: a test that ran `git init` /
 * `git commit` against a temp repo landed a tree-deleting "init" commit on the
 * OUTER repo when run under the pre-push hook, because git exports GIT_DIR /
 * GIT_INDEX_FILE / GIT_WORK_TREE into the hook env and those OVERRIDE an
 * explicit `cwd`. The fix is a global setup (vitest.setup.ts, wired via
 * `setupFiles`) that scrubs GIT_* from every worker's process.env — so NO test
 * file has to remember the guard.
 *
 * This guard deliberately uses the DANGEROUS naive pattern (spreading
 * `...process.env` into the git subprocess, no per-file scrub) to prove the
 * GLOBAL setup makes even that safe. If someone removes `setupFiles`, this test
 * commits to the outer repo and the assertions below fail.
 */
describe('global GIT_* scrub (setupFiles)', () => {
  it('leaves no GIT_* repo-context vars in the worker environment', () => {
    const leaked = Object.keys(process.env).filter((k) => k.startsWith('GIT_'));
    expect(leaked).toEqual([]);
  });

  it('a naive (unscrubbed) git test operates on its temp repo, never the outer repo', async () => {
    const repo = realpathSync(await mkdtemp(join(tmpdir(), 'cc-envguard-')));
    try {
      // NAIVE ON PURPOSE: spread process.env with no GIT_* filtering. Safe only
      // because the global setup already removed those vars.
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@example.com'
      };
      const run = (...args: string[]) => execFileP('git', args, { cwd: repo, env });
      await run('init', '-b', 'main');
      await writeFile(join(repo, 'f.txt'), 'x\n');
      await run('add', '.');
      await run('commit', '-m', 'init');

      // The commit must live in the TEMP repo. If GIT_DIR had leaked, the
      // repo's own log would be empty (the commit went to the outer repo).
      const { stdout } = await run('rev-parse', '--show-toplevel');
      expect(realpathSync(stdout.trim())).toBe(repo);
      const { stdout: count } = await run('rev-list', '--count', 'HEAD');
      expect(count.trim()).toBe('1');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
