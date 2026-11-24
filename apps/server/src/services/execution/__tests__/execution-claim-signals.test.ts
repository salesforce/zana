import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createExecutionStore, MAX_CLAIM_TOUCHED_PATHS } from '../store.js';
import { claimWritePath, confineAndHashClaimWrite, ExecutionService } from '../service.js';

// Per-claim signals (lastTurnAt, touched paths) come only from the claim's own worker events.

async function tmp(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-claim-signals-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function twoClaims(filePath: string, clock: { t: number }) {
  const store = createExecutionStore({ filePath, id: () => 'execution', now: () => clock.t });
  let record = (await store.claim({ callerPrincipalId: 's', projectId: 'p', teamId: 't', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [], request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] } })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 's');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'r');
  const slots = ['engineer:0', 'engineer:1'];
  record = await store.setAuthorizationContext(record.id, record.stateVersion, { version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
    { slotId: 'orchestrator', personaId: 'lead', authorizationIdDigest: 'o' }, ...slots.map((slotId) => ({ slotId, personaId: 'engineer', authorizationIdDigest: slotId }))] }, 'digest');
  record = await store.replaceResolvedModels(record.id, slots.map((slotId) => ({ slotId, personaId: 'engineer', provider: 'anthropic', model: 'm' })));
  record = await store.registerPlan(record.id, record.stateVersion, ['a', 'b'].map((id) => ({ id, title: id, task: 'work', dependencies: [], readOnly: true })));
  record = await store.claimWork('execution', record.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'a');
  record = await store.claimWork('execution', record.stateVersion, { role: 'worker', slotId: 'engineer:1' }, 'b');
  return { store };
}
const unitOf = async (store: Awaited<ReturnType<typeof twoClaims>>['store'], id: string) => (await store.get('execution'))!.workUnits!.find((u) => u.id === id)!;

