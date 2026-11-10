import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, type ExecutionRecord, type ExecutionWorkUnitInput } from '../store.js';
import { LOOP_VERDICT_OUTPUT } from '../contracts.js';
import { SquadExecutionService, assignmentText } from '../service.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// #583 engine helpers: loop-aware assignment text, state-file validation, recovery of a split loop pair and a failed review.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-review-loop-engine-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const worker = { role: 'worker' as const, slotId: 'worker-1' };
const units = (max = 2): ExecutionWorkUnitInput[] => [
  { id: 'r', title: 'Review', task: 'Review', dependencies: [], readOnly: true, loop: { version: 1, fixUnitId: 'f', until: 'PASS', max }, output: LOOP_VERDICT_OUTPUT },
  { id: 'f', title: 'Fix', task: 'Fix', dependencies: ['r'], readOnly: true },
  { id: 'a', title: 'Accept', task: 'Accept', dependencies: ['f'], readOnly: true }
];
const unitOf = (record: ExecutionRecord, id: string) => record.workUnits!.find((u) => u.id === id)!;

async function open(filePath: string, plan = units()) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  let record = (await store.claim({
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Loop', requestDigest: 'd', launchRequestId: 'l', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] }
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  await store.registerPlan(record.id, record.stateVersion, plan);
  return store;
}
async function finish(store: ReturnType<typeof createExecutionStore>, unitId: string, structured?: unknown) {
  let rec = (await store.get('execution-1'))!;
  rec = await store.claimWork(rec.id, rec.stateVersion, worker, unitId);
  const u = unitOf(rec, unitId);
  return store.completeWork(rec.id, rec.stateVersion, worker, unitId, `${unitId} done`, { claimId: u.claimId!, claimGeneration: u.claimGeneration! }, true, structured);
}

describe('assignment text for a loop review', () => {
  it('asks for the verdict only on a loop unit', async () => fixture(async (filePath) => {
    const rec = (await (await open(filePath)).get('execution-1'))!;
    const text = (id: string) => assignmentText(rec, { workUnitId: id, slotId: 'worker-1', title: id, task: id });
    expect(text('r')).toContain('"verdict": "PASS" | "CHANGES"');
    expect(text('f')).not.toContain('verdict');
  }));

  it('adds no fix result to the first round, and tolerates an unknown unit', async () => fixture(async (filePath) => {
    const store = await open(filePath);
    await finish(store, 'r', { verdict: 'CHANGES' });
    const rec = (await store.get('execution-1'))!;
    expect(assignmentText(rec, { workUnitId: 'r', slotId: 'worker-1', title: 'r', task: 'r' })).not.toContain('Upstream results');
    expect(assignmentText(rec, { workUnitId: 'missing', slotId: 'worker-1', title: 'm', task: 'm' })).not.toContain('verdict');
  }));
});

describe('state file validation of loop fields', () => {
  const corrupt = async (filePath: string, patch: (unit: Record<string, unknown>) => void) => {
    await open(filePath);
    const state = JSON.parse(await readFile(filePath, 'utf8'));
    patch(state.records[0].workUnits[0]);
    await writeFile(filePath, JSON.stringify(state));
    return createExecutionStore({ filePath }).get('execution-1');
  };

  it.each([
    ['a loop with max 9', (u: Record<string, unknown>) => { (u.loop as { max: number }).max = 9; }],
    ['a loopRound of 0', (u: Record<string, unknown>) => { u.loopRound = 0; }],
    ['a negative loopExtraRounds', (u: Record<string, unknown>) => { u.loopExtraRounds = -1; }]
  ])('refuses %s', async (_name, patch) => fixture(async (filePath) => {
    await expect(corrupt(filePath, patch)).rejects.toThrow(/corrupt execution store|invalid/);
  }));

  it('accepts a loop unit with the new runtime fields', async () => fixture(async (filePath) => {
    const record = await corrupt(filePath, (u) => { u.loopRound = 2; u.loopExtraRounds = 1; });
    expect(unitOf(record!, 'r')).toMatchObject({ loopRound: 2, loopExtraRounds: 1 });
  }));
});

describe('a failed review in a later round', () => {
  it('skips the dependants of a fix unit that already ran when a later-round review fails', async () => fixture(async (filePath) => {
    const store = await open(filePath, units(3));
    await finish(store, 'r', { verdict: 'CHANGES' });
    await finish(store, 'f');
    let rec = (await store.get('execution-1'))!;
    rec = await store.claimWork(rec.id, rec.stateVersion, worker, 'r');
    const u = unitOf(rec, 'r');
    rec = await store.failWork(rec.id, rec.stateVersion, worker, 'r', 'crashed', 'UNKNOWN', { claimId: u.claimId!, claimGeneration: u.claimGeneration! }, true);
    expect(unitOf(rec, 'a').state).toBe('SKIPPED');
  }));
});

describe('recovering a timed-out run with a loop', () => {
  const recover = async (filePath: string, finishFirst: boolean, reopenedReview = false) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })(), now: () => now });
    const service = new SquadExecutionService({
      store, now: () => now, artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'p', authorizedAt: 1, expiresAt: 2, slots: [] } } }),
      launchTeam: async () => ({ ok: true }), getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }),
      cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }), replyToSession: () => true,
      resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? []
    } as never);
    const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'src', summary: 'Loop', slots: [{ initialTask: 'x' }], policy: { deadlineMs: 100 } });
    if (!started.ok) throw new Error('launch failed');
    let source = await store.registerPlan(started.value.id, started.value.stateVersion, units());
    const slot = { role: 'worker' as const, slotId: 'slot-1' };
    if (finishFirst) {
      source = await store.claimWork(source.id, source.stateVersion, slot, 'r');
      const u = unitOf(source, 'r');
      source = await store.completeWork(source.id, source.stateVersion, slot, 'r', 'r done', { claimId: u.claimId!, claimGeneration: u.claimGeneration! }, true, { verdict: 'CHANGES' });
    }
    if (reopenedReview) {
      source = await store.claimWork(source.id, source.stateVersion, slot, 'f');
      const f = unitOf(source, 'f');
      source = await store.completeWork(source.id, source.stateVersion, slot, 'f', 'f done', { claimId: f.claimId!, claimGeneration: f.claimGeneration! }, true);
    }
    const blockedId = reopenedReview ? 'r' : finishFirst ? 'f' : 'r';
    source = await store.claimWork(source.id, source.stateVersion, slot, blockedId);
    source = await store.blockWork(source.id, source.stateVersion, slot, blockedId, { id: 'blocker', question: 'Need decision' });
    now = 1_101;
    source = (await store.decideDeadline(source.id, 1_100, 0)).record;
    const out = await service.recoverTimedOut('owner', 'project-1', source.id, source.stateVersion, 'recover');
    return { out, store };
  };

  it('keeps the loop on the successor when review and fix are both unfinished', async () => fixture(async (filePath) => {
    const { out, store } = await recover(filePath, false);
    expect(out.ok).toBe(true);
    const successor = (await store.get('execution-2'))!;
    expect(successor.workUnits?.find((u) => u.id === 'r')?.loop).toMatchObject({ fixUnitId: 'f' });
  }));

  it('drops the loop when its review already finished, so the successor plan stays valid', async () => fixture(async (filePath) => {
    const { out, store } = await recover(filePath, true);
    expect(out.ok).toBe(true);
    const successor = (await store.get('execution-2'))!;
    expect(successor.workUnits?.map((u) => u.id)).toEqual(['f', 'a']);
    expect(successor.workUnits?.every((u) => !('loop' in u) && !('loopRound' in u))).toBe(true);
    expect(successor.request.objective).toContain('Review loop r was interrupted in round 1');
  }));

  it('drops the loop when its fix unit already finished and only the reopened review is left', async () => fixture(async (filePath) => {
    const { out, store } = await recover(filePath, true, true);
    expect(out.ok).toBe(true);
    const successor = (await store.get('execution-2'))!;
    expect(successor.workUnits?.map((u) => u.id)).toEqual(['r', 'a']);
    expect(successor.workUnits?.find((u) => u.id === 'r')).not.toHaveProperty('loop');
  }));
});
