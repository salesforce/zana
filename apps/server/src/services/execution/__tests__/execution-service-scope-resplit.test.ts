import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_BLOCKER_ANSWER_BYTES, SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// Scope resplit: an owner answer that names files outside a unit's scope is split into a child unit.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-scope-resplit-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }] };
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
function build(filePath: string, clock: { t: number }, slots: string[], enforce = true) {
  const now = () => clock.t;
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const replyToSession = vi.fn(() => true);
  const workers = slots.map((slotId) => ({ slotId, personaId: 'engineer' }));
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
        ...workers.map((w) => ({ ...w, authorizationIdDigest: `${w.slotId}-d` }))
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: workers.map((w) => ({ slotId: w.slotId, sessionId: `session-${w.slotId}`, projectId: 'project-1' })) }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    resolveTeamModelSnapshots: () => workers.map((w) => ({ ...w, provider: 'anthropic', model: 'm', level: 'high' })),
    replyToSession, now, inbox: { append: vi.fn(async () => undefined) }, logError: vi.fn(),
    claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => enforce,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? []
  } as never);
  return { service, store };
}

const unitA = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['apps/app/src/a.tsx'], verification: ['check a'], routing: { version: 1 as const, requiredRole: 'engineer', minimumLevel: 'low' as const } };
const unitB = { id: 'b', title: 'B', task: 'do b', dependencies: ['a'], files: ['apps/app/src/b.tsx'], verification: ['check b'], routing: { version: 1 as const, requiredRole: 'engineer' } };
const worker = (slotId: string) => ({ executionId: 'execution-1', projectId: 'project-1', slotId, role: 'worker' as const });

async function startBlocked(service: SquadExecutionService, units = [unitA, unitB]) {
  const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: units } as never);
  if (!started.ok) throw new Error(started.message);
  await service.dispatchReady(coordinator);
  const blocked = await service.blockWork(worker('engineer:0'), 'a', { id: 'blk-1', question: 'Which contract?' });
  if (!blocked.ok) throw new Error(JSON.stringify(blocked));
}
const answer = (service: SquadExecutionService, text: string, scopeSplit?: 'split' | 'keep', requestId = 'req-1') =>
  service.respondToHumanBlockerAsOwner('owner', 'project-1', 'execution-1', undefined, 'blk-1', requestId, text, scopeSplit);
const E5 = 'Also change apps/server/src/conflicts.ts so the API contract returns the merge base; keep apps/app/src/a.tsx as is.';

