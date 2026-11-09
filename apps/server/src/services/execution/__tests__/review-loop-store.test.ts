import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, type ExecutionRecord, type ExecutionWorkUnitInput } from '../store.js';
import { LOOP_VERDICT_OUTPUT } from '../contracts.js';
import { SquadExecutionService, assignmentText } from '../service.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// #583 review loop engine in the store: REQ-1, REQ-4..REQ-9, REQ-11.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-review-loop-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const worker = { role: 'worker' as const, slotId: 'worker-1' };
const lead = { role: 'orchestrator' as const, slotId: 'lead' };

const plan = (max = 2, withLoop = true): ExecutionWorkUnitInput[] => [
  { id: 'r', title: 'Review', task: 'Review', dependencies: [], readOnly: true, ...(withLoop ? { loop: { version: 1 as const, fixUnitId: 'f', until: 'PASS' as const, max }, output: LOOP_VERDICT_OUTPUT } : {}) },
  { id: 'f', title: 'Fix', task: 'Fix', dependencies: ['r'], readOnly: true },
  { id: 'a', title: 'Accept', task: 'Accept', dependencies: ['f'], readOnly: true }
];

async function start(filePath: string, units: ExecutionWorkUnitInput[]) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  let record = (await store.claim({
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Loop', requestDigest: 'd', launchRequestId: 'l', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] }
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.registerPlan(record.id, record.stateVersion, units);
  return { store, id: record.id };
}

type Store = ReturnType<typeof createExecutionStore>;
const unitOf = (record: ExecutionRecord, id: string) => record.workUnits!.find((u) => u.id === id)!;

/** Claim `id` and return the claim fence the worker would hold. */
async function claim(store: Store, id: string, unitId: string) {
  const rec = (await store.get(id))!;
  const claimed = await store.claimWork(id, rec.stateVersion, worker, unitId);
  const u = unitOf(claimed, unitId);
  return { claimId: u.claimId!, claimGeneration: u.claimGeneration! };
}
async function complete(store: Store, id: string, unitId: string, structured?: unknown, fence?: { claimId: string; claimGeneration: number }) {
  const held = fence ?? await claim(store, id, unitId);
  const rec = (await store.get(id))!;
  return store.completeWork(id, rec.stateVersion, worker, unitId, `${unitId} result`, held, true, structured);
}

describe('REQ-1 no Loop: engine unchanged', () => {
  it('a unit without loop completes with a plain result and releases its dependant as today', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(2, false));
    const rec = await complete(store, id, 'r');
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'COMPLETED' });
    expect(unitOf(rec, 'f').state).toBe('READY');
    expect(unitOf(rec, 'r').loopRound).toBeUndefined();
    expect(unitOf(rec, 'f').history.some((h) => h.action === 'reopened')).toBe(false);
  }));

  it('re-registering the same plan is idempotent, with and without loop', async () => fixture(async (filePath) => {
    for (const withLoop of [false, true]) {
      const { store, id } = await start(`${filePath}.${withLoop}`, plan(2, withLoop));
      const rec = (await store.get(id))!;
      await expect(store.registerPlan(id, rec.stateVersion, plan(2, withLoop))).resolves.toBeDefined();
    }
  }));
});

describe('REQ-4 verdict required', () => {
  it.each([[undefined], [{}], [{ verdict: 'MAYBE' }]])('the store refuses a loop review completion with verdict %j', async (structured) => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan());
    await expect(complete(store, id, 'r', structured)).rejects.toThrow(/PASS or CHANGES/);
    expect(unitOf((await store.get(id))!, 'r').state).toBe('CLAIMED');
  }));
});

describe('REQ-5 PASS in round 1', () => {
  it('completes the never-run fix unit as not needed and releases the dependant', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan());
    const rec = await complete(store, id, 'r', { verdict: 'PASS' });
    expect(unitOf(rec, 'r').state).toBe('COMPLETED');
    expect(unitOf(rec, 'f')).toMatchObject({ state: 'COMPLETED', result: 'Not needed: r passed' });
    expect(unitOf(rec, 'f').history.at(-1)).toMatchObject({ action: 'completed' });
    expect(unitOf(rec, 'a').state).toBe('READY');
  }));
});

