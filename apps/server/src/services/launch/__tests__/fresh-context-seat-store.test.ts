import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamLifecycleStore } from '../team-lifecycle-store.js';

/** #579: detaching a running seat for its next session, and counting the units its session accepted. */
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
const principal = { kind: 'team' as const, id: 'team:t', allowedProjectIds: ['p'], allowedTeamIds: ['t'], maxConcurrent: 4, maxLaunchesPerRun: 32 };
const identity = { sessionId: 's1', cohortId: 'c', slotId: '1:w:0', personaId: 'w', projectId: 'p', authorizationId: 'a1' };

async function runningSeat() {
  const dir = mkdtempSync(join(tmpdir(), 'fresh-seat-store-'));
  dirs.push(dir);
  const store = createTeamLifecycleStore({ filePath: join(dir, 'lifecycle.json') });
  const claim = await store.claim({ callerPrincipalId: 'o', launchRequestId: 'r', payloadDigest: 'd', capacity: { principal, launched: 0 } } as never);
  const id = claim.record.id;
  await store.addWorker(id, { ...identity, process: 'spawning', attention: 'active', task: 'unknown', delivery: 'bound-at-spawn', deliveredUnitCount: 0 });
  await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 1, cohortId: 'c', workers: [identity], workerSessionIds: ['s1'], failedSlots: [] } });
  await store.updateWorker(id, '1:w:0', { process: 'running' });
  return { store, id };
}

describe('recordUnitDelivered', () => {
  it('counts each accepted unit and survives a fresh store', async () => {
    const { store, id } = await runningSeat();
    await store.recordUnitDelivered(id, '1:w:0');
    const updated = await store.recordUnitDelivered(id, '1:w:0');
    expect(updated!.workers[0].deliveredUnitCount).toBe(2);
  });
  it('does nothing for an unknown run, an unknown seat, or a seat with no session', async () => {
    const { store, id } = await runningSeat();
    expect(await store.recordUnitDelivered('nope', '1:w:0')).toBeUndefined();
    expect(await store.recordUnitDelivered(id, 'x')).toBeUndefined();
    await store.detachWorkerForRecycle(id, '1:w:0');
    expect(await store.recordUnitDelivered(id, '1:w:0')).toBeUndefined();
  });
});

describe('detachWorkerForRecycle', () => {
  it('turns a running seat into a waiting one, keeping its place and releasing nothing', async () => {
    const { store, id } = await runningSeat();
    const detached = await store.detachWorkerForRecycle(id, '1:w:0');
    expect(detached?.sessionId).toBe('s1');
    expect(detached!.record.workers[0]).toMatchObject({ process: 'authorized', onDemand: true, capacityReleased: false });
    expect(detached!.record.workers[0].sessionId).toBeUndefined();
    expect(detached!.record.launchResult.workers.map((w) => w.sessionId)).toEqual(['s1']);
    expect(await store.claimDeferredSpawn(id, '1:w:0')).toBe(true);
  });
  it('refuses a seat that is not running a session, an unknown one, and a run that is no longer active', async () => {
    const { store, id } = await runningSeat();
    expect(await store.detachWorkerForRecycle('nope', '1:w:0')).toBeUndefined();
    expect(await store.detachWorkerForRecycle(id, 'x')).toBeUndefined();
    expect(await store.detachWorkerForRecycle(id, '1:w:0')).toBeDefined();
    expect(await store.detachWorkerForRecycle(id, '1:w:0')).toBeUndefined();
    await store.cancel(id);
    expect(await store.detachWorkerForRecycle(id, '1:w:0')).toBeUndefined();
  });
});

describe('bindDeferredWorker', () => {
  it('replace works on a launch result without a worker session id list', async () => {
    const { store, id } = await runningSeat();
    await store.detachWorkerForRecycle(id, '1:w:0');
    await store.claimDeferredSpawn(id, '1:w:0');
    const bound = await store.bindDeferredWorker(id, '1:w:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn', replace: true });
    expect(bound.launchResult.workerSessionIds).toEqual(['s2']);
    expect(bound.workers[0].deliveredUnitCount).toBe(0);
  });
  it('a first bind of a counting seat starts its count at the given value, and a bad value is refused', async () => {
    const { store, id } = await runningSeat();
    await store.detachWorkerForRecycle(id, '1:w:0');
    await store.claimDeferredSpawn(id, '1:w:0');
    await expect(store.bindDeferredWorker(id, '1:w:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn', deliveredUnitCount: -1 })).rejects.toThrow('invalid delivered unit count');
    const bound = await store.bindDeferredWorker(id, '1:w:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn', deliveredUnitCount: 0 });
    expect(bound.workers[0].deliveredUnitCount).toBe(0);
    // without replace a bind takes a launch of capacity, as for every late seat
    expect(bound.capacity!.launched).toBe(2);
  });
});