describe('scope re-split on owner blocker answers', () => {
  it('splits a widening answer into a routed child, re-links dependents, and tells the worker', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const result = await answer(service, E5);
    expect(result).toMatchObject({ ok: true, splitChildId: 'a-split-1' });
    const record = (await store.get('execution-1'))!;
    const [a, b] = [record.workUnits![0], record.workUnits![1]];
    const child = record.workUnits!.find((unit) => unit.id === 'a-split-1')!;
    expect(a).toMatchObject({ id: 'a', state: 'BLOCKED', files: ['apps/app/src/a.tsx'], splitChildren: ['a-split-1'] });
    expect(child).toMatchObject({ files: ['apps/server/src/conflicts.ts'], splitFrom: { parentId: 'a', blockerId: 'blk-1' } });
    expect(child.routing).toMatchObject({ requiredRole: 'engineer', minimumLevel: 'medium' });
    expect(['READY', 'CLAIMED']).toContain(child.state);
    expect(b.dependencies).toEqual(['a', 'a-split-1']);
    expect(b.state).toBe('PENDING');
    const delivery = record.deliveries!.at(-1)!;
    expect(delivery.payload.text).toContain(E5);
    expect(delivery.payload.text).toContain('[Zana scope split]');
    expect(delivery.payload.text).toContain('a-split-1');
  }));

  it('is idempotent on a retried request and does not split twice', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    await answer(service, E5);
    const again = await answer(service, E5);
    expect(again.ok).toBe(true);
    expect((await store.get('execution-1'))!.workUnits!.filter((unit) => unit.splitFrom)).toHaveLength(1);
  }));

  it('does not split a non-widening answer', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const result = await answer(service, 'Use option B, editing apps/app/src/a.tsx only.');
    expect(result.ok).toBe(true);
    const record = (await store.get('execution-1'))!;
    expect(record.workUnits).toHaveLength(2);
    expect(record.workUnits![1].dependencies).toEqual(['a']);
    expect(record.deliveries!.at(-1)!.payload.text).not.toContain('scope split');
  }));

  it('lets the owner keep a widening answer unsplit', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    expect((await answer(service, E5, 'keep')).ok).toBe(true);
    expect((await store.get('execution-1'))!.workUnits).toHaveLength(2);
  }));

  it('asks the owner to confirm when only a contract is mentioned, delivering nothing', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const asked = await answer(service, 'The API contract needs one more field.');
    expect(asked).toMatchObject({ ok: false, code: 'CONFIRM_SPLIT' });
    expect((await store.get('execution-1'))!.deliveries ?? []).toHaveLength(0);
    const forced = await answer(service, 'The API contract needs one more field.', 'split');
    expect(forced).toMatchObject({ ok: false, code: 'CONFIRM_SPLIT' });
    const kept = await answer(service, 'The API contract needs one more field.', 'keep');
    expect(kept.ok).toBe(true);
  }));

  it('rejects an oversized answer plus note and leaves the plan untouched', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const big = `${E5} ${'x'.repeat(16 * 1024 - E5.length - 20)}`;
    const result = await answer(service, big);
    expect(result).toMatchObject({ ok: false, code: 'CONFIRM_SPLIT' });
    expect((await store.get('execution-1'))!.workUnits).toHaveLength(2);
  }));

  it('names every added file on one child and picks the next free id', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const result = await answer(service, `${E5} and apps/server/src/other.ts`);
    expect(result.ok).toBe(true);
    expect((await store.get('execution-1'))!.workUnits!.find((unit) => unit.splitFrom)!.files).toEqual(['apps/server/src/conflicts.ts', 'apps/server/src/other.ts']);
  }));

  it('keeps registerPlan idempotent after a split', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    await answer(service, E5);
    const record = (await store.get('execution-1'))!;
    const registered = await store.registerPlan('execution-1', record.stateVersion, [unitA, unitB] as never);
    expect(registered.workUnits).toHaveLength(3);
  }));

  it('ignores a coordinator-audience blocker and answers through the engine unchanged', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [unitA, unitB] } as never);
    if (!started.ok) throw new Error(started.message);
    await service.dispatchReady(coordinator);
    await service.blockWork(worker('engineer:0'), 'a', { id: 'blk-1', question: 'q', audience: 'coordinator' });
    const denied = await answer(service, E5);
    expect(denied).toMatchObject({ ok: false, code: 'DENIED' });
    expect((await store.get('execution-1'))!.workUnits).toHaveLength(2);
  }));

  it('persists neither child nor delivery when the store rejects an invalid child', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const version = (await store.get('execution-1'))!.stateVersion;
    const base = { clientRequestId: 'direct', blockerId: 'blk-1', text: 'x' };
    // mutating child without file scope, a duplicate id, and a child depending on a missing unit
    await expect(store.enqueueBlockerDelivery('execution-1', version, { ...base, split: { child: { id: 'c1', title: 'c', task: 't', dependencies: [], verification: ['v'] } } })).rejects.toThrow();
    await expect(store.enqueueBlockerDelivery('execution-1', version, { ...base, split: { child: { ...unitB, id: 'b', files: ['z.ts'] } } })).rejects.toThrow('split unit id already exists');
    await expect(store.enqueueBlockerDelivery('execution-1', version, { ...base, split: { child: { ...unitB, id: 'c3', dependencies: ['ghost'], files: ['z.ts'] } } })).rejects.toThrow();
    const after = (await store.get('execution-1'))!;
    expect(after.stateVersion).toBe(version);
    expect(after.workUnits).toHaveLength(2);
    expect(after.deliveries ?? []).toHaveLength(0);
  }));

  it('does not plan a split once the blocked unit has already finished', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const original = store.get.bind(store);
    const record = (await original('execution-1'))!;
    record.workUnits![0].state = 'FAILED';
    const spy = vi.spyOn(store, 'enqueueBlockerDelivery');
    const result = await (service as any).enqueueOwnedBlocker(record, record.stateVersion, record.blockers![0], 'late', E5, false, 'auto');
    expect(result.ok).toBe(true);
    expect(spy.mock.calls[0][2]).not.toHaveProperty('split');
  }));
});