describe('REQ-6 CHANGES then fix reopens the review', () => {
  it('readies the fix unit, then reopens the review in round 2 when the fix completes', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(3));
    let rec = await complete(store, id, 'r', { verdict: 'CHANGES' });
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'COMPLETED', loopRound: 1 });
    expect(unitOf(rec, 'f').state).toBe('READY');

    rec = await complete(store, id, 'f');
    const review = unitOf(rec, 'r');
    expect(review).toMatchObject({ state: 'READY', loopRound: 2 });
    expect(review.structuredResult).toBeUndefined();
    expect(review.claimId).toBeUndefined();
    expect(review.history.at(-1)).toMatchObject({ action: 'reopened' });
    expect(unitOf(rec, 'f').state).toBe('COMPLETED');
  }));

  it('puts the fix unit result in the reopened review assignment', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(3));
    await complete(store, id, 'r', { verdict: 'CHANGES' });
    await complete(store, id, 'f');
    const rec = (await store.get(id))!;
    const text = assignmentText(rec, { workUnitId: 'r', slotId: 'worker-1', title: 'Review', task: 'Review' });
    expect(text).toContain('f result');
  }));

  it('round 2 PASS keeps the already-run fix unit untouched and releases the dependant', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(3));
    await complete(store, id, 'r', { verdict: 'CHANGES' });
    await complete(store, id, 'f');
    expect(unitOf((await store.get(id))!, 'r').loopRound).toBe(2);
    const rec = await complete(store, id, 'r', { verdict: 'PASS' });
    expect(unitOf(rec, 'r').loopRound).toBe(2);
    expect(unitOf(rec, 'f').result).toBe('f result');
    expect(unitOf(rec, 'a').state).toBe('READY');
  }));

  it('round 2 CHANGES below the bound reopens the fix unit as READY with a reopened entry', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(3));
    await complete(store, id, 'r', { verdict: 'CHANGES' });
    await complete(store, id, 'f');
    const rec = await complete(store, id, 'r', { verdict: 'CHANGES' });
    expect(unitOf(rec, 'f')).toMatchObject({ state: 'READY' });
    expect(unitOf(rec, 'f').history.some((h) => h.action === 'reopened')).toBe(true);
  }));
});

describe('REQ-7 stale round refused', () => {
  it('refuses a completion carrying the earlier round claim, before and after the reopened review is claimed again', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(3));
    const round1 = await claim(store, id, 'r');
    await complete(store, id, 'r', { verdict: 'CHANGES' }, round1);
    await complete(store, id, 'f');
    let rec = (await store.get(id))!;
    await expect(store.completeWork(id, rec.stateVersion, worker, 'r', 'late', round1, true, { verdict: 'PASS' })).rejects.toThrow(/not claimed|stale work claim/);
    const round2 = await claim(store, id, 'r');
    expect(round2.claimGeneration).toBeGreaterThan(round1.claimGeneration);
    rec = (await store.get(id))!;
    await expect(store.completeWork(id, rec.stateVersion, worker, 'r', 'late', round1, true, { verdict: 'PASS' })).rejects.toThrow(/stale work claim/);
  }));
});

describe('REQ-8 dependants wait for the loop', () => {
  it('keeps the dependant PENDING and the run unfinished until the review passes', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(3));
    let rec = await complete(store, id, 'r', { verdict: 'CHANGES' });
    expect(unitOf(rec, 'a').state).toBe('PENDING');
    rec = await complete(store, id, 'f');
    expect(unitOf(rec, 'a').state).toBe('PENDING');
    expect(rec.state).not.toBe('COMPLETED');
    rec = await complete(store, id, 'r', { verdict: 'PASS' });
    expect(unitOf(rec, 'a').state).toBe('READY');
  }));

  it('does not release a second dependant of the review itself while the loop is open', async () => fixture(async (filePath) => {
    const units = [...plan(3), { id: 'side', title: 'Side', task: 'Side', dependencies: ['r'], readOnly: true }];
    const { store, id } = await start(filePath, units);
    const rec = await complete(store, id, 'r', { verdict: 'CHANGES' });
    expect(unitOf(rec, 'side').state).toBe('PENDING');
  }));
});

