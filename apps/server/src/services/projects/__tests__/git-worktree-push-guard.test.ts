import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  authorizeInstructWorktreePush,
  consumeInstructWorktreePushAuthorization,
  createWorktree,
  removeWorktree,
  setWorktreePushProtection
} from '../git.js';

/**
 * MT-3 step 1/4 automation: the squad-worktree push guard exercised through a
 * REAL `git push` against a REAL bare remote, both under os.tmpdir(). Nothing
 * here touches the zana checkout. (The shipped guard message is "Zana blocked
 * push from managed squad worktree. Request one-time Instruct-agent
 * authorization, then retry." — the older manual-test wording differs.)
 */
const execFileP = promisify(execFile);
const BLOCKED = 'Zana blocked push from managed squad worktree';

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) delete process.env[key];
  }
});

function cleanGitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return {
    ...env,
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_TERMINAL_PROMPT: '0',
    ...extra
  };
}

async function git(cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd, env: cleanGitEnv(extra) });
  return stdout.trim();
}

/** Resolves to the failure's stderr, or throws if git unexpectedly succeeded. */
async function gitFails(cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    await execFileP('git', args, { cwd, env: cleanGitEnv(extra) });
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? '');
  }
  throw new Error(`expected git ${args.join(' ')} to fail`);
}

