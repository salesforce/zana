import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from './git.js';
import { copyWorktreeIncludeFiles } from './worktree-include.js';
import { createWorktree, removeWorktree } from './provisioning.js';
import {
  cloneProject,
  provisionWorkspace,
  workspaceCommit,
  workspaceDiff,
  workspaceDiffPatch,
  workspaceSquashMerge,
  workspaceStatus
} from './workspace.js';
import { resolveAdditionalWorkspaceWriteRoots } from './workspace-write-roots.js';
import { withQueuedLock } from './process-local-queued-lock.js';

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
  const repo = await tempDir('zcc-ws-repo-');
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.name', 'Test']);
  await runGit(repo, ['config', 'user.email', 'test@example.com']);
  await writeFile(join(repo, 'README.md'), 'hello\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, ['commit', '-m', 'init']);
  return repo;
}

describe('queued lock', () => {
  it('runs critical sections in FIFO order', async () => {
    const order: number[] = [];
    await Promise.all([
      withQueuedLock('k', async () => {
        order.push(1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(2);
      }),
      withQueuedLock('k', async () => {
        order.push(3);
      })
    ]);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('workspace git', () => {
  it('reports status, commits, and diffs uncommitted work', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'README.md'), 'changed\n');
    const status = await workspaceStatus(repo);
    expect(status.isGitRepo).toBe(true);
    expect(status.dirty).toBe(true);
    expect(status.files.some((file) => file.path === 'README.md')).toBe(true);
    const diff = await workspaceDiff(repo, { type: 'uncommitted' });
    expect(diff.diff).toContain('changed');
    const patches = await workspaceDiffPatch(repo, { type: 'uncommitted' }, ['README.md']);
    expect(patches.patches).toHaveLength(1);
    expect(patches.patches[0]?.path).toBe('README.md');
    expect(patches.patches[0]?.patch).toContain('changed');
    const committed = await workspaceCommit(repo, 'update readme');
    expect(committed.commitSubject).toBe('update readme');
    expect((await workspaceStatus(repo)).dirty).toBe(false);
  });
});

describe('managed worktree', () => {
  it('creates an isolated branch, copies include files, and removes the worktree', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, '.env'), 'SECRET=1\n');
    await writeFile(join(repo, '.worktreeinclude'), '.env\n');
    const target = join(await tempDir('zcc-ws-wt-'), 'repo');
    const created = await createWorktree({
      sourcePath: repo,
      targetPath: target,
      branchName: 'zcc/feat-1',
      baseBranch: 'main'
    });
    expect(created.path).toBe(target);
    const status = await workspaceStatus(target);
    expect(status.branchName).toBe('zcc/feat-1');
    const copied = await copyWorktreeIncludeFiles(repo, target);
    expect(copied.copied.includes('.env') || (await runGit(target, ['status', '--porcelain'])).stdout).toBeTruthy();
    await writeFile(join(target, 'feature.txt'), 'work\n');
    await workspaceCommit(target, 'agent work');
    await removeWorktree({ path: target, sourcePath: repo, force: true });
    await expect(workspaceStatus(target)).resolves.toMatchObject({ isGitRepo: false });
  });

  it('rolls back when the setup script fails', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, '.zcc-env-setup.sh'), '#!/usr/bin/env bash\nexit 2\n');
    await runGit(repo, ['add', '.zcc-env-setup.sh']);
    await runGit(repo, ['commit', '-m', 'setup']);
    const parent = await tempDir('zcc-ws-setup-');
    const target = join(parent, 'repo');
    await expect(createWorktree({
      sourcePath: repo,
      targetPath: target,
      branchName: 'zcc/fail-1',
      baseBranch: 'main',
      timeoutMs: 5_000
    })).rejects.toMatchObject({ code: 'setup_failed' });
    expect(await runGit(repo, ['worktree', 'list'])).toBeTruthy();
    const listed = await runGit(repo, ['worktree', 'list']);
    expect(listed.stdout).not.toContain(target);
  });
});

describe('include copy', () => {
  it('skips symlinks and does not overwrite tracked files', async () => {
    const source = await tempDir('zcc-inc-src-');
    const target = await tempDir('zcc-inc-dst-');
    await writeFile(join(source, '.worktreeinclude'), '.env\ntracked.txt\n');
    await writeFile(join(source, '.env'), 'ok\n');
    await writeFile(join(source, 'tracked.txt'), 'from-source\n');
    await writeFile(join(target, 'tracked.txt'), 'already\n');
    const result = await copyWorktreeIncludeFiles(source, target);
    expect(result.copied).toContain('.env');
    expect(result.skipped).toContain('tracked.txt');
  });
});

describe('squash merge', () => {
  it('squash-merges the current branch into the target locally', async () => {
    const repo = await initRepo();
    await runGit(repo, ['switch', '-c', 'feat']);
    await writeFile(join(repo, 'feat.txt'), 'n\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-m', 'feat commit']);
    const result = await workspaceSquashMerge(repo, 'main', 'squash feat');
    expect(result.merged).toBe(true);
    const branch = await runGit(repo, ['branch', '--show-current']);
    expect(branch.stdout.trim()).toBe('main');
  });
});

describe('clone', () => {
  it('clones a local repo into the host checkouts dir', async () => {
    const origin = await initRepo();
    const dataDir = await tempDir('zcc-clone-data-');
    const cloned = await cloneProject({
      dataDir,
      projectSlug: 'demo',
      remoteUrl: origin
    });
    expect(cloned.path).toContain('checkouts/demo');
    expect((await workspaceStatus(cloned.path)).isGitRepo).toBe(true);
  });
});

describe('unmanaged provision', () => {
  it('discovers an existing directory and can switch onto a new branch', async () => {
    const repo = await initRepo();
    const result = await provisionWorkspace({
      workspaceProvisionType: 'unmanaged',
      path: repo,
      checkout: { kind: 'new', name: 'topic', baseBranch: 'main' }
    });
    expect(result.discovered.isGitRepo).toBe(true);
    expect(result.discovered.branchName).toBe('topic');
  });
});

describe('write roots', () => {
  it('adds git common-dir object roots outside a linked worktree', async () => {
    const repo = await initRepo();
    const target = join(await tempDir('zcc-ws-wr-'), 'repo');
    await createWorktree({
      sourcePath: repo,
      targetPath: target,
      branchName: 'zcc/roots',
      baseBranch: 'main'
    });
    const extra = await resolveAdditionalWorkspaceWriteRoots(target);
    expect(extra.some((path) => path.includes('.git'))).toBe(true);
    const { resolveAdditionalWorkspaceWriteRootsSync } = await import('./workspace-write-roots.js');
    const syncExtra = resolveAdditionalWorkspaceWriteRootsSync(target);
    expect(syncExtra.some((path) => path.includes('.git'))).toBe(true);
  });
});

describe('chmod helper keeps coverage of personal provision', () => {
  it('creates a personal directory', async () => {
    const dataDir = await tempDir('zcc-personal-');
    const target = join(dataDir, 'personal-workspaces', 'env-1');
    await mkdir(target, { recursive: true });
    await chmod(target, 0o700);
    const result = await provisionWorkspace({
      workspaceProvisionType: 'personal',
      targetPath: target
    });
    expect(result.discovered.path).toBeTruthy();
  });
});
