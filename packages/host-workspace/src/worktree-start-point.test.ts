import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProvisioningTranscriptEntry } from '@zana-ai/zcc-domain';
import { revParse, runGit } from './git.js';
import { createWorktree, resolveWorktreeStartPoint } from './provisioning.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * Git 2.5x runs detached `maintenance run --auto` after push/commit/fetch. Its
 * geometric repack fires whenever objects/17/ holds two loose objects — the
 * fixed README tree is 1772…, so one in 256 seed commits trips it — and then
 * rewrites objects/info/packs while the next local `git clone` hardlinks that
 * directory ("hardlink different from source"). Keep fixtures quiescent.
 */
async function disableAutoMaintenance(repo: string): Promise<void> {
  await runGit(repo, ['config', 'maintenance.auto', 'false']);
}

async function configure(repo: string): Promise<void> {
  await runGit(repo, ['config', 'user.name', 'Test']);
  await runGit(repo, ['config', 'user.email', 'test@example.com']);
  await disableAutoMaintenance(repo);
}

async function commitFile(repo: string, name: string): Promise<string> {
  await writeFile(join(repo, name), `${name}\n`);
  await runGit(repo, ['add', name]);
  await runGit(repo, ['commit', '-m', name]);
  return (await revParse(repo, 'HEAD'))!;
}

async function initRepo(branch = 'main'): Promise<string> {
  const repo = await tempDir('zcc-sp-repo-');
  await runGit(repo, ['init', '-b', branch]);
  await configure(repo);
  await commitFile(repo, 'README.md');
  return repo;
}

/** A bare origin, a clone with origin/HEAD set, and a second clone that can push ahead. */
async function initClonePair(): Promise<{ remote: string; work: string; other: string }> {
  const seed = await initRepo();
  const remote = await tempDir('zcc-sp-remote-');
  await runGit(remote, ['init', '--bare', '-b', 'main']);
  await disableAutoMaintenance(remote);
  await runGit(seed, ['push', remote, 'main']);
  const parent = await tempDir('zcc-sp-clones-');
  await runGit(parent, ['clone', '--quiet', remote, 'work']);
  await runGit(parent, ['clone', '--quiet', remote, 'other']);
  const work = join(parent, 'work');
  const other = join(parent, 'other');
  await configure(work);
  await configure(other);
  return { remote, work, other };
}

// Each case clones and pushes real repositories; allow for a loaded host.
describe('worktree start point', { timeout: 60_000 }, () => {
  it('uses an explicit base branch that resolves', async () => {
    const repo = await initRepo();
    await runGit(repo, ['checkout', '-b', 'feature']);
    expect(await resolveWorktreeStartPoint(repo, 'feature')).toBe('feature');
  });

  it('fetches an explicit remote-tracking base before using it', async () => {
    const { work, other } = await initClonePair();
    await runGit(other, ['checkout', '--quiet', '-b', 'feature']);
    const feature = await commitFile(other, 'feature.txt');
    await runGit(other, ['push', '--quiet', 'origin', 'feature']);
    const progress: ProvisioningTranscriptEntry[] = [];

    expect(await resolveWorktreeStartPoint(work, 'origin/feature', (entry) => progress.push(entry))).toBe('origin/feature');
    expect(await revParse(work, 'refs/remotes/origin/feature')).toBe(feature);
    expect(progress).toContainEqual(expect.objectContaining({ key: 'fetch', text: 'Fetched origin/feature' }));
  });

  it('does not fetch a local branch whose name only looks like a remote ref', async () => {
    const { work } = await initClonePair();
    await runGit(work, ['branch', 'origin/local-only']);
    await runGit(work, ['branch', 'feature/x']);
    const progress: ProvisioningTranscriptEntry[] = [];

    expect(await resolveWorktreeStartPoint(work, 'origin/local-only', (entry) => progress.push(entry))).toBe('origin/local-only');
    expect(await resolveWorktreeStartPoint(work, 'feature/x', (entry) => progress.push(entry))).toBe('feature/x');
    expect(progress.filter((entry) => entry.key === 'fetch')).toEqual([]);
  });

  it('uses the local default branch, not HEAD, when there is no origin', async () => {
    const repo = await initRepo();
    await runGit(repo, ['checkout', '-b', 'feature']);
    await commitFile(repo, 'feature.txt');
    expect(await resolveWorktreeStartPoint(repo, null)).toBe('main');
    expect(await resolveWorktreeStartPoint(repo, 'missing-branch')).toBe('main');
  });

  it('fetches origin and starts from it when local main is behind', async () => {
    const { work, other } = await initClonePair();
    const upstream = await commitFile(other, 'upstream.txt');
    await runGit(other, ['push', '--quiet', 'origin', 'main']);
    const progress: ProvisioningTranscriptEntry[] = [];

    expect(await resolveWorktreeStartPoint(work, null, (entry) => progress.push(entry))).toBe('origin/main');
    expect(await revParse(work, 'refs/remotes/origin/main')).toBe(upstream);
    expect(progress).toContainEqual(expect.objectContaining({ key: 'fetch', text: 'Fetched origin/main' }));
  });

  it('keeps local main when it has commits origin lacks', async () => {
    const { work } = await initClonePair();
    await commitFile(work, 'local.txt');
    expect(await resolveWorktreeStartPoint(work, null)).toBe('main');
  });

  it('falls back to the last fetched origin ref when the fetch fails', async () => {
    const { remote, work } = await initClonePair();
    await rm(remote, { recursive: true, force: true });
    const progress: ProvisioningTranscriptEntry[] = [];

    expect(await resolveWorktreeStartPoint(work, null, (entry) => progress.push(entry))).toBe('origin/main');
    expect(progress).toContainEqual(expect.objectContaining({
      key: 'fetch',
      text: 'Could not fetch origin/main; using local refs'
    }));
  });

  it('falls back to HEAD when no default branch exists', async () => {
    const repo = await initRepo('trunk');
    await runGit(repo, ['checkout', '--quiet', '--detach']);
    await runGit(repo, ['branch', '-D', 'trunk']);
    expect(await resolveWorktreeStartPoint(repo, null)).toBe('HEAD');
  });

  it('creates a default-base worktree from the fetched origin commit', async () => {
    const { work, other } = await initClonePair();
    await runGit(work, ['checkout', '--quiet', '-b', 'stale-feature']);
    await commitFile(work, 'stale.txt');
    const upstream = await commitFile(other, 'upstream.txt');
    await runGit(other, ['push', '--quiet', 'origin', 'main']);

    const target = join(await tempDir('zcc-sp-wt-'), 'repo');
    await createWorktree({ sourcePath: work, targetPath: target, branchName: 'zcc/new-1', baseBranch: null });
    expect(await revParse(target, 'HEAD')).toBe(upstream);
  });
});
