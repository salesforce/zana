import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PorcelainStatus, WorkspaceStatusHead } from './git.js';
import { runGit } from './git.js';
import { createWorkspaceStatusService, type WorkspaceStatusServiceOptions } from './workspace-status.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const head = (cwd: string): WorkspaceStatusHead => ({
  path: cwd,
  isGitRepo: true,
  isWorktree: false,
  branchName: 'main',
  defaultBranch: 'main',
  defaultBranchRelation: 'equal',
  originDefaultBranch: 'main',
  checkout: { kind: 'branch', branchName: 'main', headSha: 'abc' },
  operation: { kind: 'none' }
});

const porcelain = (entries: Array<[string, string]>, extra: Partial<PorcelainStatus> = {}): PorcelainStatus => ({
  ahead: 1,
  behind: 0,
  entries: entries.map(([code, path]) => ({ code, path })),
  truncated: false,
  ...extra
});

/**
 * Fake git: `all` scans resolve when the test says so (or immediately with
 * `autoAll`), `no` scans resolve immediately with the tracked entries.
 */
function harness(overrides: WorkspaceStatusServiceOptions & {
  autoAll?: PorcelainStatus;
  tracked?: PorcelainStatus;
  isGitRepo?: boolean;
} = {}) {
  let clock = 1_000_000;
  const scans: Array<{ cwd: string; result: Deferred<PorcelainStatus> }> = [];
  const runStatus = vi.fn(async (cwd: string, untracked: 'all' | 'no') => {
    if (untracked === 'no') return overrides.tracked ?? porcelain([[' M', 'tracked.ts']]);
    if (overrides.autoAll) return overrides.autoAll;
    const result = deferred<PorcelainStatus>();
    scans.push({ cwd, result });
    return result.promise;
  });
  const discover = vi.fn(async (cwd: string) => ({
    path: cwd,
    isGitRepo: overrides.isGitRepo ?? true,
    isWorktree: false,
    branchName: 'main',
    defaultBranch: 'main'
  }));
  const readHead = vi.fn(async (cwd: string) => head(cwd));
  const service = createWorkspaceStatusService({
    inlineScanMs: 20,
    slowRefreshMs: 60_000,
    now: () => clock,
    runStatus: runStatus as never,
    discover: discover as never,
    readHead: readHead as never,
    ...overrides
  });
  return {
    service,
    runStatus,
    discover,
    scans,
    advance(ms: number) { clock += ms; },
    allCalls: () => runStatus.mock.calls.filter(([, mode]) => mode === 'all').length,
    noCalls: () => runStatus.mock.calls.filter(([, mode]) => mode === 'no').length
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('workspace status service', () => {
  it('answers from a single full scan when the scan is fast', async () => {
    const h = harness({ autoAll: porcelain([[' M', 'a.ts'], ['??', 'new.ts']]) });
    const status = await h.service.status('/repo');
    expect(status.files.map((file) => [file.path, file.kind])).toEqual([['a.ts', 'modified'], ['new.ts', 'untracked']]);
    expect(status.dirty).toBe(true);
    expect(status.ahead).toBe(1);
    expect(status.untracked).toMatchObject({ state: 'fresh', slow: false });
    expect(h.allCalls()).toBe(1);
    expect(h.noCalls()).toBe(0);
    expect(h.runStatus).toHaveBeenCalledWith('/repo', 'all', expect.objectContaining({ lowPriority: true }));
  });

  it('coalesces concurrent requests for the same path into one computation', async () => {
    const h = harness();
    const calls = [h.service.status('/repo'), h.service.status('/repo'), h.service.status('/repo')];
    await flush();
    expect(h.discover).toHaveBeenCalledTimes(1);
    expect(h.scans).toHaveLength(1);
    h.scans[0]!.result.resolve(porcelain([]));
    const results = await Promise.all(calls);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    // A later request computes again.
    const later = h.service.status('/repo');
    await flush();
    expect(h.discover).toHaveBeenCalledTimes(2);
    h.scans[1]!.result.resolve(porcelain([]));
    await later;
  });

  it('falls back to tracked-only status while a slow scan runs, then serves the cached scan', async () => {
    const h = harness();
    const first = await h.service.status('/big');
    expect(first.untracked).toMatchObject({ state: 'pending', scannedAt: null });
    expect(first.files.map((file) => file.path)).toEqual(['tracked.ts']);
    expect(h.noCalls()).toBe(1);

    // A second request while the scan is still running reuses it, and no
    // longer waits the inline budget because the scan already overran it.
    const startedAt = Date.now();
    const second = await h.service.status('/big');
    expect(Date.now() - startedAt).toBeLessThan(15);
    expect(second.untracked).toMatchObject({ state: 'pending', slow: true });
    expect(h.scans).toHaveLength(1);

    h.advance(40_000);
    h.scans[0]!.result.resolve(porcelain([[' M', 'tracked.ts'], ['??', 'scratch.log'], ['??', 'tracked.ts']]));
    await flush();

    const third = await h.service.status('/big');
    expect(third.untracked).toMatchObject({ state: 'stale', slow: true, durationMs: 40_000 });
    // Untracked entries come from the cache; a path git now tracks is not duplicated.
    expect(third.files.map((file) => [file.path, file.kind])).toEqual([['tracked.ts', 'modified'], ['scratch.log', 'untracked']]);
    expect(h.scans).toHaveLength(1);
  });

  it('refreshes slow checkouts no sooner than ten times the last scan duration', async () => {
    const h = harness();
    await h.service.status('/big');
    h.advance(40_000);
    h.scans[0]!.result.resolve(porcelain([['??', 'a.log']]));
    await flush();

    h.advance(60_000); // past slowRefreshMs, but 40s × 10 = 400s not yet elapsed
    await h.service.status('/big');
    expect(h.scans).toHaveLength(1);

    h.advance(340_000);
    const refreshed = await h.service.status('/big');
    expect(h.scans).toHaveLength(2);
    // Slow checkouts never wait for the scan inline.
    expect(refreshed.untracked?.state).toBe('stale');
    h.scans[1]!.result.resolve(porcelain([]));
  });

  it('uses slowRefreshMs as the floor for slow checkouts with short scans', async () => {
    const h = harness();
    await h.service.status('/big');
    h.advance(3_000);
    h.scans[0]!.result.resolve(porcelain([]));
    await flush();
    h.advance(59_000);
    await h.service.status('/big');
    expect(h.scans).toHaveLength(1);
    h.advance(1_000);
    await h.service.status('/big');
    expect(h.scans).toHaveLength(2);
    h.scans[1]!.result.resolve(porcelain([]));
  });

  it('returns to inline scans once a checkout becomes fast again', async () => {
    const h = harness();
    await h.service.status('/big');
    h.advance(30);
    h.scans[0]!.result.resolve(porcelain([]));
    await flush();
    expect((await h.service.status('/big')).untracked?.slow).toBe(true);
    h.advance(60_000);
    const refresh = h.service.status('/big');
    await flush();
    h.advance(5);
    h.scans[1]!.result.resolve(porcelain([]));
    await refresh;
    await flush();
    const after = h.service.status('/big');
    await flush();
    h.scans[2]!.result.resolve(porcelain([['??', 'x']]));
    expect((await after).untracked).toMatchObject({ state: 'fresh', slow: false });
  });

  it('reports unavailable when a scan fails and no earlier result exists', async () => {
    const h = harness();
    const pending = h.service.status('/repo');
    await flush();
    h.scans[0]!.result.reject(new Error('git timed out'));
    const status = await pending;
    expect(status.untracked).toMatchObject({ state: 'unavailable', scannedAt: null });
    expect(status.files.map((file) => file.path)).toEqual(['tracked.ts']);
  });

  it('marks a scan that times out as slow and backs off', async () => {
    const h = harness();
    await h.service.status('/big');
    h.advance(120_000);
    h.scans[0]!.result.reject(new Error('git timed out after 120000ms'));
    await flush();
    const next = await h.service.status('/big');
    expect(next.untracked).toMatchObject({ state: 'unavailable', slow: true });
    expect(h.scans).toHaveLength(1);
  });

  it('keeps the previous result as stale when a later scan fails', async () => {
    const h = harness();
    await h.service.status('/big');
    h.advance(30_000);
    h.scans[0]!.result.resolve(porcelain([['??', 'kept.log']]));
    await flush();
    h.advance(300_000);
    await h.service.status('/big');
    h.scans[1]!.result.reject(new Error('boom'));
    await flush();
    const status = await h.service.status('/big');
    expect(status.untracked?.state).toBe('stale');
    expect(status.files.map((file) => file.path)).toContain('kept.log');
  });

  it('caps concurrent scans across paths', async () => {
    const h = harness({ maxConcurrentScans: 2 });
    const requests = ['/a', '/b', '/c'].map((cwd) => h.service.status(cwd));
    await flush();
    expect(h.scans.map((scan) => scan.cwd)).toEqual(['/a', '/b']);
    await Promise.all(requests);
    h.scans[0]!.result.resolve(porcelain([]));
    await flush();
    await flush();
    expect(h.scans.map((scan) => scan.cwd)).toEqual(['/a', '/b', '/c']);
    h.scans[1]!.result.resolve(porcelain([]));
    h.scans[2]!.result.resolve(porcelain([]));
  });

  it('rescans a slow checkout after invalidate', async () => {
    const h = harness();
    await h.service.status('/big');
    h.advance(30_000);
    h.scans[0]!.result.resolve(porcelain([['??', 'committed-now.ts']]));
    await flush();
    h.service.invalidate('/big');
    h.service.invalidate('/unknown'); // no-op for paths never seen
    await h.service.status('/big');
    expect(h.scans).toHaveLength(2);
    h.scans[1]!.result.resolve(porcelain([]));
  });

  it('caps cached untracked entries and reports truncation', async () => {
    const h = harness({ maxCachedEntries: 2 });
    await h.service.status('/big');
    h.advance(30_000);
    h.scans[0]!.result.resolve(porcelain([['??', 'a'], ['??', 'b'], ['??', 'c']]));
    await flush();
    const status = await h.service.status('/big');
    expect(status.files.map((file) => file.path)).toEqual(['tracked.ts', 'a', 'b']);
    expect(status.filesTruncated).toBe(true);
  });

  it('applies maxFiles to the merged list', async () => {
    const h = harness({ autoAll: porcelain([[' M', 'a'], [' M', 'b'], ['??', 'c']]) });
    const status = await h.service.status('/repo', 2);
    expect(status.files).toHaveLength(2);
    expect(status.filesTruncated).toBe(true);
    expect(status.dirty).toBe(true);
  });

  it('answers not-a-repo without scanning and forgets the path', async () => {
    const h = harness({ isGitRepo: false });
    const status = await h.service.status('/plain');
    expect(status).toMatchObject({ isGitRepo: false, files: [] });
    expect(status.untracked).toBeUndefined();
    expect(h.runStatus).not.toHaveBeenCalled();
  });

  it('evicts the least recently used idle path', async () => {
    const h = harness({ maxCachedPaths: 1, autoAll: porcelain([]) });
    await h.service.status('/a');
    await h.service.status('/b');
    h.service.forget('/b');
    h.service.forget('/missing');
    await h.service.status('/a');
    expect(h.allCalls()).toBe(3);
  });

  it('propagates a tracked-status failure on the slow path', async () => {
    const h = harness();
    h.runStatus.mockImplementation(async (_cwd: string, mode: 'all' | 'no') => {
      if (mode === 'no') throw new Error('not a work tree');
      return new Promise<PorcelainStatus>(() => undefined);
    });
    await expect(h.service.status('/broken')).rejects.toThrow('not a work tree');
    // The failed computation is not cached as in-flight.
    await expect(h.service.status('/broken')).rejects.toThrow('not a work tree');
  });
});

describe('workspace status service (real git)', () => {
  let repo: string | null = null;
  afterEach(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
    repo = null;
  });

  it('reports tracked and untracked changes with a fresh scan', async () => {
    repo = await mkdtemp(join(tmpdir(), 'zcc-status-svc-'));
    await runGit(repo, ['init', '-q', '-b', 'main']);
    await runGit(repo, ['config', 'user.email', 'test@example.com']);
    await runGit(repo, ['config', 'user.name', 'Test']);
    await writeFile(join(repo, 'tracked.txt'), 'one\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);
    await writeFile(join(repo, 'tracked.txt'), 'two\n');
    await writeFile(join(repo, 'new file.txt'), 'x\n');

    const service = createWorkspaceStatusService({ inlineScanMs: 10_000 });
    const status = await service.status(repo);
    expect(status.branchName).toBe('main');
    expect(status.files.map((file) => [file.path, file.kind]).sort()).toEqual([
      ['new file.txt', 'untracked'],
      ['tracked.txt', 'modified']
    ]);
    expect(status.untracked).toMatchObject({ state: 'fresh', slow: false });
  });
});