describe('scope re-split on non-owner (Inbox / board) blocker answers', () => {
  const respond = (service: SquadExecutionService, text: string, requestId = 'req-n1') =>
    service.respondToBlocker('owner', 'project-1', 'execution-1', 0, 'blk-1', requestId, text);
  const stateVersion = async (store: ReturnType<typeof build>['store']) => (await store.get('execution-1'))!.stateVersion;

  it('splits a widening answer the same way as the owner-agent path', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const result = await service.respondToBlocker('owner', 'project-1', 'execution-1', await stateVersion(store), 'blk-1', 'req-n1', E5);
    expect(result).toMatchObject({ ok: true, splitChildId: 'a-split-1' });
    const record = (await store.get('execution-1'))!;
    expect(record.workUnits!.find((unit) => unit.id === 'a-split-1')).toMatchObject({ files: ['apps/server/src/conflicts.ts'] });
    expect(record.deliveries!.at(-1)!.payload.text).toContain('[Zana scope split]');
  }));

  it('delivers an undecidable (contract-only) answer unchanged instead of refusing', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const result = await service.respondToBlocker('owner', 'project-1', 'execution-1', await stateVersion(store), 'blk-1', 'req-n2', 'Change the API contract schema as you see fit.');
    expect(result.ok).toBe(true);
    expect((await store.get('execution-1'))!.workUnits).toHaveLength(2);
  }));

  it('delivers unchanged when the answer plus split note would exceed the byte cap', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const big = `Also change apps/server/src/conflicts.ts. ${'x'.repeat(MAX_BLOCKER_ANSWER_BYTES - 60)}`;
    const result = await service.respondToBlocker('owner', 'project-1', 'execution-1', await stateVersion(store), 'blk-1', 'req-n3', big);
    expect(result.ok).toBe(true);
    expect((await store.get('execution-1'))!.workUnits).toHaveLength(2);
  }));

  it('splits a widening answer delivered through the slot-addressed path', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const result = await service.respondToSlotAsOwner('owner', 'project-1', 'execution-1', await stateVersion(store), 'engineer:0', E5);
    expect(result).toMatchObject({ ok: true, splitChildId: 'a-split-1' });
    expect((await store.get('execution-1'))!.workUnits!.some((unit) => unit.id === 'a-split-1')).toBe(true);
  }));

  it('slot-addressed answers that do not widen, or only mention a contract, are delivered unchanged', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const result = await service.respondToSlotAsOwner('owner', 'project-1', 'execution-1', await stateVersion(store), 'engineer:0', 'Use the existing API contract schema.');
    expect(result.ok).toBe(true);
    expect((await store.get('execution-1'))!.workUnits).toHaveLength(2);
  }));

  it('does not split a coordinator-audience blocker answered by the coordinator', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [unitA, unitB] } as never);
    if (!started.ok) throw new Error(started.message);
    await service.dispatchReady(coordinator);
    await service.blockWork(worker('engineer:0'), 'a', { id: 'blk-1', question: 'q', audience: 'coordinator' });
    const result = await service.answerBlockerByCoordinator(coordinator, 'blk-1', E5);
    expect(result.ok).toBe(true);
    expect((await store.get('execution-1'))!.workUnits).toHaveLength(2);
  }));

  it('keeps the coordinator-audience guard and the replay guard', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0', 'engineer:1']);
    await startBlocked(service);
    const version = await stateVersion(store);
    const first = await service.respondToBlocker('owner', 'project-1', 'execution-1', version, 'blk-1', 'req-n4', E5);
    expect(first).toMatchObject({ ok: true, splitChildId: 'a-split-1' });
    const replay = await service.respondToBlocker('owner', 'project-1', 'execution-1', version, 'blk-1', 'req-n4', E5);
    expect((await store.get('execution-1'))!.workUnits!.filter((unit) => unit.id.startsWith('a-split'))).toHaveLength(1);
    // Same request id: idempotent success carrying the original delivery, no second child.
    expect(replay).toMatchObject({ ok: true, delivery: { clientRequestId: 'req-n4', blockerId: 'blk-1' } });
    expect(replay).not.toHaveProperty('splitChildId', 'a-split-2');
  }));
});

