import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamLifecycleStore } from '../team-lifecycle-store.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const principal = { kind: 'team' as const, id: 'team:t', allowedProjectIds: ['p'], allowedTeamIds: ['t'], maxConcurrent: 4, maxLaunchesPerRun: 4 };
const worker = { sessionId: 's1', authorizationId: 'a1', cohortId: 'c', slotId: '1:v:0', personaId: 'v', projectId: 'p', process: 'spawning' as const, attention: 'active' as const, task: 'unknown' as const, delivery: 'bound-at-spawn' as const };

async function open(complete = true) {
  const dir = mkdtempSync(join(tmpdir(), 'reopen-worker-'));
  dirs.push(dir);
  const store = createTeamLifecycleStore({ filePath: join(dir, 'lifecycle.json') });
  const claim = await store.claim({ callerPrincipalId: 'o', launchRequestId: 'r', payloadDigest: 'd', capacity: { principal, launched: 0 } } as never);
  const id = claim.record.id;
  await store.addWorker(id, worker);
  await store.addDeferredWorker(id, { authorizationId: 'a-late', cohortId: 'c', slotId: '0:w:0', personaId: 'w', projectId: 'p', attention: 'active' as const, task: 'unknown' as const, delivery: 'bound-at-spawn' as const });
  if (complete) await store.complete(id, { ok: true, value: { launchRequestId: 'r', launched: 1, cohortId: 'c', workers: [{ sessionId: 's1', cohortId: 'c', slotId: '1:v:0', personaId: 'v', projectId: 'p', authorizationId: 'a1' }], failedSlots: [] } });
  return { store, id };
}

describe('reopenExitedWorker', () => {
  it('puts an exited worker back to waiting and lets one caller claim the respawn', async () => {
    const { store, id } = await open();
    await store.updateWorker(id, '1:v:0', { process: 'running' } as never);
    await store.updateWorker(id, '1:v:0', { process: 'exited', exitCode: 1 } as never);
    const reopened = await store.reopenExitedWorker(id, '1:v:0');
    expect(reopened).toMatchObject({ ok: true, sessionId: 's1' });
    const seat = (await store.get(id))!.workers[0]!;
    expect(seat).toMatchObject({ process: 'authorized', onDemand: true, capacityReleased: false });
    expect(seat.sessionId).toBeUndefined();
    expect(seat.exitCode).toBeUndefined();
    const claims = await Promise.all([store.claimDeferredSpawn(id, '1:v:0'), store.claimDeferredSpawn(id, '1:v:0')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await store.bindDeferredWorker(id, '1:v:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn' }, { replace: true } as never);
    expect(await store.claimWorkerRunning(id, '1:v:0')).toBe(true);
  });

  it('refuses unknown, live, never-launched and unknown-slot workers', async () => {
    const { store, id } = await open();
    expect(await store.reopenExitedWorker('missing', '1:v:0')).toEqual({ ok: false, reason: 'not-found' });
    expect(await store.reopenExitedWorker(id, 'nope')).toEqual({ ok: false, reason: 'not-found' });
    expect(await store.reopenExitedWorker(id, '1:v:0')).toEqual({ ok: false, reason: 'not-over' });
    await store.claimDeferredSpawn(id, '0:w:0');
    await store.failDeferredSeat(id, '0:w:0', 'launch failed');
    expect((await store.get(id))!.workers.find((w) => w.slotId === '0:w:0')!.process).toBe('spawn-failed');
    expect(await store.reopenExitedWorker(id, '0:w:0')).toEqual({ ok: false, reason: 'never-launched' });
  });

  it('refuses a closing run and leaves the seat untouched', async () => {
    const { store, id } = await open();
    await store.updateWorker(id, '1:v:0', { process: 'running' } as never);
    await store.updateWorker(id, '1:v:0', { process: 'exited' } as never);
    await store.cancel(id);
    expect(await store.reopenExitedWorker(id, '1:v:0')).toEqual({ ok: false, reason: 'closing' });
    expect((await store.get(id))!.workers.find((w) => w.slotId === '1:v:0')!.process).toBe('exited');
  });

  it('keeps the seat on-demand while it waits, then returns an ordinary worker to ordinary rules once running', async () => {
    const { store, id } = await open();
    await store.updateWorker(id, '1:v:0', { process: 'running' } as never);
    await store.updateWorker(id, '1:v:0', { process: 'exited' } as never);
    await store.reopenExitedWorker(id, '1:v:0');
    let seat = (await store.get(id))!.workers.find((w) => w.slotId === '1:v:0')!;
    expect(seat).toMatchObject({ onDemand: true, respawned: 'normal' });
    await store.claimDeferredSpawn(id, '1:v:0');
    await store.bindDeferredWorker(id, '1:v:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn' });
    const bound = (await store.get(id))!;
    // A respawn always keeps its place in the launch result and takes no extra capacity.
    expect(bound.launchResult.workers.filter((w) => w.slotId === '1:v:0').map((w) => w.sessionId)).toEqual(['s2']);
    expect(bound.capacity?.launched).toBe(1);
    expect(await store.claimWorkerRunning(id, '1:v:0')).toBe(true);
    seat = (await store.get(id))!.workers.find((w) => w.slotId === '1:v:0')!;
    expect(seat.onDemand).toBeUndefined();
    expect(seat.respawned).toBeUndefined();
    expect(seat.process).toBe('running');
  });

  it('leaves a seat that was already on-demand on-demand after the respawn', async () => {
    const { store, id } = await open();
    await store.claimDeferredSpawn(id, '0:w:0');
    await store.bindDeferredWorker(id, '0:w:0', { sessionId: 'late', authorizationId: 'a-late2', delivery: 'bound-at-spawn' });
    await store.claimWorkerRunning(id, '0:w:0');
    await store.updateWorker(id, '0:w:0', { process: 'exited' } as never);
    expect((await store.reopenExitedWorker(id, '0:w:0')).ok).toBe(true);
    expect((await store.get(id))!.workers.find((w) => w.slotId === '0:w:0')!.respawned).toBe('on-demand');
    await store.claimDeferredSpawn(id, '0:w:0');
    await store.bindDeferredWorker(id, '0:w:0', { sessionId: 'late3', authorizationId: 'a-late3', delivery: 'bound-at-spawn' });
    await store.claimWorkerRunning(id, '0:w:0');
    expect((await store.get(id))!.workers.find((w) => w.slotId === '0:w:0')).toMatchObject({ onDemand: true });
  });

  it('refuses to claim a running seat after the run was canceled mid-respawn', async () => {
    const { store, id } = await open();
    await store.updateWorker(id, '1:v:0', { process: 'running' } as never);
    await store.updateWorker(id, '1:v:0', { process: 'exited' } as never);
    await store.reopenExitedWorker(id, '1:v:0');
    await store.claimDeferredSpawn(id, '1:v:0');
    await store.cancel(id);
    await expect(store.bindDeferredWorker(id, '1:v:0', { sessionId: 's2', authorizationId: 'a2', delivery: 'bound-at-spawn' })).rejects.toThrow(/not waiting/);
    expect(await store.claimWorkerRunning(id, '1:v:0')).toBe(false);
  });
});
