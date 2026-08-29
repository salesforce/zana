import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceError } from './error.js';
import { runGit } from './git.js';
import { createPullRequest, getPullRequestForCurrentBranch, runPullRequestAction } from './git-host.js';

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

  it('creates a pull request through gh pr create then reads it back', async () => {
    const repo = await initRepo();
    const bin = await fakeGh(`#!/bin/sh
DIR=$(dirname "$0")
if [ "$1" = pr ] && [ "$2" = create ]; then
  touch "$DIR/created"
  echo https://example.test/pr/7
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  [ -f "$DIR/created" ] || exit 1
  echo '{"number":7,"title":"t","state":"OPEN","url":"https://example.test/pr/7","isDraft":false,"baseRefName":"main","headRefName":"feat","updatedAt":null,"reviewDecision":null,"mergeStateStatus":null,"mergeable":"MERGEABLE"}'
  exit 0
fi
exit 1
`);
    await withPath(`${bin}:${process.env.PATH ?? ''}`, async () => {
      await expect(createPullRequest(repo, { title: 'Ship it' })).resolves.toMatchObject({
        number: 7,
        url: 'https://example.test/pr/7'
      });
    });
  });

  it('prefers ZCC_GH_BINARY over PATH', async () => {
    const repo = await initRepo();
    const bin = await fakeGh(`#!/bin/sh
DIR=$(dirname "$0")
if [ "$1" = pr ] && [ "$2" = create ]; then
  touch "$DIR/created"
  echo https://example.test/pr/7
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  echo '{"number":7,"title":"t","state":"OPEN","url":"https://example.test/pr/7","isDraft":false,"baseRefName":"main","headRefName":"feat","updatedAt":null,"reviewDecision":null,"mergeStateStatus":null,"mergeable":"MERGEABLE"}'
  exit 0
fi
exit 1
`);
    const previous = process.env.ZCC_GH_BINARY;
    process.env.ZCC_GH_BINARY = join(bin, 'gh');
    try {
      await withPath('/usr/bin:/bin', async () => {
        await expect(createPullRequest(repo, { title: 'Ship it' })).resolves.toMatchObject({
          number: 7,
          url: 'https://example.test/pr/7'
        });
      });
    } finally {
      if (previous === undefined) delete process.env.ZCC_GH_BINARY;
      else process.env.ZCC_GH_BINARY = previous;
    }
  });
});
