import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import * as projectGit from '../git.js';
import {
  createWorktree,
  removeWorktree,
  setWorktreePushProtection
} from '../git.js';

/**
 * MT-3 step 1/4 automation: the squad-worktree push guard exercised through a
 * REAL `git push` against a REAL bare remote, both under os.tmpdir(). Nothing
 * here touches the zana checkout.
 */
const execFileP = promisify(execFile);
const BLOCKED = 'Zana blocked push from a managed squad worktree. Push stays blocked until the run ends. After the run, push zcc/<slug>, or declare the push capability in ## Launch.';

it('does not expose the retired push token API', () => {
  expect(projectGit).not.toHaveProperty('authorizeInstructWorktreePush');
  expect(projectGit).not.toHaveProperty('consumeInstructWorktreePushAuthorization');
});

const savedGitEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) {
      savedGitEnv[key] = process.env[key];
      delete process.env[key];
    }
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(savedGitEnv)) process.env[key] = value;
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
    expect(explicit.split('\n')[0]).toBe(BLOCKED);
    expect(explicit).not.toContain('Instruct-agent authorization');
    // push.default=nothing refuses an argument-less push before any network I/O.
    expect(await gitFails(wt, ['push'])).toMatch(/push\.default|didn't specify any refs|No configured push destination/i);
    expect(await gitFails(wt, ['push', 'origin', 'HEAD:refs/heads/other'])).toContain(BLOCKED);
    expect(await remoteHeads(remote)).toBe('main');
  });

  it('installs denial with inherited .git/hooks pointing through linked checkout gitfile', async () => {
    await git(main, ['config', 'core.hooksPath', '.git/hooks']);
    const wt = await guardedWorktree('gitfile-hooks');
    expect(await gitFails(wt, ['push', 'origin', 'zcc/gitfile-hooks'])).toContain(BLOCKED);
    expect(await remoteHeads(remote)).toBe('main');
    expect(await git(main, ['config', '--get', 'core.hooksPath'])).toBe('.git/hooks');
    await expect(setWorktreePushProtection(main, wt, true)).resolves.toEqual({ ok: true });
    await expect(setWorktreePushProtection(main, wt, false)).resolves.toEqual({ ok: true });
    await expect(setWorktreePushProtection(main, wt, true)).resolves.toEqual({ ok: true });
    expect(await gitFails(wt, ['push', 'origin', 'zcc/gitfile-hooks'])).toContain(BLOCKED);
  });

  it.each(['', 'x', 'isolated-e2e-fixture'])('denies pushes with legacy authorization env value %j', async (value) => {
    const wt = await guardedWorktree();
    expect(await gitFails(wt, ['push', 'origin', 'zcc/guarded'], {
      ZANA_INSTRUCT_WORKTREE_PUSH_AUTHORIZATION: value
    })).toContain(BLOCKED);
    expect(await remoteHeads(remote)).toBe('main');
    const stored = await readFile(join(await git(wt, ['config', '--worktree', '--get', 'core.hooksPath']), 'pre-push'), 'utf8');
    expect(stored).not.toContain('ZANA_INSTRUCT_WORKTREE_PUSH_AUTHORIZATION');
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
    expect(relative(join(main, '.git', 'worktrees'), hooksDir)).toMatch(/^[^/\\]+[/\\]zana-hooks$/u);
    // Guard output is generated, so deleting needs --force only for the dirty bits git sees (none here).
    const removed = await removeWorktree(main, wt, false);
    expect(removed.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(hooksDir)).toBe(false);
    // The branch stays; the main checkout is still usable and pushable.
    await git(main, ['push', 'origin', 'zcc/guarded']);
  });

  it('does not proxy directories or data files as executable hooks', async () => {
    const hooks = join(main, '.git', 'hooks');
    await mkdir(join(hooks, 'nested'));
    await writeFile(join(hooks, 'pre-receive'), 'not a hook script\n');
    const wt = await guardedWorktree();
    const guardDir = await git(wt, ['config', '--worktree', '--get', 'core.hooksPath']);
    expect(existsSync(join(guardDir, 'nested'))).toBe(false);
    expect(existsSync(join(guardDir, 'pre-receive'))).toBe(false);
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

    it('restores the user hook veto after push protection is removed', async () => {
      await installUserPrePush(1);
      const wt = await guardedWorktree();
      expect(await gitFails(wt, ['push', 'origin', 'zcc/guarded'])).toContain(BLOCKED);
      await expect(readFile(log, 'utf8')).rejects.toBeDefined();
      await expect(setWorktreePushProtection(main, wt, false)).resolves.toEqual({ ok: true });
      await expect(execFileP('git', ['push', 'origin', 'zcc/guarded'], { cwd: wt, env: cleanGitEnv() })).rejects.toBeDefined();
      expect(await readFile(log, 'utf8')).toContain('user-hook origin');
      expect(await remoteHeads(remote)).toBe('main');
    });

    it('runs the user hook after push protection is removed and lets the push through when it passes', async () => {
      await installUserPrePush(0);
      const wt = await guardedWorktree();
      // Active protection blocks before the user hook runs.
      expect(await gitFails(wt, ['push', 'origin', 'zcc/guarded'])).toContain(BLOCKED);
      await expect(readFile(log, 'utf8')).rejects.toBeDefined();
      await expect(setWorktreePushProtection(main, wt, false)).resolves.toEqual({ ok: true });
      await git(wt, ['push', 'origin', 'zcc/guarded']);
      expect(await readFile(log, 'utf8')).toContain('user-hook origin');
      expect(await remoteHeads(remote)).toBe('main\nzcc/guarded');
      // Main checkout configuration is untouched by guard install and uninstall.
      await setWorktreePushProtection(main, wt, false);
      expect(await git(main, ['config', '--get', 'core.hooksPath'])).toBe(hooks);
    });
  });
});
