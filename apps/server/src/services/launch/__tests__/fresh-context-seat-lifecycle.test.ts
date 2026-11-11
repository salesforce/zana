import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamLifecycleIntegration, createTeamLifecycleStore } from '../team-lifecycle-store.js';

/** #579: a seat between units is stored like a #580 deferred seat, and its next session replaces the entry in place. */
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const principal = { kind: 'team' as const, id: 'team:t', allowedProjectIds: ['p'], allowedTeamIds: ['t'], maxConcurrent: 4, maxLaunchesPerRun: 32 };
const worker = { sessionId: 's1', authorizationId: 'a1', cohortId: 'c', slotId: '1:w:0', personaId: 'w', projectId: 'p', process: 'spawning' as const, attention: 'active' as const, task: 'unknown' as const, delivery: 'bound-at-spawn' as const };
const identity = { sessionId: 's1', cohortId: 'c', slotId: '1:w:0', personaId: 'w', projectId: 'p', authorizationId: 'a1' };

async function runningSeat() {
  const dir = mkdtempSync(join(tmpdir(), 'fresh-seat-'));
  dirs.push(dir);
  const filePath = join(dir, 'lifecycle.json');
  const store = createTeamLifecycleStore({ filePath });
  const claim = await store.claim({ callerPrincipalId: 'o', launchRequestId: 'r', payloadDigest: 'd', capacity: { principal, launched: 0 } } as never);
  const id = claim.record.id;
  await store.addWorker(id, worker);
  await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 1, cohortId: 'c', workers: [identity], workerSessionIds: ['s1'], failedSlots: [] } });
  await store.updateWorker(id, '1:w:0', { process: 'running' });
  return { store, id, filePath };
}

/** The shape a recycle leaves behind between units: no session, on demand, waiting (written as the file would hold it). */
function detach(filePath: string, over: Record<string, unknown> = {}) {
  const state = JSON.parse(readFileSync(filePath, 'utf8'));
  const w = state.records[0].workers.find((x: { slotId: string }) => x.slotId === '1:w:0');
  delete w.sessionId;
  Object.assign(w, { onDemand: true, process: 'authorized', attention: 'active', capacityReleased: false, ...over });
  writeFileSync(filePath, JSON.stringify(state));
}

describe('REQ-5 in-place rebind (bindDeferredWorker replace)', () => {
  it('swaps the slot entry and session id, keeps the worker list and takes no launch of capacity', async () => {
    const { store, id, filePath } = await runningSeat();
    detach(filePath);
    const fresh = createTeamLifecycleStore({ filePath });
    expect(await fresh.claimDeferredSpawn(id, '1:w:0')).toBe(true);
    const before = (await fresh.get(id))!;
    const bound = await fresh.bindDeferredWorker(id, '1:w:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn', replace: true });
    expect(bound.capacity?.launched).toBe(before.capacity?.launched);
    expect(bound.workers).toHaveLength(before.workers.length);
    expect(bound.launchResult.workers.map((w) => w.sessionId)).toEqual(['s2']);
    expect(bound.launchResult.workerSessionIds).toEqual(['s2']);
    expect(bound.launchResult.launched).toBe(1);
    expect(bound.workers[0]).toMatchObject({ sessionId: 's2', authorizationId: 'a2' });
    void store;
  });

  it('without replace a rebind still takes a launch (today\'s late seats are unchanged)', async () => {
    const { id, filePath } = await runningSeat();
    detach(filePath);
    const fresh = createTeamLifecycleStore({ filePath });
    await fresh.claimDeferredSpawn(id, '1:w:0');
    const before = (await fresh.get(id))!.capacity!.launched;
    const bound = await fresh.bindDeferredWorker(id, '1:w:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn' });
    expect(bound.capacity?.launched).toBe(before + 1);
  });

  it('still rejects a duplicate session id with replace', async () => {
    const { id, filePath } = await runningSeat();
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    state.records[0].workers.push({ ...state.records[0].workers[0], sessionId: 's9', authorizationId: 'a9', slotId: '2:w:0' });
    writeFileSync(filePath, JSON.stringify(state));
    detach(filePath);
    const fresh = createTeamLifecycleStore({ filePath });
    await fresh.claimDeferredSpawn(id, '1:w:0');
    await expect(fresh.bindDeferredWorker(id, '1:w:0', { sessionId: 's9', authorizationId: 'a2', delivery: 'bound-at-spawn', replace: true })).rejects.toThrow('duplicate team lifecycle worker');
  });
});

