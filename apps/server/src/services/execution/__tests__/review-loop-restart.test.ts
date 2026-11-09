import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore, type ExecutionRecord, type ExecutionWorkUnitInput } from '../store.js';
import { LOOP_VERDICT_OUTPUT } from '../contracts.js';
import { executionBoardProjection } from '../projection.js';

// #583 REQ-10: loop state survives an app restart (store recreated from the same file) and a retained relaunch;
// the snapshot projection shows the round and the bound.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-review-loop-restart-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const worker = { role: 'worker' as const, slotId: 'worker-1' };
const lead = { role: 'orchestrator' as const, slotId: 'lead' };
const units = (max: number): ExecutionWorkUnitInput[] => [
  { id: 'r', title: 'Review', task: 'Review', dependencies: [], readOnly: true, loop: { version: 1, fixUnitId: 'f', until: 'PASS', max }, output: LOOP_VERDICT_OUTPUT },
  { id: 'f', title: 'Fix', task: 'Fix', dependencies: ['r'], readOnly: true },
  { id: 'a', title: 'Accept', task: 'Accept', dependencies: ['f'], readOnly: true }
];
const unitOf = (record: ExecutionRecord, id: string) => record.workUnits!.find((u) => u.id === id)!;
type Store = ReturnType<typeof createExecutionStore>;

async function open(filePath: string, max: number) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  let record = (await store.claim({
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Loop', requestDigest: 'd', launchRequestId: 'l', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] }
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  await store.registerPlan(record.id, record.stateVersion, units(max));
  return store;
}
async function finish(store: Store, unitId: string, structured?: unknown) {
  let rec = (await store.get('execution-1'))!;
  rec = await store.claimWork(rec.id, rec.stateVersion, worker, unitId);
  const u = unitOf(rec, unitId);
  return store.completeWork(rec.id, rec.stateVersion, worker, unitId, `${unitId} done`, { claimId: u.claimId!, claimGeneration: u.claimGeneration! }, true, structured);
}

describe('REQ-10 loop state survives restart', () => {
  it('keeps loopRound, the reopened review and its history after the store is recreated', async () => fixture(async (filePath) => {
    const first = await open(filePath, 3);
    await finish(first, 'r', { verdict: 'CHANGES' });
    await finish(first, 'f');
    const second = createExecutionStore({ filePath });
    const rec = (await second.get('execution-1'))!;
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'READY', loopRound: 2, loop: { version: 1, fixUnitId: 'f', until: 'PASS', max: 3 } });
    expect(unitOf(rec, 'r').history.at(-1)?.action).toBe('reopened');
    expect(unitOf(rec, 'a').state).toBe('PENDING');
  }));

  it('keeps the loop-limit blocker and extra rounds across restart', async () => fixture(async (filePath) => {
    const first = await open(filePath, 1);
    await finish(first, 'r', { verdict: 'CHANGES' });
    const blocked = (await createExecutionStore({ filePath }).get('execution-1'))!;
    expect(unitOf(blocked, 'r').state).toBe('BLOCKED');
    expect(blocked.blockers!.some((b) => !b.resolved && b.id.startsWith('loop-limit:'))).toBe(true);

    const second = createExecutionStore({ filePath });
    await second.retryWork('execution-1', blocked.stateVersion, lead, 'r');
    const third = (await createExecutionStore({ filePath }).get('execution-1'))!;
    expect(unitOf(third, 'r').loopExtraRounds).toBe(1);
  }));

  it('keeps loopRound and the verdict across a retained relaunch of a stopped run', async () => fixture(async (filePath) => {
    const store = await open(filePath, 3);
    await finish(store, 'r', { verdict: 'CHANGES' });
    let rec = (await store.get('execution-1'))!;
    rec = await store.transition(rec.id, rec.stateVersion, 'STOPPED', 'info', 'stopped');
    rec = await store.beginRetainedRecovery(rec.id, rec.stateVersion);
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'COMPLETED', loopRound: 1 });
    expect(unitOf(rec, 'f').state).toBe('READY');
    expect(unitOf(rec, 'a').state).toBe('PENDING');
  }));

  it('a reopened review returns to READY with its round kept after a retained relaunch', async () => fixture(async (filePath) => {
    const store = await open(filePath, 3);
    await finish(store, 'r', { verdict: 'CHANGES' });
    await finish(store, 'f');
    let rec = (await store.get('execution-1'))!;
    rec = await store.transition(rec.id, rec.stateVersion, 'STOPPED', 'info', 'stopped');
    rec = await store.beginRetainedRecovery(rec.id, rec.stateVersion);
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'READY', loopRound: 2 });
  }));

  it('the board projection shows the round and the bound, and omits them for a plain unit', async () => fixture(async (filePath) => {
    const store = await open(filePath, 3);
    await finish(store, 'r', { verdict: 'CHANGES' });
    await finish(store, 'f');
    const rec = (await store.get('execution-1'))!;
    const assignments = executionBoardProjection(rec).work!.assignments;
    expect(assignments.find((a) => a.workUnitId === 'r')).toMatchObject({ loopRound: 2, loopMax: 3 });
    expect(assignments.find((a) => a.workUnitId === 'f')).not.toHaveProperty('loopRound');
  }));

  it('the bound shown grows by one after a Retry at the limit', async () => fixture(async (filePath) => {
    const store = await open(filePath, 1);
    await finish(store, 'r', { verdict: 'CHANGES' });
    let rec = (await store.get('execution-1'))!;
    rec = await store.retryWork(rec.id, rec.stateVersion, lead, 'r');
    expect(executionBoardProjection(rec).work!.assignments.find((a) => a.workUnitId === 'r')).toMatchObject({ loopRound: 1, loopMax: 2 });
  }));

  it('an old state file with units that have no loop fields loads and projects unchanged', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let record = (await store.claim({
      callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Plain', requestDigest: 'd', launchRequestId: 'l', resolvedModels: [],
      request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] }
    })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
    await store.registerPlan(record.id, record.stateVersion, [{ id: 'p', title: 'P', task: 'P', dependencies: [], readOnly: true }]);
    const reloaded = (await createExecutionStore({ filePath }).get('execution-1'))!;
    expect(unitOf(reloaded, 'p')).not.toHaveProperty('loopRound');
    expect(executionBoardProjection(reloaded).work!.assignments[0]).not.toHaveProperty('loopRound');
  }));
});

