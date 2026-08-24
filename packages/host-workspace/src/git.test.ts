import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceError } from './error.js';
import { readWorkspaceDiff, runGit } from './git.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function initRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'zcc-git-'));
  dirs.push(repo);
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.name', 'Test']);
  await runGit(repo, ['config', 'user.email', 'test@example.com']);
  await writeFile(join(repo, 'README.md'), 'hello\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, ['commit', '-m', 'init']);
  return repo;
}

describe('git buffer overflow', () => {
  it('throws when a command exceeds the cap', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'README.md'), `${'x'.repeat(8_000)}\n`);
    await expect(runGit(repo, ['diff', 'HEAD'], { maxBuffer: 64 })).rejects.toBeInstanceOf(WorkspaceError);
    await expect(runGit(repo, ['diff', 'HEAD'], { maxBuffer: 64 })).rejects.toThrow('buffer cap');
  });

  it('returns a truncated workspace diff instead of failing', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'README.md'), `${'x'.repeat(8_000)}\n`);
    const diff = await readWorkspaceDiff(repo, { type: 'uncommitted' }, 256);
    expect(diff.truncated).toBe(true);
    expect(diff.diff.length).toBeLessThanOrEqual(256);
    expect(diff.diff.length).toBeGreaterThan(0);
  });
});