describe('REQ-9 limit blocker and Retry', () => {
  it('blocks the review with a human loop-limit blocker at the bound', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(1));
    const rec = await complete(store, id, 'r', { verdict: 'CHANGES' });
    expect(unitOf(rec, 'r').state).toBe('BLOCKED');
    expect(unitOf(rec, 'f').state).not.toBe('READY');
    const blocker = rec.blockers!.find((b) => !b.resolved)!;
    expect(blocker).toMatchObject({ workUnitId: 'r', audience: 'human' });
    expect(blocker.id.startsWith('loop-limit:')).toBe(true);
    expect(blocker.id.length).toBeLessThanOrEqual(2048);
    expect(blocker.question).toContain('1 review round');
    expect(rec.state).toBe('BLOCKED');
    expect(rec.noticeIntents?.length).toBeGreaterThan(0);
  }));

  it('Retry resolves the blocker, grants exactly one more round and readies the fix unit', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(1));
    await complete(store, id, 'r', { verdict: 'CHANGES' });
    let rec = (await store.get(id))!;
    rec = await store.retryWork(id, rec.stateVersion, lead, 'r');
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'COMPLETED', loopExtraRounds: 1 });
    expect(unitOf(rec, 'f').state).toBe('READY');
    expect(rec.blockers!.every((b) => b.resolved)).toBe(true);

    rec = await complete(store, id, 'f');
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'READY', loopRound: 2 });
    rec = await complete(store, id, 'r', { verdict: 'CHANGES' });
    expect(unitOf(rec, 'r').state).toBe('BLOCKED'); // 1 + 1 extra = 2 rounds, now exhausted again
  }));

  it('Retry does not change plan identity: the same plan still re-registers', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(1));
    await complete(store, id, 'r', { verdict: 'CHANGES' });
    let rec = (await store.get(id))!;
    rec = await store.retryWork(id, rec.stateVersion, lead, 'r');
    await expect(store.registerPlan(id, rec.stateVersion, plan(1))).resolves.toBeDefined();
  }));

  it('a worker cannot add rounds: Retry is refused without coordinator authority', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(1));
    await complete(store, id, 'r', { verdict: 'CHANGES' });
    const rec = (await store.get(id))!;
    expect(unitOf(rec, 'r').state).toBe('BLOCKED');
    await expect(store.retryWork(id, rec.stateVersion, worker, 'r')).rejects.toThrow();
    expect(unitOf((await store.get(id))!, 'r').loopExtraRounds ?? 0).toBe(0);
  }));
});

describe('REQ-9 service side effects at the limit', () => {
  it('reaches the Inbox at once and wakes the coordinator', async () => fixture(async (filePath) => {
    const inbox = { append: vi.fn(async () => ({ id: 'inbox-1' })), appendOnce: vi.fn(async () => ({ id: 'inbox-1' })) };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService({
      store, inbox,
      artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [] } } }),
      launchTeam: async () => ({ ok: true }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }),
      cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
      replyToSession: () => true,
      resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? []
    } as never);
    await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Loop', slots: [{ initialTask: 'x' }] });
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, plan(1));
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'r');
    const unit = unitOf(record, 'r');
    const binding = { executionId: record.id, projectId: record.projectId, role: 'worker' as const, slotId: 'slot-1', principalId: 'worker-1' };
    await service.completeWork(binding, 'r', 'changes found', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! }, true, { verdict: 'CHANGES' });
    const after = (await store.get('execution-1'))!;
    expect(unitOf(after, 'r').state).toBe('BLOCKED');
    expect(after.coordinatorWakes?.[0]?.message).toContain('HUMAN_BLOCKER');
    const appended = [...inbox.append.mock.calls, ...inbox.appendOnce.mock.calls].flat();
    expect(appended).toContainEqual(expect.objectContaining({ executionId: 'execution-1', blockerId: expect.stringMatching(/^loop-limit:/) }));
  }));
});

describe('REQ-11 failed review does not strand the run', () => {
  it('skips the dependants of the fix unit when a later-round review fails, and a retry brings them back', async () => fixture(async (filePath) => {
    const { store, id } = await start(filePath, plan(3));
    await complete(store, id, 'r', { verdict: 'CHANGES' });
    await complete(store, id, 'f');
    const fence = await claim(store, id, 'r');
    let rec = (await store.get(id))!;
    rec = await store.failWork(id, rec.stateVersion, worker, 'r', 'crashed', 'UNKNOWN', fence, true);
    expect(unitOf(rec, 'a').state).toBe('SKIPPED');
    rec = await store.retryWork(id, rec.stateVersion, lead, 'r');
    expect(unitOf(rec, 'a').state).not.toBe('SKIPPED');
  }));
});
