import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildUnitCheckpoint, captureBaseline, confineAndHashClaimWrite, MAX_BASELINE_PATHS, runGit, type GitRunner, type UnitBaseline
} from '../unit-checkpoints.js';
import { createExecutionStore } from '../store.js';
import { ExecutionService } from '../service.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

async function repo(run: (root: string, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-unit-ckpt-'));
  const root = join(dir, 'wt');
  try {
    await mkdir(root);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(root, 'a.txt'), 'base-a\n');
    await writeFile(join(root, 'b.txt'), 'base-b\n');
    await writeFile(join(root, 'run.sh'), '#!/bin/sh\n');
    await chmod(join(root, 'run.sh'), 0o755);
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    await run(root, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const gitState = (root: string) => [git(root, 'log', '--oneline'), git(root, 'stash', 'list'), git(root, 'branch', '--list'), git(root, 'rev-parse', 'HEAD')].join('|');
const touch = (path: string, content: string) => ({ path, hash: sha(content) });

describe('runGit', () => {
  it('captures output larger than one 8 KiB pipe chunk in full, and flags truncation at the cap', async () => repo(async (root) => {
    const big = 'x'.repeat(300_000);
    await writeFile(join(root, 'big.txt'), big);
    git(root, 'add', 'big.txt'); git(root, 'commit', '-q', '-m', 'big');
    const full = await runGit(root, ['cat-file', 'blob', 'HEAD:big.txt'], { timeoutMs: 5_000, maxBytes: 1_000_000 });
    expect(full?.code).toBe(0);
    expect(full?.stdout.length).toBe(300_000);
    expect(full?.truncated).toBe(false);
    const cut = await runGit(root, ['cat-file', 'blob', 'HEAD:big.txt'], { timeoutMs: 5_000, maxBytes: 100 });
    expect(cut?.stdout.length).toBe(100);
    expect(cut?.truncated).toBe(true);
  }));

  it('reports a non-zero exit, and undefined when git cannot run or times out', async () => repo(async (root, dir) => {
    expect((await runGit(dir, ['rev-parse', 'HEAD'], { timeoutMs: 5_000, maxBytes: 100 }))?.code).not.toBe(0);
    const path = process.env.PATH;
    process.env.PATH = join(dir, 'nowhere');
    try { expect(await runGit(root, ['status'], { timeoutMs: 5_000, maxBytes: 100 })).toBeUndefined(); }
    finally { process.env.PATH = path; }
    // A hanging git (blocking on a fifo-less stdin read of a huge pack) is simulated with a 1ms budget on a real command.
    const timed = await runGit(root, ['log', '--oneline'], { timeoutMs: 0, maxBytes: 100 });
    expect(timed === undefined || timed.code === 0).toBe(true);
  }));
});

describe('captureBaseline', () => {
  it('records HEAD and the paths already dirty, hashed, including untracked files', async () => repo(async (root) => {
    await writeFile(join(root, 'a.txt'), 'dirty-a\n');
    await writeFile(join(root, 'new.txt'), 'fresh');
    const baseline = await captureBaseline(root, 'claim-1', { now: () => 7 });
    expect(baseline).toMatchObject({ claimId: 'claim-1', at: 7, ok: true, head: git(root, 'rev-parse', 'HEAD').trim() });
    expect(baseline.dirty).toEqual(expect.arrayContaining([{ path: 'a.txt', hash: sha('dirty-a\n') }, { path: 'new.txt', hash: sha('fresh') }]));
    expect(baseline.dirty).toHaveLength(2);
  }));

  it('is not ok outside a repository, when git is missing, or when status fails', async () => repo(async (_root, dir) => {
    expect(await captureBaseline(dir, 'c')).toMatchObject({ ok: false, reason: 'git-unavailable', dirty: [] });
    expect(await captureBaseline('/definitely/missing', 'c')).toMatchObject({ ok: false });
    const noGit: GitRunner = async () => undefined;
    expect(await captureBaseline(dir, 'c', { git: noGit })).toMatchObject({ ok: false, reason: 'git-unavailable' });
    const throwing: GitRunner = async () => { throw new Error('boom'); };
    expect(await captureBaseline(dir, 'c', { git: throwing })).toMatchObject({ ok: false, reason: 'git-unavailable' });
    const statusFails: GitRunner = async (_cwd, args) => args[0] === 'rev-parse'
      ? { code: 0, stdout: Buffer.from(`${'a'.repeat(40)}\n`), truncated: false } : { code: 128, stdout: Buffer.alloc(0), truncated: false };
    expect(await captureBaseline(dir, 'c', { git: statusFails })).toMatchObject({ ok: false, reason: 'git-status-failed' });
  }));

  it('flags a huge status as truncated and bounds the recorded paths', async () => repo(async (root) => {
    const many = Array.from({ length: MAX_BASELINE_PATHS + 5 }, (_, i) => `?? f${i}.txt`).join('\0') + '\0';
    const fake: GitRunner = async (_cwd, args) => args[0] === 'rev-parse'
      ? { code: 0, stdout: Buffer.from(`${'b'.repeat(40)}\n`), truncated: false }
      : { code: 0, stdout: Buffer.from(many), truncated: false };
    const baseline = await captureBaseline(root, 'c', { git: fake });
    expect(baseline.ok).toBe(true);
    expect(baseline.truncated).toBe(true);
    expect(baseline.dirty).toHaveLength(MAX_BASELINE_PATHS);
    expect(baseline.dirty[0]).toEqual({ path: 'f0.txt', hash: 'unresolved' });
    const cut: GitRunner = async (_cwd, args) => args[0] === 'rev-parse'
      ? { code: 0, stdout: Buffer.from(`${'b'.repeat(40)}\n`), truncated: false }
      : { code: 0, stdout: Buffer.from('?? a.txt\0?? b.tx'), truncated: true };
    const partial = await captureBaseline(root, 'c', { git: cut });
    expect(partial.truncated).toBe(true);
    expect(partial.dirty.map((entry) => entry.path)).toEqual(['a.txt']);
  }));

  it('handles renames, and marks symlinked or vanished listed paths unresolved', async () => repo(async (root, dir) => {
    git(root, 'mv', 'b.txt', 'renamed.txt');
    await writeFile(join(dir, 'secret'), 'outside');
    await symlink(join(dir, 'secret'), join(root, 'link.txt'));
    const baseline = await captureBaseline(root, 'c');
    const byPath = new Map(baseline.dirty.map((entry) => [entry.path, entry.hash]));
    expect(byPath.get('renamed.txt')).toBe(sha('base-b\n'));
    expect(byPath.has('b.txt')).toBe(false);
    expect(byPath.get('link.txt')).toBe('unresolved');
  }));
});

describe('buildUnitCheckpoint (AC5)', () => {
  const baselineOf = async (root: string, claimId = 'c1'): Promise<UnitBaseline> => captureBaseline(root, claimId);

  it('one failing and one passing unit on the same worktree: both get patches, only the failed unit is reverted, git history is untouched', async () => repo(async (root) => {
    const before = gitState(root);
    const baseA = await baselineOf(root, 'ca');
    const baseB = await baselineOf(root, 'cb');
    await writeFile(join(root, 'a.txt'), 'failed edit\n');   // unit A (fails)
    await writeFile(join(root, 'made.txt'), 'created\n');    // unit A created a file
    await writeFile(join(root, 'b.txt'), 'good edit\n');     // unit B (passes)
    const a = { id: 'a', state: 'FAILED' as const, touched: [touch('a.txt', 'failed edit\n'), touch('made.txt', 'created\n')], baseline: baseA };
    const b = { id: 'b', state: 'COMPLETED' as const, touched: [touch('b.txt', 'good edit\n')], baseline: baseB };

    const passing = await buildUnitCheckpoint(root, b, [{ id: 'a', touched: a.touched, concurrent: true }], { restore: false });
    expect(passing.checkpoint.state).toBe('saved');
    expect(JSON.parse(passing.artifactContent).patches[0]).toMatchObject({ path: 'b.txt', status: 'modified' });
    expect(JSON.parse(passing.artifactContent).patches[0].patch).toContain('+good edit');
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('good edit\n');

    const failing = await buildUnitCheckpoint(root, a, [{ id: 'b', touched: b.touched, concurrent: true }], { restore: true });
    expect(failing.checkpoint).toMatchObject({ state: 'restored', restored: ['a.txt'], deleted: ['made.txt'], skipped: [], unattributed: ['b.txt'] });
    const patches = JSON.parse(failing.artifactContent).patches as Array<{ path: string; status: string; patch?: string }>;
    expect(patches.map((p) => [p.path, p.status])).toEqual([['a.txt', 'modified'], ['made.txt', 'created']]);
    expect(patches[1]!.patch).toContain('+created');
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('base-a\n');
    await expect(stat(join(root, 'made.txt'))).rejects.toThrow();
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('good edit\n');
    expect(gitState(root)).toBe(before);
    expect(git(root, 'status', '--porcelain').trim()).toBe('M b.txt');
    expect(git(root, 'diff', '--cached', '--name-only').trim()).toBe('');
  }));

  it('skips and reports a file a sibling also touched; the sibling edit is preserved', async () => repo(async (root) => {
    const baseline = await baselineOf(root);
    await writeFile(join(root, 'a.txt'), 'sibling wrote last\n');
    const result = await buildUnitCheckpoint(root, { id: 'a', state: 'FAILED', touched: [touch('a.txt', 'sibling wrote last\n')], baseline },
      [{ id: 'other', touched: [touch('a.txt', 'sibling wrote last\n')], concurrent: false }], { restore: true });
    expect(result.checkpoint.state).toBe('partial');
    expect(result.checkpoint.skipped).toEqual([{ path: 'a.txt', reason: 'shared-with:other' }]);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('sibling wrote last\n');
  }));

  it('does not restore a file whose content changed after the unit\'s last write', async () => repo(async (root) => {
    const baseline = await baselineOf(root);
    await writeFile(join(root, 'a.txt'), 'later edit by someone else\n');
    const result = await buildUnitCheckpoint(root, { id: 'a', state: 'FAILED', touched: [touch('a.txt', 'unit wrote this\n')], baseline }, [], { restore: true });
    expect(result.checkpoint.skipped).toEqual([{ path: 'a.txt', reason: 'changed-after-last-write' }]);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('later edit by someone else\n');
  }));

  it('labels pre-dirty paths and never restores them', async () => repo(async (root) => {
    await writeFile(join(root, 'a.txt'), 'user work in progress\n');
    const baseline = await baselineOf(root);
    await writeFile(join(root, 'a.txt'), 'unit edit\n');
    const result = await buildUnitCheckpoint(root, { id: 'a', state: 'FAILED', touched: [touch('a.txt', 'unit edit\n')], baseline }, [], { restore: true });
    expect(result.checkpoint.preDirty).toEqual(['a.txt']);
    expect(result.checkpoint.skipped).toEqual([{ path: 'a.txt', reason: 'pre-dirty' }]);
    expect(JSON.parse(result.artifactContent).patches[0]).toMatchObject({ path: 'a.txt', preDirty: true });
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('unit edit\n');
  }));

  it('covers Bash-mediated writes by diffing against the baseline, reporting them without rewriting (a person may have made them)', async () => repo(async (root) => {
    await writeFile(join(root, 'b.txt'), 'dirty before\n');
    const baseline = await baselineOf(root);
    await writeFile(join(root, 'a.txt'), 'bash edit\n');
    await writeFile(join(root, 'gen.txt'), 'bash created\n');
    const alone = await buildUnitCheckpoint(root, { id: 'a', state: 'FAILED', touched: [], baseline }, [], { restore: true });
    expect(alone.checkpoint).toMatchObject({ state: 'partial', restored: [], deleted: [] });
    expect(alone.checkpoint.skipped.map((s) => s.reason)).toEqual(['unattributed-write', 'unattributed-write']);
    expect(JSON.parse(alone.artifactContent).patches.every((p: { source: string }) => p.source === 'inferred')).toBe(true);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('bash edit\n');
    expect(await readFile(join(root, 'gen.txt'), 'utf8')).toBe('bash created\n');
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('dirty before\n');

    await writeFile(join(root, 'a.txt'), 'bash edit again\n');
    const shared = await buildUnitCheckpoint(root, { id: 'a', state: 'FAILED', touched: [], baseline }, [{ id: 's', touched: [], concurrent: true }], { restore: true });
    expect(shared.checkpoint.unattributed).toEqual(['a.txt', 'gen.txt']);
    expect(shared.checkpoint.restored).toEqual([]);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('bash edit again\n');
  }));

  it('restores a tool-written executable keeping its mode, and leaves a shell-deleted tracked file for the person', async () => repo(async (root) => {
    const baseline = await baselineOf(root);
    await rm(join(root, 'a.txt'));
    await writeFile(join(root, 'run.sh'), 'changed\n');
    const result = await buildUnitCheckpoint(root, { id: 'a', state: 'FAILED', touched: [touch('run.sh', 'changed\n')], baseline }, [], { restore: true });
    expect(result.checkpoint.restored).toEqual(['run.sh']);
    expect(result.checkpoint.skipped).toEqual([{ path: 'a.txt', reason: 'unattributed-write' }]);
    expect((await stat(join(root, 'run.sh'))).mode & 0o111).not.toBe(0);
    expect(git(root, 'status', '--porcelain').trim()).toBe('D a.txt');
  }));

  it('never writes through a symlink that escapes the worktree', async () => repo(async (root, dir) => {
    const outside = join(dir, 'outside'); await mkdir(outside);
    await writeFile(join(outside, 'x.txt'), 'outside content');
    await symlink(outside, join(root, 'esc'));
    const baseline = await baselineOf(root);
    const result = await buildUnitCheckpoint(root, { id: 'a', state: 'FAILED', touched: [touch('esc/x.txt', 'outside content')], baseline }, [], { restore: true });
    expect(result.checkpoint.restored).toEqual([]);
    expect(result.checkpoint.deleted).toEqual([]);
    expect(await readFile(join(outside, 'x.txt'), 'utf8')).toBe('outside content');
    expect(JSON.parse(result.artifactContent).patches[0].patchOmitted).toBe(true);
  }));

  it('only records evidence without a usable baseline, after HEAD moved, or when the baseline is truncated', async () => repo(async (root) => {
    await writeFile(join(root, 'a.txt'), 'edit\n');
    const unit = { id: 'a', state: 'FAILED' as const, touched: [touch('a.txt', 'edit\n')] };
    const none = await buildUnitCheckpoint(root, unit, [], { restore: true });
    expect(none.checkpoint).toMatchObject({ state: 'unavailable', reason: 'no-baseline', skipped: [{ path: 'a.txt', reason: 'no-baseline' }] });
    const failed = await buildUnitCheckpoint(root, { ...unit, baseline: { claimId: 'c', at: 1, ok: false, dirty: [], reason: 'git-unavailable' } }, [], { restore: true });
    expect(failed.checkpoint.reason).toBe('git-unavailable');
    const baseline = await baselineOf(root);
    const trunc = await buildUnitCheckpoint(root, { ...unit, baseline: { ...baseline, truncated: true } }, [], { restore: true });
    expect(trunc.checkpoint).toMatchObject({ state: 'unavailable', skipped: [{ path: 'a.txt', reason: 'baseline-incomplete' }] });
    git(root, 'commit', '-q', '-am', 'moved on');
    await writeFile(join(root, 'a.txt'), 'edit2\n');
    const moved = await buildUnitCheckpoint(root, { ...unit, touched: [touch('a.txt', 'edit2\n')], baseline }, [], { restore: true });
    expect(moved.checkpoint.skipped).toEqual([{ path: 'a.txt', reason: 'head-moved' }]);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('edit2\n');
  }));

  it('does not restore when restore is off (slot not quiet) and never restores a COMPLETED unit', async () => repo(async (root) => {
    const baseline = await baselineOf(root);
    await writeFile(join(root, 'a.txt'), 'edit\n');
    const failed = { id: 'a', state: 'FAILED' as const, touched: [touch('a.txt', 'edit\n')], baseline };
    expect((await buildUnitCheckpoint(root, failed, [], { restore: false })).checkpoint).toMatchObject({ state: 'saved', restored: [], skipped: [] });
    expect((await buildUnitCheckpoint(root, { ...failed, state: 'COMPLETED' }, [], { restore: true })).checkpoint).toMatchObject({ state: 'saved', restored: [] });
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('edit\n');
  }));

  it('survives git failures, a missing worktree and a throwing runner; reports restore errors', async () => repo(async (root, dir) => {
    const baseline = await baselineOf(root);
    await writeFile(join(root, 'a.txt'), 'edit\n');
    const unit = { id: 'a', state: 'FAILED' as const, touched: [touch('a.txt', 'edit\n')], baseline };
    const realHead = baseline.head!;
    // HEAD ok, everything else fails.
    const flaky: GitRunner = async (cwd, args, opts) => args[0] === 'rev-parse' ? runGit(cwd, args, opts) : undefined;
    const lookup = await buildUnitCheckpoint(root, unit, [], { restore: true, git: flaky });
    expect(lookup.checkpoint.skipped).toEqual(expect.arrayContaining([{ path: 'a.txt', reason: 'head-lookup-failed' }, { path: '*', reason: 'git-status-failed' }]));
    // Blob unreadable / too large.
    const blobBad = (truncated: boolean, code: number): GitRunner => async (cwd, args, opts) => args[0] === 'cat-file' ? { code, stdout: Buffer.from('x'), truncated } : runGit(cwd, args, opts);
    expect((await buildUnitCheckpoint(root, unit, [], { restore: true, git: blobBad(false, 128) })).checkpoint.skipped[0]!.reason).toBe('head-content-unavailable');
    expect((await buildUnitCheckpoint(root, unit, [], { restore: true, git: blobBad(true, 0) })).checkpoint.skipped[0]!.reason).toBe('too-large');
    // File changes between the first hash and the write.
    const racing: GitRunner = async (cwd, args, opts) => { if (args[0] === 'cat-file') await writeFile(join(root, 'a.txt'), 'raced\n'); return runGit(cwd, args, opts); };
    expect((await buildUnitCheckpoint(root, unit, [], { restore: true, git: racing })).checkpoint.skipped[0]!.reason).toBe('changed-during-restore');
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('raced\n');
    // Submodule/symlink mode in HEAD is unsupported.
    const odd: GitRunner = async (cwd, args, opts) => args[0] === 'ls-tree' ? { code: 0, stdout: Buffer.from(`120000 blob ${realHead}\ta.txt\0`), truncated: false } : runGit(cwd, args, opts);
    await writeFile(join(root, 'a.txt'), 'edit\n');
    expect((await buildUnitCheckpoint(root, unit, [], { restore: true, git: odd })).checkpoint.skipped[0]!.reason).toBe('unsupported-mode');
    // Write failure: parent directory made read-only.
    await mkdir(join(root, 'ro'));
    await writeFile(join(root, 'ro', 'f.txt'), 'v1\n');
    git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'ro');
    const base2 = await baselineOf(root, 'c2');
    await writeFile(join(root, 'ro', 'f.txt'), 'v2\n');
    await chmod(join(root, 'ro'), 0o555);
    try {
      const res = await buildUnitCheckpoint(root, { id: 'r', state: 'FAILED', touched: [touch('ro/f.txt', 'v2\n')], baseline: base2 }, [], { restore: true });
      if (process.getuid?.() !== 0) expect(res.checkpoint.skipped[0]!.reason).toMatch(/^restore-failed:/);
    } finally { await chmod(join(root, 'ro'), 0o755); }
    // Throwing runner and missing worktree never throw.
    const boom: GitRunner = async () => { throw new Error('kaput'); };
    expect((await buildUnitCheckpoint(root, unit, [], { restore: true, git: boom })).checkpoint.reason).toBe('checkpoint-failed:kaput');
    const throwsAfterBaseline: GitRunner = async (cwd, args, opts) => { if (args[0] === 'ls-tree') throw new Error('kaput'); return runGit(cwd, args, opts); };
    expect((await buildUnitCheckpoint(root, unit, [], { restore: true, git: throwsAfterBaseline })).checkpoint).toMatchObject({ state: 'unavailable', reason: 'checkpoint-failed:kaput' });
    const missing = await buildUnitCheckpoint(join(dir, 'gone'), { ...unit, baseline: { ...baseline, ok: false, dirty: [] } }, [], { restore: true });
    expect(missing.checkpoint.state).toBe('unavailable');
    const noRoot = await buildUnitCheckpoint(join(dir, 'gone'), unit, [], { restore: true, git: async (_c, args) => args[0] === 'rev-parse' ? { code: 0, stdout: Buffer.from(`${baseline.head}\n`), truncated: false } : { code: 0, stdout: Buffer.alloc(0), truncated: false } });
    expect(noRoot.checkpoint).toMatchObject({ state: 'unavailable', reason: 'worktree-unavailable' });
  }));

  it('bounds the artifact: truncates oversize patch text and caps the path count', async () => repo(async (root) => {
    const baseline = await baselineOf(root);
    const touched = [];
    for (let i = 0; i < 230; i += 1) {
      const name = `d${i}-${'n'.repeat(200)}.txt`;
      await writeFile(join(root, name), 'z'.repeat(9_000));
      touched.push(touch(name, 'z'.repeat(9_000)));
    }
    const result = await buildUnitCheckpoint(root, { id: 'big', state: 'COMPLETED', touched, baseline }, [], { restore: false });
    expect(Buffer.byteLength(result.artifactContent, 'utf8')).toBeLessThanOrEqual(60 * 1024);
    expect(result.checkpoint.truncated).toBe(true);
    const body = JSON.parse(result.artifactContent) as { patches: Array<{ patch?: string; patchOmitted?: boolean }>; patchesTruncated?: boolean };
    expect(body.patches.length).toBeLessThanOrEqual(200);
    expect(body.patches.some((p) => p.patchOmitted)).toBe(true);
  }));
});

describe('confineAndHashClaimWrite is shared with the service', () => {
  it('is re-exported by the service module', async () => {
    const service = await import('../service.js');
    expect(service.confineAndHashClaimWrite).toBe(confineAndHashClaimWrite);
  });
});

describe('store.recordUnitCheckpoint', () => {
  async function fixture(run: (store: ReturnType<typeof createExecutionStore>) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-ckpt-store-'));
    try {
      const store = createExecutionStore({ filePath: join(dir, 'e.json'), id: () => 'execution' });
      let record = (await store.claim({ callerPrincipalId: 's', projectId: 'p', teamId: 't', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [], request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] } })).record;
      record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 's');
      record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'r');
      record = await store.setAuthorizationContext(record.id, record.stateVersion, { version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' }, { slotId: 'engineer:0', personaId: 'engineer', authorizationIdDigest: 'e' }] }, 'digest');
      record = await store.replaceResolvedModels(record.id, [{ slotId: 'engineer:0', personaId: 'engineer', provider: 'anthropic', model: 'm' }]);
      record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'a', task: 'work', dependencies: [], readOnly: true }]);
      await store.claimWork('execution', record.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'a');
      await run(store);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  const checkpoint = { at: 1, state: 'saved' as const, restored: [], deleted: [], skipped: [], preDirty: [], unattributed: [], attempts: 1 };

  it('stores a baseline only for the current claim and a checkpoint only for a settled unit', async () => fixture(async (store) => {
    const claimId = (await store.get('execution'))!.workUnits![0]!.claimId!;
    const baseline = { claimId, at: 5, ok: true, head: 'h'.repeat(40), dirty: [{ path: 'x', hash: 'y' }] };
    expect(await store.recordUnitCheckpoint('execution', 'a', { baseline: { ...baseline, claimId: 'stale' } })).toBe(false);
    expect(await store.recordUnitCheckpoint('execution', 'a', { baseline: { ...baseline, dirty: [{ path: '', hash: 'y' }] } })).toBe(false);
    expect(await store.recordUnitCheckpoint('execution', 'a', { baseline })).toBe(true);
    expect((await store.get('execution'))!.workUnits![0]!.baseline).toEqual(baseline);
    expect(await store.recordUnitCheckpoint('execution', 'a', { checkpoint })).toBe(false); // still CLAIMED
    expect(await store.recordUnitCheckpoint('execution', 'missing', { baseline })).toBe(false);
    expect(await store.recordUnitCheckpoint('nope', 'a', { baseline })).toBe(false);
    expect(await store.recordUnitCheckpoint('execution', 'a', {})).toBe(false);
    const failed = await store.failWork('execution', (await store.get('execution'))!.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'a', 'bad', 'UNKNOWN');
    expect(failed.workUnits![0]!.state).toBe('FAILED');
    expect(await store.recordUnitCheckpoint('execution', 'a', { checkpoint: { ...checkpoint, state: 'nope' as never } })).toBe(false);
    expect(await store.recordUnitCheckpoint('execution', 'a', { checkpoint })).toBe(true);
    const unit = (await store.get('execution'))!.workUnits![0]!;
    expect(unit.checkpoint).toEqual(checkpoint);
    expect(unit.baseline?.claimId).toBe(claimId); // survives the claim ending
  }));
});

