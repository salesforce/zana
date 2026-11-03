import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamLifecycleStore } from '../team-lifecycle-store.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const principal = { kind: 'team' as const, id: 'team:t', allowedProjectIds: ['p'], allowedTeamIds: ['t'], maxConcurrent: 4, maxLaunchesPerRun: 4 };
const seat = { authorizationId: 'a-late', cohortId: 'c', slotId: '0:w:0', personaId: 'w', projectId: 'p', attention: 'active' as const, task: 'unknown' as const, delivery: 'bound-at-spawn' as const };
const running = { sessionId: 's1', authorizationId: 'a1', cohortId: 'c', slotId: '1:v:0', personaId: 'v', projectId: 'p', process: 'spawning' as const, attention: 'active' as const, task: 'unknown' as const, delivery: 'bound-at-spawn' as const };

async function open() {
  const dir = mkdtempSync(join(tmpdir(), 'deferred-seat-'));
  dirs.push(dir);
  const filePath = join(dir, 'lifecycle.json');
  const store = createTeamLifecycleStore({ filePath });
  const claim = await store.claim({ callerPrincipalId: 'o', launchRequestId: 'r', payloadDigest: 'd', capacity: { principal, launched: 0 } } as never);
  return { store, filePath, id: claim.record.id };
}

describe('deferred seats in the lifecycle store', () => {
  it('records a seat with no session, takes no capacity, and survives the launch result', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    await store.addWorker(id, running);
    await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 1, cohortId: 'c', workers: [{ sessionId: 's1', cohortId: 'c', slotId: '1:v:0', personaId: 'v', projectId: 'p', authorizationId: 'a1' }], failedSlots: [] } });
    const record = (await store.get(id))!;
    expect(record.capacity?.launched).toBe(1);
    expect(record.launchResult.workers).toHaveLength(1);
    expect(record.workers.find((w) => w.slotId === '0:w:0')).toMatchObject({ process: 'authorized', capacityReleased: false });
    expect(record.workers.find((w) => w.slotId === '0:w:0')?.sessionId).toBeUndefined();
  });

  it('refuses a duplicate seat and a seat on an inactive launch', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    await expect(store.addDeferredWorker(id, seat)).rejects.toThrow('duplicate team lifecycle worker');
    await expect(store.addDeferredWorker('missing', seat)).rejects.toThrow('unknown team lifecycle record');
    await store.complete(id, { ok: false, code: 'X', message: 'm' });
    await expect(store.addDeferredWorker(id, { ...seat, slotId: 'x', authorizationId: 'x' })).rejects.toThrow('not active');
  });

  it('lets exactly one caller claim a seat, then binds it into the launch result and capacity', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 0, cohortId: 'c', workers: [], failedSlots: [] } });
    const claims = await Promise.all([store.claimDeferredSpawn(id, '0:w:0'), store.claimDeferredSpawn(id, '0:w:0')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.workerMaySpawn(id, '0:w:0')).toBe(true);
    const bound = await store.bindDeferredWorker(id, '0:w:0', { sessionId: 'late', authorizationId: 'a-new', delivery: 'bound-at-spawn' });
    expect(bound.capacity?.launched).toBe(1);
    expect(bound.launchResult.workers.map((w) => w.sessionId)).toEqual(['late']);
    expect(await store.claimWorkerRunning(id, '0:w:0')).toBe(true);
    expect((await store.get(id))!.workers[0]).toMatchObject({ process: 'running', sessionId: 'late', authorizationId: 'a-new' });
    expect(await store.claimDeferredSpawn(id, '0:w:0')).toBe(false);
  });

  it('rejects a bind for a seat that was not claimed, a duplicate session and a bad delivery state', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    await store.addWorker(id, running);
    const bind = (over: Record<string, unknown> = {}) => store.bindDeferredWorker(id, '0:w:0', { sessionId: 'late', authorizationId: 'a-new', delivery: 'bound-at-spawn', ...over } as never);
    await expect(bind()).rejects.toThrow('not waiting for a session');
    await expect(store.bindDeferredWorker('missing', '0:w:0', { sessionId: 'x', authorizationId: 'y', delivery: 'bound-at-spawn' })).rejects.toThrow('unknown team lifecycle record');
    await store.claimDeferredSpawn(id, '0:w:0');
    await expect(bind({ sessionId: 's1' })).rejects.toThrow('duplicate team lifecycle worker');
    await expect(bind({ delivery: 'nope' })).rejects.toThrow('invalid worker delivery state');
  });

  it('does not claim a seat of a canceled or unknown run', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    expect(await store.claimDeferredSpawn(id, 'nope')).toBe(false);
    await store.cancel(id);
    expect((await store.get(id))!.workers[0]).toMatchObject({ process: 'canceled', capacityReleased: true });
    expect(await store.claimDeferredSpawn(id, '0:w:0')).toBe(false);
  });

  it('leaves a never-started seat alone after a restart', async () => {
    const { store, id, filePath } = await open();
    await store.addDeferredWorker(id, seat);
    await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 0, cohortId: 'c', workers: [], failedSlots: [] } });
    const restarted = createTeamLifecycleStore({ filePath });
    await restarted.reconcileStartup(new Set());
    expect((await restarted.get(id))!.workers[0]).toMatchObject({ process: 'authorized' });
  });

  it('does not allow a late spawn after a failed launch', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    await store.complete(id, { ok: false, code: 'X', message: 'm' }, { launchRequestId: 'r', launched: 0, cohortId: 'c', workers: [], failedSlots: [] });
    await store.claimDeferredSpawn(id, '0:w:0');
    expect(await store.workerMaySpawn(id, '0:w:0')).toBe(false);
  });

  it('still rejects a session-less worker that is not a deferred seat, and loads old records', async () => {
    const { store, id, filePath } = await open();
    await store.addWorker(id, running);
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    delete state.records[0].workers[0].sessionId;
    state.records[0].workers[0].process = 'running';
    writeFileSync(filePath, JSON.stringify(state));
    await expect(createTeamLifecycleStore({ filePath }).list()).rejects.toThrow('corrupt team lifecycle store');
    state.records[0].workers[0].sessionId = 's1';
    writeFileSync(filePath, JSON.stringify(state));
    expect((await createTeamLifecycleStore({ filePath }).list())[0].workers[0].sessionId).toBe('s1');
  });
});