describe('REQ-1 / REQ-10 deliveredUnitCount persists and loads', () => {
  it('keeps a delivered unit count through a fresh store, and a worker without it loads as before', async () => {
    const { id, filePath } = await runningSeat();
    expect((await createTeamLifecycleStore({ filePath }).get(id))!.workers[0]).not.toHaveProperty('deliveredUnitCount');
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    state.records[0].workers[0].deliveredUnitCount = 2;
    writeFileSync(filePath, JSON.stringify(state));
    expect((await createTeamLifecycleStore({ filePath }).get(id))!.workers[0].deliveredUnitCount).toBe(2);
  });

  it.each([-1, 1.5, '2', null])('rejects a corrupt delivered unit count %s', async (bad) => {
    const { filePath } = await runningSeat();
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    state.records[0].workers[0].deliveredUnitCount = bad;
    writeFileSync(filePath, JSON.stringify(state));
    await expect(createTeamLifecycleStore({ filePath }).list()).rejects.toThrow('corrupt team lifecycle store');
  });

  it('a bind with replace resets the count to 0', async () => {
    const { id, filePath } = await runningSeat();
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    state.records[0].workers[0].deliveredUnitCount = 3;
    writeFileSync(filePath, JSON.stringify(state));
    detach(filePath);
    const fresh = createTeamLifecycleStore({ filePath });
    await fresh.claimDeferredSpawn(id, '1:w:0');
    const bound = await fresh.bindDeferredWorker(id, '1:w:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn', replace: true });
    expect(bound.workers[0].deliveredUnitCount ?? 0).toBe(0);
  });
});

describe('REQ-10 a seat between units after an app restart', () => {
  it('stays waiting (authorized, no session) and counts as never started, so Resume stays available', async () => {
    const { id, filePath } = await runningSeat();
    detach(filePath, { deliveredUnitCount: 1 });
    const restarted = createTeamLifecycleStore({ filePath });
    await restarted.reconcileStartup(new Set());
    expect((await restarted.get(id))!.workers[0]).toMatchObject({ process: 'authorized', onDemand: true, capacityReleased: false });
    expect((await restarted.get(id))!.workers[0].sessionId).toBeUndefined();
    expect(restarted.neverStartedSlotsSync('o', 'r')).toEqual(['1:w:0']);
  });

  it('a seat mid-respawn at the restart goes back to waiting, not exited', async () => {
    const { id, filePath } = await runningSeat();
    detach(filePath, { process: 'spawning' });
    const restarted = createTeamLifecycleStore({ filePath });
    await restarted.reconcileStartup(new Set());
    expect((await restarted.get(id))!.workers[0].process).toBe('authorized');
  });
});

describe('REQ-11 a run that ends while a seat is between units', () => {
  it('cancel finishes the seat without listing it as released capacity, and it can no longer be claimed', async () => {
    const { store, id, filePath } = await runningSeat();
    detach(filePath);
    const fresh = createTeamLifecycleStore({ filePath });
    const canceled = await fresh.cancel(id);
    expect(canceled.workers[0]).toMatchObject({ process: 'canceled', capacityReleased: true });
    expect(await fresh.claimDeferredSpawn(id, '1:w:0')).toBe(false);
    void store;
  });
});

describe('REQ-6 closing the old session must not mark the slot exited', () => {
  it('an exit of the detached session changes nothing once the seat is tracked as waiting', async () => {
    const { id, filePath } = await runningSeat();
    detach(filePath);
    const store = createTeamLifecycleStore({ filePath });
    const released: string[] = [];
    const integration = createTeamLifecycleIntegration({ store, isLiveSession: () => true, closeSession: async () => true, releaseCapacity: (a) => released.push(a) });
    integration.track((await store.get(id))!);
    await integration.onSessionExit('s1');
    expect((await store.get(id))!.workers[0]).toMatchObject({ process: 'authorized', capacityReleased: false });
    expect(released).toEqual([]);
  });
});

describe('REQ-7 a failed respawn follows the existing path', () => {
  it('failDeferredSeat marks a waiting recycled seat spawn-failed and frees its capacity once', async () => {
    const { id, filePath } = await runningSeat();
    detach(filePath);
    const store = createTeamLifecycleStore({ filePath });
    const failed = await store.failDeferredSeat(id, '1:w:0', 'Could not start a fresh session.');
    expect(failed?.workers[0]).toMatchObject({ process: 'spawn-failed', capacityReleased: true, exitReason: 'Could not start a fresh session.' });
    expect(await store.failDeferredSeat(id, '1:w:0', 'again')).toBeUndefined();
  });
});