describe('store.recordClaimSignal', () => {
  it('records only the signalled claim; a sibling write never affects the other claim', async () => tmp(async (dir) => {
    const clock = { t: 1_000 };
    const { store } = await twoClaims(join(dir, 'e.json'), clock);
    clock.t = 2_000;
    expect(await store.recordClaimSignal('execution', 'engineer:0', { writes: [{ path: 'src/a.ts', hash: 'h1' }], turn: true })).toBe(true);
    const a = await unitOf(store, 'a'); const b = await unitOf(store, 'b');
    expect(a.touched).toEqual([{ path: 'src/a.ts', hash: 'h1', at: 2_000 }]);
    expect(a.lastTurnAt).toBe(2_000);
    expect(b.touched).toBeUndefined();
    expect(b.lastTurnAt).toBeUndefined();
    expect(b.progressAt).toBe(1_000); // signals never advance the stall clock
    clock.t = 3_000;
    await store.recordClaimSignal('execution', 'engineer:1', { writes: [{ path: 'src/a.ts', hash: 'other' }] });
    expect((await unitOf(store, 'a')).touched![0].hash).toBe('h1');
    expect((await unitOf(store, 'b')).touched).toEqual([{ path: 'src/a.ts', hash: 'other', at: 3_000 }]);
  }));

  it('keeps the last hash per path, ignores unchanged writes, caps the set, and survives reload', async () => tmp(async (dir) => {
    const clock = { t: 1_000 };
    const filePath = join(dir, 'e.json');
    const { store } = await twoClaims(filePath, clock);
    await store.recordClaimSignal('execution', 'engineer:0', { writes: [{ path: 'f', hash: 'h1' }] });
    const version = (await store.get('execution'))!.stateVersion;
    expect(await store.recordClaimSignal('execution', 'engineer:0', { writes: [{ path: 'f', hash: 'h1' }] })).toBe(false);
    expect((await store.get('execution'))!.stateVersion).toBe(version);
    clock.t = 2_000;
    await store.recordClaimSignal('execution', 'engineer:0', { writes: [{ path: 'f', hash: 'h2' }] });
    expect((await unitOf(store, 'a')).touched).toEqual([{ path: 'f', hash: 'h2', at: 2_000 }]);
    const many = Array.from({ length: MAX_CLAIM_TOUCHED_PATHS + 20 }, (_, i) => ({ path: `p${i}`, hash: 'h' }));
    await store.recordClaimSignal('execution', 'engineer:0', { writes: [...many, { path: 'x'.repeat(2_000), hash: 'h' }, { path: 'ok', hash: '' }] });
    const a = await unitOf(store, 'a');
    expect(a.touched).toHaveLength(MAX_CLAIM_TOUCHED_PATHS);
    expect(a.touchedTruncated).toBe(true);
    const reloaded = createExecutionStore({ filePath, id: () => 'execution', now: () => clock.t });
    const again = (await reloaded.get('execution'))!.workUnits!.find((u) => u.id === 'a')!;
    expect(again.touched).toHaveLength(MAX_CLAIM_TOUCHED_PATHS);
    expect(again.touchedTruncated).toBe(true);
  }));

  it('drops a late event once the claim ended and resets at the next claim; old records without the fields load', async () => tmp(async (dir) => {
    const clock = { t: 1_000 };
    const filePath = join(dir, 'e.json');
    const { store } = await twoClaims(filePath, clock);
    expect(await store.recordClaimSignal('execution', 'engineer:9', { turn: true })).toBe(false);
    expect(await store.recordClaimSignal('missing', 'engineer:0', { turn: true })).toBe(false);
    await store.recordClaimSignal('execution', 'engineer:0', { writes: [{ path: 'f', hash: 'h' }], turn: true });
    const a = await unitOf(store, 'a');
    const reclaimed = await store.reclaimExpiredClaims('execution', [{ workUnitId: 'a', claimId: a.claimId!, claimGeneration: a.claimGeneration!, reason: 'SILENT' as never, force: true }]);
    const after = reclaimed.workUnits!.find((u) => u.id === 'a')!;
    expect(after.lastTurnAt).toBeUndefined();
    expect(after.touched).toEqual([expect.objectContaining({ path: 'f', hash: 'h' })]); // kept for checkpoints
    expect(await store.recordClaimSignal('execution', 'engineer:0', { writes: [{ path: 'g', hash: 'h' }] })).toBe(false);
    const fresh = await store.claimWork('execution', reclaimed.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'a');
    expect(fresh.workUnits!.find((u) => u.id === 'a')!.touched).toBeUndefined();
    // turn heartbeat advancing turnCount stamps lastTurnAt
    const b = await unitOf(store, 'b');
    clock.t = 5_000;
    await store.heartbeatWork('execution', (await store.get('execution'))!.stateVersion, { role: 'worker', slotId: 'engineer:1' }, 'b', { claimId: b.claimId!, claimGeneration: b.claimGeneration!, turnCount: 1 });
    expect((await unitOf(store, 'b')).lastTurnAt).toBe(5_000);
  }));
});

describe('claimWritePath', () => {
  it('reads file_path for write tools and notebook_path for NotebookEdit only', () => {
    expect(claimWritePath('Write', { file_path: '/w/a.ts' })).toBe('/w/a.ts');
    expect(claimWritePath('MultiEdit', { file_path: 'a.ts' })).toBe('a.ts');
    expect(claimWritePath('NotebookEdit', { notebook_path: 'n.ipynb', file_path: 'x' })).toBe('n.ipynb');
    expect(claimWritePath('Read', { file_path: '/w/a.ts' })).toBeUndefined();
    expect(claimWritePath('Write', null)).toBeUndefined();
    expect(claimWritePath('Write', { file_path: 'a\0b' })).toBeUndefined();
    expect(claimWritePath('Write', { file_path: 3 })).toBeUndefined();
    expect(claimWritePath(7, {})).toBeUndefined();
  });
});