describe('review round 1 fixes', () => {
  it('A3: an older app still reads the file, because seats without a session are stored under their own key', async () => {
    const { store, id, filePath } = await open();
    await store.addDeferredWorker(id, seat);
    await store.addWorker(id, running);
    const onDisk = JSON.parse(readFileSync(filePath, 'utf8')).records[0];
    // the previous validator needs a session id on every entry of `workers`
    expect(onDisk.workers.every((w: { sessionId?: string }) => typeof w.sessionId === 'string' && w.sessionId.length > 0)).toBe(true);
    expect(onDisk.deferredSeats).toHaveLength(1);
    // and the new code reads them back among the workers
    expect((await createTeamLifecycleStore({ filePath }).get(id))!.workers.map((w) => w.slotId).sort()).toEqual(['0:w:0', '1:v:0']);
  });

  it('A6: only an on-demand seat may spawn after the launch call has returned', async () => {
    const { store, id } = await open();
    await store.addWorker(id, running);
    await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 1, cohortId: 'c', workers: [{ sessionId: 's1', cohortId: 'c', slotId: '1:v:0', personaId: 'v', projectId: 'p', authorizationId: 'a1' }], failedSlots: [] } });
    await store.updateWorker(id, '1:v:0', { process: 'running' });
    expect(await store.workerMaySpawn(id, '1:v:0')).toBe(false);
  });

  it('reopens a claimed seat that did not start, only while it has no session', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    expect(await store.reopenDeferredSpawn(id, '0:w:0')).toBe(false);
    await store.claimDeferredSpawn(id, '0:w:0');
    expect(await store.reopenDeferredSpawn(id, '0:w:0')).toBe(true);
    expect((await store.get(id))!.workers[0].process).toBe('authorized');
    expect(await store.claimDeferredSpawn(id, '0:w:0')).toBe(true);
  });

  it('A2: fails a seat nobody can start any more, once, with a plain reason, and frees its capacity', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    const failed = await store.failDeferredSeat(id, '0:w:0', 'Resume the run to start it.');
    expect(failed?.workers[0]).toMatchObject({ process: 'spawn-failed', capacityReleased: true, exitReason: 'Resume the run to start it.' });
    expect(await store.failDeferredSeat(id, '0:w:0', 'again')).toBeUndefined();
    expect(await store.failDeferredSeat(id, 'nope', 'x')).toBeUndefined();
  });

  it('puts a seat that was mid-start at a restart back to waiting, and reports never-started slots', async () => {
    const { store, id, filePath } = await open();
    await store.addDeferredWorker(id, seat);
    await store.addDeferredWorker(id, { ...seat, slotId: '0:w:1', authorizationId: 'b' });
    await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 0, cohortId: 'c', workers: [], failedSlots: [] } });
    await store.claimDeferredSpawn(id, '0:w:0');
    const restarted = createTeamLifecycleStore({ filePath });
    await restarted.reconcileStartup(new Set());
    expect((await restarted.get(id))!.workers.find((w) => w.slotId === '0:w:0')?.process).toBe('authorized');
    expect(restarted.neverStartedSlotsSync('o', 'r').sort()).toEqual(['0:w:0', '0:w:1']);
    expect(restarted.neverStartedSlotsSync('o', 'unknown')).toEqual([]);
  });
});

