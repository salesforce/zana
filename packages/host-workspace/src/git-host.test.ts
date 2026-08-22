import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceError } from './error.js';
import { runGit } from './git.js';
import { getPullRequestForCurrentBranch, runPullRequestAction } from './git-host.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function initRepo(): Promise<string> {
  const repo = await tempDir('zcc-gh-repo-');
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.name', 'Test']);
  await runGit(repo, ['config', 'user.email', 'test@example.com']);
  await writeFile(join(repo, 'README.md'), 'hello\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, ['commit', '-m', 'init']);
  return repo;
}

async function withPath<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = dir;
  try {
    return await run();
  } finally {
    process.env.PATH = previous;
  }
}

async function fakeGh(script: string): Promise<string> {
  const dir = await tempDir('zcc-fake-gh-');
  const path = join(dir, 'gh');
  await writeFile(path, script);
  await chmod(path, 0o755);
  return dir;
}

describe('git-host fail-closed', () => {
  it('maps missing gh to gh_missing', async () => {
    const empty = await tempDir('zcc-empty-path-');
    await withPath(empty, async () => {
      await expect(runPullRequestAction(tmpdir(), { operation: 'ready' })).rejects.toMatchObject({
        code: 'gh_missing'
      });
    });
  });

  it('fails closed on malformed JSON from gh pr view', async () => {
    const repo = await initRepo();
    const bin = await fakeGh('#!/bin/sh\necho not-json\nexit 0\n');
    await withPath(`${bin}:${process.env.PATH ?? ''}`, async () => {
      await expect(getPullRequestForCurrentBranch(repo)).rejects.toBeInstanceOf(WorkspaceError);
    });
  });
});
