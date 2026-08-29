import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { commitProjectChanges, previewProjectCommit, pushProjectBranch } from '../git.js';

const execFileP = promisify(execFile);

describe('Git workflow primitives', () => {
  let repo: string;
  let remote: string;

  const git = (cwd: string, ...args: string[]) => execFileP('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    }
  });

  const commit = async (cwd: string, message: string) => {
    const preview = await previewProjectCommit(cwd, 'project', 'preview', Date.now() + 60_000);
    expect(preview).not.toBeNull();
    return commitProjectChanges(cwd, message, preview!);
  };

  beforeEach(async () => {
    repo = realpathSync(await mkdtemp(join(tmpdir(), 'zcc-git-')));
    remote = realpathSync(await mkdtemp(join(tmpdir(), 'zcc-git-remote-')));
    await git(repo, 'init', '-b', 'main');
    // The implementation invokes git without test-only environment overrides.
    // Keep the fixture self-contained instead of depending on a developer's
    // global Git identity.
    await git(repo, 'config', 'user.name', 'Test');
    await git(repo, 'config', 'user.email', 'test@example.com');
    await writeFile(join(repo, 'file.txt'), 'one\n');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'initial');
  });

  afterEach(async () => {
    await Promise.all([
      rm(repo, { recursive: true, force: true }),
      rm(remote, { recursive: true, force: true })
    ]);
  });

  it('commits the complete project state with a literal message', async () => {
    await writeFile(join(repo, 'file.txt'), 'two\n');
    const message = 'fix: keep $(touch PWNED) literal';
    const result = await commit(repo, message);
    expect(result.ok).toBe(true);
    const { stdout } = await git(repo, 'log', '-1', '--pretty=%s');
    expect(stdout.trim()).toBe(message);
    expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('two\n');
  });

  it('rejects an empty message and a nested cwd', async () => {
    await writeFile(join(repo, 'file.txt'), 'two\n');
    expect(await commit(repo, '   ')).toMatchObject({ ok: false });
    const nested = join(repo, 'nested');
    await mkdir(nested);
    const preview = await previewProjectCommit(repo, 'project', 'preview', Date.now() + 60_000);
    expect(preview).not.toBeNull();
    expect(await commitProjectChanges(nested, 'bad scope', preview!)).toMatchObject({
      ok: false,
      message: 'Project root must match the repository root.'
    });
  });

  it('pushes only through the configured upstream', async () => {
    await git(remote, 'init', '--bare');
    await git(repo, 'remote', 'add', 'origin', remote);
    await git(repo, 'push', '-u', 'origin', 'main');
    await writeFile(join(repo, 'file.txt'), 'two\n');
    expect((await commit(repo, 'update file')).ok).toBe(true);
    const result = await pushProjectBranch(repo);
    expect(result).toMatchObject({ ok: true, branch: 'main' });
    const { stdout } = await git(remote, 'log', '-1', '--pretty=%s', 'refs/heads/main');
    expect(stdout.trim()).toBe('update file');
  });

  it('fails closed when no upstream is configured', async () => {
    const result = await pushProjectBranch(repo);
    expect(result).toMatchObject({ ok: false, branch: 'main' });
    expect(result.message).toContain('has no upstream');
  });
});