describe('review round 2 (#580)', () => {
  it('A9: a run canceled while a seat is starting finishes that seat, so the record reaches canceled', async () => {
    const { store, id } = await open();
    await store.addDeferredWorker(id, seat);
    await store.claimDeferredSpawn(id, '0:w:0');
    await store.cancel(id);
    const record = (await store.get(id))!;
    expect(record.workers[0]).toMatchObject({ process: 'canceled', capacityReleased: true });
    expect(record.state).toBe('canceled');
    expect(await store.reopenDeferredSpawn(id, '0:w:0')).toBe(false);
  });

  it('A9: after a restart, a seat that was mid-start on a canceled run is finished, not revived', async () => {
    const { store, id, filePath } = await open();
    await store.addDeferredWorker(id, seat);
    await store.addWorker(id, running);
    await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 1, cohortId: 'c', workers: [{ sessionId: 's1', cohortId: 'c', slotId: '1:v:0', personaId: 'v', projectId: 'p', authorizationId: 'a1' }], failedSlots: [] } });
    await store.claimDeferredSpawn(id, '0:w:0');
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    state.records[0].state = 'cancel-pending';
    writeFileSync(filePath, JSON.stringify(state));
    const restarted = createTeamLifecycleStore({ filePath });
    await restarted.reconcileStartup(new Set());
    expect((await restarted.get(id))!.workers.find((w) => w.slotId === '0:w:0')).toMatchObject({ process: 'canceled', capacityReleased: true });
  });

  it('N4: a worker with no session that is not a recorded on-demand seat still makes the file invalid', async () => {
    const { store, id, filePath } = await open();
    await store.addWorker(id, running);
    const state = JSON.parse(readFileSync(filePath, 'utf8'));
    delete state.records[0].workers[0].sessionId;
    state.records[0].workers[0].process = 'authorized';
    writeFileSync(filePath, JSON.stringify(state));
    await expect(createTeamLifecycleStore({ filePath }).list()).rejects.toThrow('corrupt team lifecycle store');
    state.records[0].workers[0].onDemand = true;
    writeFileSync(filePath, JSON.stringify(state));
    expect((await createTeamLifecycleStore({ filePath }).list())[0].workers).toHaveLength(1);
  });

  it('N5/A11: never-started slots are read once per file version and a read error is reported once', async () => {
    const { store, id, filePath } = await open();
    await store.addDeferredWorker(id, seat);
    expect(store.neverStartedSlotsSync('o', 'r')).toEqual(['0:w:0']);
    expect(store.neverStartedSlotsSync('o', 'r')).toEqual(['0:w:0']);
    const spy = (await import('vitest')).vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeFileSync(filePath, '{ not json');
    expect(store.neverStartedSlotsSync('o', 'r')).toEqual([]);
    expect(store.neverStartedSlotsSync('o', 'r')).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