async function remoteHeads(remote: string): Promise<string> {
  return git(remote, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
}

describe('squad worktree push guard against a real git remote', () => {
  let base: string;
  let main: string;
  let remote: string;

  beforeEach(async () => {
    base = realpathSync(await mkdtemp(join(tmpdir(), 'zcc-push-guard-')));
    main = join(base, 'repo');
    remote = join(base, 'remote.git');
    await git(base, ['init', '--bare', '-b', 'main', remote]);
    await git(base, ['init', '-b', 'main', main]);
    await writeFile(join(main, 'README.md'), '# hi\n');
    await git(main, ['add', '.']);
    await git(main, ['commit', '-m', 'init']);
    await git(main, ['remote', 'add', 'origin', remote]);
    await git(main, ['push', 'origin', 'main']);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function guardedWorktree(name = 'guarded'): Promise<string> {
    const res = await createWorktree(main, join(base, 'wt', name), `zcc/${name}`, undefined, true);
    if (!res.ok) throw new Error(`createWorktree failed: ${res.reason}`);
    await writeFile(join(res.path, `${name}.txt`), `${name}\n`);
    await git(res.path, ['add', '.']);
    await git(res.path, ['commit', '-m', `work ${name}`]);
    return res.path;
  }

  it('blocks an explicit push and a bare push from the guarded worktree; remote stays unchanged', async () => {
    const wt = await guardedWorktree();
    const explicit = await gitFails(wt, ['push', 'origin', 'zcc/guarded']);
    expect(explicit).toContain(BLOCKED);
    expect(explicit).toContain('Instruct-agent authorization');
    // push.default=nothing refuses an argument-less push before any network I/O.
    expect(await gitFails(wt, ['push'])).toMatch(/push\.default|didn't specify any refs|No configured push destination/i);
    expect(await gitFails(wt, ['push', 'origin', 'HEAD:refs/heads/other'])).toContain(BLOCKED);
    expect(await remoteHeads(remote)).toBe('main');
  });

  it('allows a push carrying a one-time authorization token, then blocks again', async () => {
    const wt = await guardedWorktree();
    const token = authorizeInstructWorktreePush();
    const env = consumeInstructWorktreePushAuthorization(token);
    expect(env).toEqual({ ZANA_INSTRUCT_WORKTREE_PUSH_AUTHORIZATION: token });
    expect(consumeInstructWorktreePushAuthorization(token)).toBeUndefined();
    await git(wt, ['push', 'origin', 'zcc/guarded'], env);
    expect(await remoteHeads(remote)).toBe('main\nzcc/guarded');

    // Authorization lived only in that process env; nothing persisted in the worktree.
    await writeFile(join(wt, 'more.txt'), 'more\n');
    await git(wt, ['add', '.']);
    await git(wt, ['commit', '-m', 'more']);
    expect(await gitFails(wt, ['push', 'origin', 'zcc/guarded'])).toContain(BLOCKED);
    const stored = await readFile(join(await git(wt, ['config', '--worktree', '--get', 'core.hooksPath']), 'pre-push'), 'utf8');
    expect(stored).not.toContain(token);
  });

  it('rejects a forged or replayed token value that was never issued', async () => {
    const wt = await guardedWorktree();
    expect(consumeInstructWorktreePushAuthorization('not-issued')).toBeUndefined();
    // The shell guard is only a safety rail: any non-empty env value passes it.
    // Authorization is minted/consumed in-process; this documents that boundary.
    await git(wt, ['push', 'origin', 'zcc/guarded'], { ZANA_INSTRUCT_WORKTREE_PUSH_AUTHORIZATION: 'x' });
    expect(await remoteHeads(remote)).toContain('zcc/guarded');
  });

  it('does not leak guard config or hooks into the main checkout or an unguarded worktree', async () => {
    const wt = await guardedWorktree();
    await expect(git(main, ['config', '--get', 'core.hooksPath'])).rejects.toBeDefined();
    const mainPushDefault = await git(main, ['config', '--get', 'push.default']).catch(() => '');
    expect(mainPushDefault).not.toBe('nothing');
    expect(existsSync(join(main, '.git', 'zana-hooks'))).toBe(false);
    expect(await git(wt, ['config', '--worktree', '--get', 'push.default'])).toBe('nothing');

    // Main checkout pushes freely.
    await writeFile(join(main, 'main.txt'), 'main\n');
    await git(main, ['add', '.']);
    await git(main, ['commit', '-m', 'main work']);
    await git(main, ['push', 'origin', 'main']);
    await git(main, ['push', '-u', 'origin', 'main']);
    await git(main, ['push']);

    // A sibling worktree created WITHOUT protection also pushes freely.
    const plain = await createWorktree(main, join(base, 'wt', 'plain'), 'zcc/plain');
    if (!plain.ok) throw new Error(plain.reason);
    await writeFile(join(plain.path, 'p.txt'), 'p\n');
    await git(plain.path, ['add', '.']);
    await git(plain.path, ['commit', '-m', 'plain']);
    await git(plain.path, ['push', 'origin', 'zcc/plain']);
    expect(await remoteHeads(remote)).toBe('main\nzcc/plain');
  });

  it('uninstall restores normal pushes and reinstall re-blocks without chaining onto itself', async () => {
    const wt = await guardedWorktree();
    expect(await gitFails(wt, ['push', 'origin', 'zcc/guarded'])).toContain(BLOCKED);

    await expect(setWorktreePushProtection(main, wt, false)).resolves.toEqual({ ok: true });
    await expect(git(wt, ['config', '--worktree', '--get', 'core.hooksPath'])).rejects.toBeDefined();
    await git(wt, ['push', 'origin', 'zcc/guarded']);
    expect(await remoteHeads(remote)).toBe('main\nzcc/guarded');
    // Uninstall is idempotent.
    await expect(setWorktreePushProtection(main, wt, false)).resolves.toEqual({ ok: true });

    await writeFile(join(wt, 'again.txt'), 'again\n');
    await git(wt, ['add', '.']);
    await git(wt, ['commit', '-m', 'again']);
    await expect(setWorktreePushProtection(main, wt, true)).resolves.toEqual({ ok: true });
    await expect(setWorktreePushProtection(main, wt, true)).resolves.toEqual({ ok: true });
    const hooksDir = await git(wt, ['config', '--worktree', '--get', 'core.hooksPath']);
    const hook = await readFile(join(hooksDir, 'pre-push'), 'utf8');
    expect(hook).not.toContain(hooksDir);
    expect(await gitFails(wt, ['push', 'origin', 'zcc/guarded'])).toContain(BLOCKED);
  });

  it('refuses to toggle protection on the main checkout, relative paths, or a non-worktree', async () => {
    await expect(setWorktreePushProtection(main, main, true)).resolves.toMatchObject({ ok: false, reason: 'not a linked worktree in project' });
    await expect(setWorktreePushProtection(main, 'relative/path', true)).resolves.toEqual({ ok: false, reason: 'invalid path' });
    await expect(setWorktreePushProtection(join(base, 'not-a-repo'), join(base, 'wt'), true)).resolves.toMatchObject({ ok: false });
    await expect(git(main, ['config', '--worktree', '--get', 'push.default'])).rejects.toBeDefined();
  });

  it('removes the guard hooks with the worktree (cleanup leaves no stray state)', async () => {
    const wt = await guardedWorktree();
    const hooksDir = await git(wt, ['config', '--worktree', '--get', 'core.hooksPath']);
    expect(existsSync(join(hooksDir, 'pre-push'))).toBe(true);
    expect(hooksDir.startsWith(join(main, '.git', 'worktrees'))).toBe(true);
    // Guard output is generated, so deleting needs --force only for the dirty bits git sees (none here).
    const removed = await removeWorktree(main, wt, false);
    expect(removed.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(hooksDir)).toBe(false);
    // The branch stays; the main checkout is still usable and pushable.
    await git(main, ['push', 'origin', 'zcc/guarded']);
  });

  describe('with a pre-existing core.hooksPath pre-push hook in the main checkout', () => {
    let hooks: string;
    let log: string;

    beforeEach(async () => {
      hooks = join(base, 'user-hooks');
      log = join(base, 'hook.log');
      await mkdir(hooks);
      await git(main, ['config', 'core.hooksPath', hooks]);
    });

    async function installUserPrePush(exitCode: number): Promise<void> {
      const file = join(hooks, 'pre-push');
      await writeFile(file, `#!/bin/sh\necho "user-hook $1" >> '${log}'\nexit ${exitCode}\n`);
      await chmod(file, 0o700);
    }

    it('chains an authorized push into the user hook, which can still veto', async () => {
      await installUserPrePush(1);
      const wt = await guardedWorktree();
      const env = consumeInstructWorktreePushAuthorization(authorizeInstructWorktreePush());
      await expect(execFileP('git', ['push', 'origin', 'zcc/guarded'], { cwd: wt, env: cleanGitEnv(env) })).rejects.toBeDefined();
      expect(await readFile(log, 'utf8')).toContain('user-hook origin');
      expect(await remoteHeads(remote)).toBe('main');
    });

    it('runs the user hook after authorization and lets the push through when it passes', async () => {
      await installUserPrePush(0);
      const wt = await guardedWorktree();
      // Unauthorized: the guard blocks first, so the user hook never runs.
      expect(await gitFails(wt, ['push', 'origin', 'zcc/guarded'])).toContain(BLOCKED);
      await expect(readFile(log, 'utf8')).rejects.toBeDefined();
      const env = consumeInstructWorktreePushAuthorization(authorizeInstructWorktreePush());
      await git(wt, ['push', 'origin', 'zcc/guarded'], env);
      expect(await readFile(log, 'utf8')).toContain('user-hook origin');
      expect(await remoteHeads(remote)).toBe('main\nzcc/guarded');
      // Main checkout configuration is untouched by guard install and uninstall.
      await setWorktreePushProtection(main, wt, false);
      expect(await git(main, ['config', '--get', 'core.hooksPath'])).toBe(hooks);
    });
  });
});