describe('REQ-10 retained relaunch between fix completion and re-review (CodeNod OBL-002)', () => {
  it('keeps the active loop, round, granted extra round and fix result when the run is stopped in round 2 and relaunched', async () => fixture(async (filePath) => {
    const store = await open(filePath, 1);
    await finish(store, 'r', { verdict: 'CHANGES' });
    let rec = (await store.get('execution-1'))!;
    rec = await store.retryWork(rec.id, rec.stateVersion, lead, 'r'); // extra round granted
    await finish(store, 'f');
    rec = (await store.get('execution-1'))!;
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'READY', loopRound: 2, loopExtraRounds: 1 });
    rec = await store.transition(rec.id, rec.stateVersion, 'STOPPED', 'info', 'stopped');
    rec = await store.beginRetainedRecovery(rec.id, rec.stateVersion);
    expect(unitOf(rec, 'r')).toMatchObject({ state: 'READY', loopRound: 2, loopExtraRounds: 1, loop: { fixUnitId: 'f', max: 1 } });
    expect(unitOf(rec, 'f')).toMatchObject({ state: 'COMPLETED', result: 'f done' });
    expect(executionBoardProjection(rec).work!.assignments.find((a) => a.workUnitId === 'r')).toMatchObject({ loopRound: 2, loopMax: 2 });
  }));
});