describe('confineAndHashClaimWrite', () => {
  it('hashes a file inside the worktree and returns a relative POSIX path', async () => tmp(async (dir) => {
    const root = join(dir, 'wt'); await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'hello');
    expect(await confineAndHashClaimWrite(root, undefined, join(root, 'src', 'a.ts'))).toEqual({ path: 'src/a.ts', hash: sha('hello') });
    expect(await confineAndHashClaimWrite(root, undefined, 'src/a.ts')).toEqual({ path: 'src/a.ts', hash: sha('hello') });
    expect(await confineAndHashClaimWrite(root, join(root, 'src'), 'a.ts')).toEqual({ path: 'src/a.ts', hash: sha('hello') });
  }));

  it('rejects traversal, outside paths, symlink escapes, directories and missing files', async () => tmp(async (dir) => {
    const root = join(dir, 'wt'); const outside = join(dir, 'out');
    await mkdir(root); await mkdir(outside);
    await writeFile(join(outside, 's.txt'), 'secret');
    await symlink(outside, join(root, 'link'));
    await mkdir(join(root, 'sub'));
    expect(await confineAndHashClaimWrite(root, undefined, '../out/s.txt')).toBeUndefined();
    expect(await confineAndHashClaimWrite(root, undefined, join(outside, 's.txt'))).toBeUndefined();
    expect(await confineAndHashClaimWrite(root, undefined, join(root, 'link', 's.txt'))).toBeUndefined();
    expect(await confineAndHashClaimWrite(root, undefined, join(root, 'sub'))).toBeUndefined();
    expect(await confineAndHashClaimWrite(root, undefined, root)).toBeUndefined();
    expect(await confineAndHashClaimWrite(root, undefined, join(root, 'nope.txt'))).toBeUndefined();
    expect(await confineAndHashClaimWrite(join(dir, 'missing-root'), undefined, 'a')).toBeUndefined();
  }));
});

describe('ExecutionService worker signals', () => {
  function service(root: string | undefined, record: 'ok' | 'throw' = 'ok') {
    const calls: unknown[] = []; const errors: unknown[] = [];
    const deps = {
      store: {
        get: async () => (root === undefined ? { id: 'e' } : { id: 'e', squadWorktree: { path: root } }),
        recordClaimSignal: async (...args: unknown[]) => { calls.push(args); if (record === 'throw') throw new Error('boom'); return true; }
      },
      logError: (...args: unknown[]) => errors.push(args)
    };
    return { svc: new ExecutionService(deps as never), calls, errors };
  }
  const vi_record = 'ok';

  it('records a confined write and a turn; skips failed, non-write and unconfined events', async () => tmp(async (dir) => {
    const root = join(dir, 'wt'); await mkdir(root); await writeFile(join(root, 'a.ts'), 'x');
    const { svc, calls } = service(root);
    await svc.recordWorkerToolEvent('e', 'engineer:0', { toolName: 'Edit', input: { file_path: join(root, 'a.ts') } });
    await svc.recordWorkerToolEvent('e', 'engineer:0', { toolName: 'Edit', input: { file_path: join(root, 'a.ts') }, failed: true });
    await svc.recordWorkerToolEvent('e', 'engineer:0', { toolName: 'Bash', input: { command: 'ls' } });
    await svc.recordWorkerToolEvent('e', 'engineer:0', { toolName: 'Write', input: { file_path: join(dir, 'elsewhere') } });
    await svc.recordWorkerTurn('e', 'engineer:0');
    expect(calls).toEqual([
      ['e', 'engineer:0', { writes: [{ path: 'a.ts', hash: sha('x') }] }],
      ['e', 'engineer:0', { turn: true }]
    ]);
  }));

  it('does nothing without a worktree and never throws on store failure', async () => {
    const none = service(undefined);
    await none.svc.recordWorkerToolEvent('e', 's', { toolName: 'Write', input: { file_path: '/x' } });
    expect(none.calls).toEqual([]);
    const bad = service('/tmp', 'throw');
    await bad.svc.recordWorkerTurn('e', 's');
    expect(bad.errors).toHaveLength(1);
  });
});