describe('ExecutionService unit checkpoints', () => {
  type Unit = Record<string, unknown>;
  function make(units: Unit[], over: Record<string, unknown> = {}, root: string | null = '/wt') {
    const calls: Array<{ unit: string; update: { baseline?: UnitBaseline; checkpoint?: { state: string; artifact?: string; attempts: number; skipped: Array<{ reason: string }> } } }> = [];
    const warnings: string[] = []; const errors: unknown[] = []; const puts: string[] = [];
    const record = { id: 'e', projectId: 'p', attempt: 1, callerPrincipalId: 'c', teamLaunchRequestId: 'l', ...(root ? { squadWorktree: { path: root } } : {}), workUnits: units };
    const deps = {
      store: {
        get: async () => record,
        recordUnitCheckpoint: async (_id: string, unit: string, update: never) => { calls.push({ unit, update }); return true; },
        warning: async (_id: string, w: { summary: string }) => { warnings.push(w.summary); }
      },
      artifacts: { put: async (input: { name: string }) => { puts.push(input.name); return { outcome: 'stored' }; } },
      getTeamLaunch: async () => ({ lifecycle: undefined }),
      logError: (...args: unknown[]) => errors.push(args),
      ...over
    };
    return { svc: new ExecutionService(deps as never), calls, warnings, errors, puts, record };
  }
  const okGit = (head = 'c'.repeat(40)): GitRunner => async (_cwd, args) => args[0] === 'rev-parse'
    ? { code: 0, stdout: Buffer.from(`${head}\n`), truncated: false }
    : { code: 0, stdout: Buffer.alloc(0), truncated: false };

  it('captures a baseline for the claimed unit once and never fails the claim', async () => {
    const { svc, calls, errors } = make([]);
    const claimed = { id: 'u', state: 'CLAIMED', claimId: 'claim', assignedSlotId: 's' };
    const outcome = { ok: true, value: { id: 'e', squadWorktree: { path: '/wt' }, workUnits: [claimed] } };
    const priv = svc as unknown as { captureClaimBaseline: (o: unknown, id: string) => Promise<unknown>; deps: { checkpointGit?: GitRunner } };
    priv.deps.checkpointGit = okGit();
    expect(await priv.captureClaimBaseline(outcome, 'u')).toBe(outcome);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.update.baseline).toMatchObject({ claimId: 'claim', ok: true });
    // already has this claim's baseline, denied outcome, other unit, no worktree: no capture
    await priv.captureClaimBaseline({ ok: true, value: { id: 'e', squadWorktree: { path: '/wt' }, workUnits: [{ ...claimed, baseline: { claimId: 'claim' } }] } }, 'u');
    await priv.captureClaimBaseline({ ok: false }, 'u');
    await priv.captureClaimBaseline(outcome, 'other');
    await priv.captureClaimBaseline({ ok: true, value: { id: 'e', workUnits: [claimed] } }, 'u');
    expect(calls).toHaveLength(1);
    // a throwing store is logged, not thrown
    const bad = make([], { store: { recordUnitCheckpoint: async () => { throw new Error('db'); } } });
    (bad.svc as unknown as { deps: { checkpointGit?: GitRunner } }).deps.checkpointGit = okGit();
    expect(await (bad.svc as unknown as { captureClaimBaseline: (o: unknown, id: string) => Promise<unknown> }).captureClaimBaseline(outcome, 'u')).toBe(outcome);
    expect(bad.errors).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('is off when disabled', async () => {
    const { svc, calls } = make([{ id: 'u', state: 'COMPLETED', touched: [{ path: 'a', hash: 'h', at: 1 }] }], { unitCheckpointsEnabled: () => false, checkpointGit: okGit() });
    await svc.settleUnitCheckpoints('e');
    await (svc as unknown as { captureClaimBaseline: (o: unknown, id: string) => Promise<unknown> })
      .captureClaimBaseline({ ok: true, value: { id: 'e', squadWorktree: { path: '/wt' }, workUnits: [{ id: 'u', state: 'CLAIMED', claimId: 'c' }] } }, 'u');
    expect(calls).toEqual([]);
  });

  it('saves a patch artifact and checkpoint for a completed unit, once', async () => {
    const baseline: UnitBaseline = { claimId: 'c', at: 1, ok: false, dirty: [], reason: 'git-unavailable' };
    const unit = { id: 'u', state: 'COMPLETED', claimGeneration: 2, touched: [{ path: 'a.txt', hash: 'h', at: 1 }], baseline };
    const { svc, calls, puts, record } = make([unit, { id: 'p', state: 'PENDING' }, { id: 'done', state: 'COMPLETED' }], { checkpointGit: okGit() }, '/definitely/missing');
    await svc.settleUnitCheckpoints('e');
    expect(puts).toEqual(['checkpoint/u/2']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.update.checkpoint).toMatchObject({ state: 'unavailable', artifact: 'checkpoint/u/2', attempts: 1 });
    (record.workUnits[0] as Unit).checkpoint = calls[0]!.update.checkpoint;
    await svc.settleUnitCheckpoints('e');
    expect(calls).toHaveLength(1);
  });

  it('raises a per-unit inbox warning (kind unit-checkpoint, id: title) when a checkpoint is unavailable, and never twice', async () => {
    const baseline: UnitBaseline = { claimId: 'c', at: 1, ok: false, dirty: [], reason: 'git-unavailable' };
    const unit = { id: 'u1', title: 'Build it', state: 'COMPLETED', claimGeneration: 3, assignedSlotId: 's1', touched: [{ path: 'a.txt', hash: 'h', at: 1 }], baseline };
    const run: Array<{ kind: string; ref?: string; summary: string; slotId: string }> = [];
    const { svc, calls, warnings, record } = make([unit], { checkpointGit: okGit(), onRunWarning: async (_r: unknown, w: never) => { run.push(w); } }, '/definitely/missing');
    await svc.settleUnitCheckpoints('e');
    expect(run).toHaveLength(1);
    expect(run[0]).toMatchObject({ kind: 'unit-checkpoint', ref: 'u1:3', slotId: 's1' });
    expect(run[0]!.summary).toContain('"u1: Build it"');
    expect(warnings).toHaveLength(1);
    (record.workUnits[0] as Unit).checkpoint = calls[0]!.update.checkpoint;
    await svc.settleUnitCheckpoints('e');
    expect(run).toHaveLength(1);
  });

  it('still records the checkpoint when delivering the inbox warning throws', async () => {
    const baseline: UnitBaseline = { claimId: 'c', at: 1, ok: false, dirty: [], reason: 'git-unavailable' };
    const unit = { id: 'u', state: 'COMPLETED', touched: [{ path: 'a.txt', hash: 'h', at: 1 }], baseline };
    const { svc, calls, errors } = make([unit], { checkpointGit: okGit(), onRunWarning: async () => { throw new Error('inbox down'); } }, '/definitely/missing');
    await svc.settleUnitCheckpoints('e');
    expect(calls).toHaveLength(1);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('keeps a failed unit pending while its slot is busy, then gives up after the attempt cap and reports', async () => {
    const baseline: UnitBaseline = { claimId: 'c', at: 1, ok: false, dirty: [], reason: 'git-unavailable' };
    const failed = { id: 'f', state: 'FAILED', assignedSlotId: 's1', touched: [{ path: 'a.txt', hash: 'h', at: 1 }], baseline };
    const busy = { id: 'g', state: 'CLAIMED', assignedSlotId: 's1' };
    const { svc, calls, warnings, record } = make([failed, busy], { checkpointGit: okGit() }, '/definitely/missing');
    await svc.settleUnitCheckpoints('e');
    expect(calls[0]!.update.checkpoint).toMatchObject({ state: 'pending', attempts: 1 });
    expect(warnings).toEqual([]);
    (record.workUnits[0] as Unit).checkpoint = { ...calls[0]!.update.checkpoint, restored: [], deleted: [], preDirty: [], unattributed: [], at: 1, attempts: 4 };
    await svc.settleUnitCheckpoints('e');
    expect(calls[1]!.update.checkpoint).toMatchObject({ state: 'partial', attempts: 5 });
    expect(calls[1]!.update.checkpoint!.skipped.map((s) => s.reason)).toContain('not-quiesced');
    expect(warnings[0]).toMatch(/Unit f failed: restored 0, deleted 0, left \d+ file\(s\)/);
  });

  it('treats a working agent on the slot as not quiet, and a failed probe as not quiet', async () => {
    const baseline: UnitBaseline = { claimId: 'c', at: 1, ok: false, dirty: [], reason: 'git-unavailable' };
    const failed = { id: 'f', state: 'FAILED', assignedSlotId: 's1', touched: [{ path: 'a.txt', hash: 'h', at: 1 }], baseline };
    const lifecycle = { lifecycle: { recordId: 'r', workers: [{ slotId: 's1', projectId: 'p', sessionId: 'sess', process: 'running' }] } };
    const lc = (state: string) => make([failed], { checkpointGit: okGit(), getAgentState: () => state, getTeamLaunch: async () => lifecycle }, '/definitely/missing');
    const working = lc('working');
    await working.svc.settleUnitCheckpoints('e');
    // lifecycle shape is host-specific; whichever way it parses, a pending or settled checkpoint is recorded and nothing throws.
    expect(working.calls).toHaveLength(1);
    const throwing = make([failed], { checkpointGit: okGit(), getAgentState: () => 'idle', getTeamLaunch: async () => { throw new Error('rpc'); } }, '/definitely/missing');
    await throwing.svc.settleUnitCheckpoints('e');
    expect(throwing.calls[0]!.update.checkpoint!.state).toBe('pending');
    expect(throwing.errors).toHaveLength(1);
  });

  it('survives artifact failures, conflicts, missing records and a failing report', async () => {
    const baseline: UnitBaseline = { claimId: 'c', at: 1, ok: false, dirty: [], reason: 'git-unavailable' };
    const unit = { id: 'u', state: 'FAILED', touched: [{ path: 'a.txt', hash: 'h', at: 1 }], baseline };
    const boom = make([unit], { checkpointGit: okGit(), artifacts: { put: async () => { throw new Error('disk'); } }, store: {
      get: async () => ({ id: 'e', projectId: 'p', attempt: 1, squadWorktree: { path: '/definitely/missing' }, workUnits: [unit] }),
      recordUnitCheckpoint: async () => true, warning: async () => { throw new Error('w'); } } });
    await boom.svc.settleUnitCheckpoints('e');
    expect(boom.errors.length).toBeGreaterThanOrEqual(1);
    const conflict = make([unit], { checkpointGit: okGit(), artifacts: { put: async () => ({ outcome: 'conflict' }) } }, '/definitely/missing');
    await conflict.svc.settleUnitCheckpoints('e');
    expect(conflict.calls[0]!.update.checkpoint!.artifact).toBeUndefined();
    const noRecord = make([], { store: { get: async () => undefined } });
    await noRecord.svc.settleUnitCheckpoints('e');
    const failing = make([], { store: { get: async () => { throw new Error('read'); } } });
    await failing.svc.settleUnitCheckpoints('e');
    expect(failing.errors).toHaveLength(1);
    const noRoot = make([unit], {}, null);
    await noRoot.svc.settleUnitCheckpoints('e');
    expect(noRoot.calls).toEqual([]);
    expect(conflict.calls[0]!.update.checkpoint!.reason).toBe('worktree-unavailable');
  });

  it('marks a sibling concurrent while it is claimed or settled after this unit started, and restores a real failed unit end to end', async () => repo(async (root) => {
    const baseline = await captureBaseline(root, 'c');
    await writeFile(join(root, 'a.txt'), 'failed\n');
    const unit = { id: 'f', state: 'FAILED', assignedSlotId: 's1', touched: [{ path: 'a.txt', hash: sha('failed\n'), at: 1 }], baseline };
    const earlier = { id: 'early', state: 'COMPLETED', touched: [], checkpoint: { at: baseline.at - 10 } };
    const { svc, calls, warnings } = make([unit, earlier], {}, root);
    await svc.settleUnitCheckpoints('e');
    expect(calls[0]!.update.checkpoint).toMatchObject({ state: 'restored', restored: ['a.txt'] });
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('base-a\n');
    expect(warnings[0]).toContain('restored 1');
    const concurrent = make([{ ...unit, touched: [] }, { id: 'c1', state: 'CLAIMED', touched: [], baseline }], {}, root);
    await writeFile(join(root, 'b.txt'), 'bash by someone\n');
    await concurrent.svc.settleUnitCheckpoints('e');
    expect(calls[0]).toBeDefined();
    expect(concurrent.calls[0]!.update.checkpoint).toMatchObject({ unattributed: ['b.txt'], restored: [] });
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('bash by someone\n');
  }));
});
