import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService, type ExecutionServiceDeps } from '../service.js';
import { createExecutionStore, capableSeats, singleSeatOf, NO_PROGRESS_CLAIM_REASON, WorkUnitRecoveryGuardError } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// #789 / AC13: a role with ONE capable seat is retried on that seat (respawned first when its session is gone) before a person is asked.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-single-seat-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
type Respawn = NonNullable<ExecutionServiceDeps['respawnWorker']>;

async function setup(filePath: string, seats: string[], over: { respawnWorker?: Respawn; enforce?: boolean; extraDeps?: Record<string, unknown> } = {}) {
  const clock = { t: 1_000 };
  const now = () => clock.t;
  const proc = { value: 'running' };
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const replyToSession = vi.fn(() => true);
  const logError = vi.fn();
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: coordinator.slotId, personaId: 'lead', authorizationIdDigest: 'lead-d' },
        ...seats.map((slotId) => ({ slotId, personaId: 'worker', authorizationIdDigest: `${slotId}-d` }))
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ id: 'lifecycle-1', orchestratorSessionId: 'coordinator', workers: seats.map((slotId) => ({ slotId, sessionId: `session-${slotId}`, projectId: 'project-1', process: proc.value })) }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession, now, logError,
    claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => over.enforce !== false,
    resolveExactNativeRecoverySnapshots: () => [],
    ...(over.respawnWorker ? { respawnWorker: over.respawnWorker } : {}),
    ...(over.extraDeps ?? {})
  } as never);
  const started = await service.start('owner', 'project-1', {
    version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }],
    coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }]
  } as never);
  if (!started.ok) throw new Error(started.message);
  await service.dispatchReady(coordinator);
  const unit = async () => (await store.get('execution-1'))!.workUnits![0];
  return { service, store, clock, proc, replyToSession, logError, unit };
}

describe('single-seat recovery (#789)', () => {
  it('SILENT/STALLED on the only seat: re-dispatches to the same seat once, then blocks with a question naming what was tried', async () => fixture(async (filePath) => {
    const { service, store, clock, unit } = await setup(filePath, ['slot-1']);
    clock.t += 700_000;
    await service.redispatchStalled();
    expect(await unit()).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1', seatRecovery: { retried: true } });
    clock.t += 700_000;
    await service.redispatchStalled();
    const blocked = (await store.get('execution-1'))!;
    expect(blocked.workUnits![0].state).toBe('BLOCKED');
    const blocker = blocked.blockers!.find((entry) => entry.workUnitId === 'a')!;
    expect(blocker).toMatchObject({ audience: 'human', resolved: false });
    expect(blocker.question).toContain('slot-1');
    expect(blocker.question).toContain('retried the unit once on the same seat');
    expect(blocker.question).not.toContain('respawn');
  }));

  it('PROVEN_DEAD on the only seat: respawns the seat and re-dispatches; a second death blocks without a second respawn', async () => fixture(async (filePath) => {
    const procRef: { proc?: { value: string } } = {};
    const respawnWorker = vi.fn(async () => { procRef.proc!.value = 'running'; return { ok: true as const, sessionId: 'new-session' }; });
    const { service, store, clock, proc, unit } = await setup(filePath, ['slot-1'], { respawnWorker });
    procRef.proc = proc;
    expect(await unit()).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1' });
    proc.value = 'exited';
    clock.t += 60_000;
    await service.reconcileActive();
    expect(respawnWorker).toHaveBeenCalledTimes(1);
    expect(respawnWorker).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
    expect(await unit()).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1', seatRecovery: { respawned: 'ok' } });
    // Dies again: the one respawn per attempt is spent, so no second respawn; the retry is spent too, then a person is asked.
    for (let i = 0; i < 4 && (await unit()).state !== 'BLOCKED'; i += 1) {
      proc.value = 'exited';
      clock.t += 60_000;
      await service.reconcileActive();
      await service.redispatchStalled();
    }
    expect(respawnWorker).toHaveBeenCalledTimes(1);
    const record = (await store.get('execution-1'))!;
    expect(record.workUnits![0].state).toBe('BLOCKED');
    const blocker = record.blockers!.find((entry) => entry.workUnitId === 'a')!;
    expect(blocker.question).toContain('ended its session');
    expect(blocker.question).toContain('respawned the seat');
  }));

  it('a failed respawn is recorded and the unit blocks to a human naming the failed respawn', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn(async () => ({ ok: false as const, reason: 'spawn-failed', message: 'no room', committed: true as const }));
    const { service, store, clock, proc, unit } = await setup(filePath, ['slot-1'], { respawnWorker });
    proc.value = 'exited';
    clock.t += 60_000;
    await service.reconcileActive();
    await service.redispatchStalled();
    expect(respawnWorker).toHaveBeenCalledTimes(1);
    expect((await unit()).seatRecovery).toMatchObject({ respawned: 'failed' });
    expect((await unit()).state).toBe('BLOCKED');
    const blocker = (await store.get('execution-1'))!.blockers!.find((entry) => entry.workUnitId === 'a')!;
    expect(blocker.question).toContain('tried to respawn the seat and could not');
  }));

  it('a role with two capable seats keeps reassignment and never touches seat recovery', async () => fixture(async (filePath) => {
    const { service, clock, unit } = await setup(filePath, ['slot-1', 'slot-2']);
    clock.t += 700_000;
    await service.redispatchStalled();
    expect(await unit()).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-2' });
    expect((await unit()).seatRecovery).toBeUndefined();
  }));

  it('is gated behind the claim-recovery Enforce flag: without it nothing is reclaimed or retried', async () => fixture(async (filePath) => {
    const { service, clock, unit } = await setup(filePath, ['slot-1'], { enforce: false });
    clock.t += 700_000;
    await service.redispatchStalled();
    expect(await unit()).toMatchObject({ state: 'CLAIMED', claimGeneration: 1 });
    expect((await unit()).seatRecovery).toBeUndefined();
  }));
});

describe('single-seat helpers', () => {
  it('capableSeats / singleSeatOf: one worker slot is a single seat, two are not', async () => fixture(async (filePath) => {
    const one = await setup(filePath, ['slot-1']);
    const record = (await one.store.get('execution-1'))!;
    expect(capableSeats(record, record.workUnits![0], false).map((seat) => seat.slotId)).toEqual(['slot-1']);
    // singleSeatOf needs a READY unit with no-progress evidence on that seat.
    expect(singleSeatOf(record, record.workUnits![0], false)).toBeUndefined();
  }));

  it('two worker slots are two capable seats, so there is no single seat', async () => fixture(async (filePath) => {
    const two = await setup(filePath, ['slot-1', 'slot-2']);
    const record = (await two.store.get('execution-1'))!;
    expect(capableSeats(record, record.workUnits![0], false)).toHaveLength(2);
  }));
});

describe('store.recordSeatRecovery guards', () => {
  it('rejects a unit that is not READY, has no reclaimed seat, or whose step is already spent', async () => fixture(async (filePath) => {
    const { store, clock, unit } = await setup(filePath, ['slot-1']);
    await expect(store.recordSeatRecovery('execution-1', 'a', { kind: 'retry' })).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError); // still CLAIMED
    const claimed = await unit();
    clock.t += 1_000;
    await store.reclaimExpiredClaims('execution-1', [{ workUnitId: 'a', claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration!, reason: 'x', force: true }]);
    await expect(store.recordSeatRecovery('execution-1', 'a', { kind: 'retry' })).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError); // no no-progress evidence (untyped reason)
  }));

  it('records one retry and one respawn per attempt; a spent step is refused', async () => fixture(async (filePath) => {
    const { store, clock, unit } = await setup(filePath, ['slot-1']);
    const claim = await unit();
    clock.t += 1_000;
    await store.reclaimExpiredClaims('execution-1', [{ workUnitId: 'a', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
    await store.recordSeatRecovery('execution-1', 'a', { kind: 'retry' });
    expect((await unit()).seatRecovery).toMatchObject({ retried: true });
    await expect(store.recordSeatRecovery('execution-1', 'a', { kind: 'retry' })).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
  }));
});

describe('respawn intent is recorded before the respawn (defect 4)', () => {
  it('a settle that throws after the respawn leaves it spent: the next dead-seat failure never respawns again', async () => fixture(async (filePath) => {
    const procRef: { proc?: { value: string } } = {};
    const respawnWorker = vi.fn(async () => { procRef.proc!.value = 'running'; return { ok: true as const, sessionId: 'new-session' }; });
    const { service, store, clock, proc, unit, logError } = await setup(filePath, ['slot-1'], { respawnWorker });
    procRef.proc = proc;
    const real = store.recordSeatRecovery.bind(store);
    const spy = vi.spyOn(store, 'recordSeatRecovery').mockImplementation(async (id, unitId, step, opts) => {
      if (step.kind === 'respawn') throw new Error('persist failed');
      return real(id, unitId, step, opts);
    });
    proc.value = 'exited';
    clock.t += 60_000;
    await service.reconcileActive();
    expect(respawnWorker).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('execution-1', 'a', { kind: 'respawn-intent' }, expect.anything());
    expect((await unit()).seatRecovery).toMatchObject({ respawned: 'pending' });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('single-seat recovery FAILED'), expect.any(Error));
    spy.mockRestore();
    for (let i = 0; i < 4 && (await unit()).state !== 'BLOCKED'; i += 1) {
      proc.value = 'exited';
      clock.t += 60_000;
      await service.reconcileActive();
      await service.redispatchStalled();
    }
    expect(respawnWorker).toHaveBeenCalledTimes(1);
    expect((await unit()).state).toBe('BLOCKED');
  }));

  it('no respawn runs when the intent cannot be recorded', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn(async () => ({ ok: true as const, sessionId: 'x' }));
    const { service, store, clock, proc } = await setup(filePath, ['slot-1'], { respawnWorker });
    vi.spyOn(store, 'recordSeatRecovery').mockRejectedValue(new WorkUnitRecoveryGuardError('work unit is not READY for same-seat recovery'));
    proc.value = 'exited';
    clock.t += 60_000;
    await service.reconcileActive();
    expect(respawnWorker).not.toHaveBeenCalled();
  }));

  it('store: intent reserves the respawn once, a settle closes it, a second intent or settle is refused', async () => fixture(async (filePath) => {
    const { store, clock, unit } = await setup(filePath, ['slot-1']);
    const claim = await unit();
    clock.t += 1_000;
    await store.reclaimExpiredClaims('execution-1', [{ workUnitId: 'a', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
    const historyBefore = (await unit()).history.length;
    await store.recordSeatRecovery('execution-1', 'a', { kind: 'respawn-intent' });
    expect((await unit()).seatRecovery).toMatchObject({ respawned: 'pending' });
    expect((await unit()).history).toHaveLength(historyBefore);
    expect((await unit()).state).toBe('READY');
    await expect(store.recordSeatRecovery('execution-1', 'a', { kind: 'respawn-intent' })).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
    await store.recordSeatRecovery('execution-1', 'a', { kind: 'respawn', ok: true });
    expect((await unit()).seatRecovery).toMatchObject({ respawned: 'ok', retried: true });
    await expect(store.recordSeatRecovery('execution-1', 'a', { kind: 'respawn', ok: true })).rejects.toBeInstanceOf(WorkUnitRecoveryGuardError);
  }));
});

describe('old session is closed and awaited before respawn (defect 5a)', () => {
  it('closes the old session, waits for its exit, then respawns', async () => fixture(async (filePath) => {
    const order: string[] = [];
    const procRef: { proc?: { value: string } } = {};
    const respawnWorker = vi.fn(async () => { order.push('respawn'); procRef.proc!.value = 'running'; return { ok: true as const, sessionId: 'new-session' }; });
    const closeWorkerSession = vi.fn((id: string) => { order.push(`close:${id}`); });
    const waitForWorkerSessionExit = vi.fn(async (id: string, ms: number) => { order.push(`wait:${id}:${ms}`); return true; });
    const { service, proc } = await setup(filePath, ['slot-1'], { respawnWorker, extraDeps: { closeWorkerSession, waitForWorkerSessionExit } });
    procRef.proc = proc;
    proc.value = 'exited';
    await service.reconcileActive();
    expect(order.slice(-3)).toEqual(['close:session-slot-1', 'wait:session-slot-1:5000', 'respawn']);
  }));

  it('a timed-out wait is logged and the respawn still proceeds', async () => fixture(async (filePath) => {
    const procRef: { proc?: { value: string } } = {};
    const respawnWorker = vi.fn(async () => { procRef.proc!.value = 'running'; return { ok: true as const, sessionId: 'new-session' }; });
    const { service, proc, logError, unit } = await setup(filePath, ['slot-1'], { respawnWorker, extraDeps: { closeWorkerSession: vi.fn(), waitForWorkerSessionExit: vi.fn(async () => false) } });
    procRef.proc = proc;
    proc.value = 'exited';
    await service.reconcileActive();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('still present'), expect.any(Error));
    expect(respawnWorker).toHaveBeenCalledTimes(1);
    expect((await unit()).seatRecovery).toMatchObject({ respawned: 'ok' });
  }));

  it('a throwing wait is logged and the respawn still proceeds', async () => fixture(async (filePath) => {
    const procRef: { proc?: { value: string } } = {};
    const respawnWorker = vi.fn(async () => { procRef.proc!.value = 'running'; return { ok: true as const, sessionId: 'new-session' }; });
    const { service, proc, logError } = await setup(filePath, ['slot-1'], { respawnWorker, extraDeps: { waitForWorkerSessionExit: vi.fn(async () => { throw new Error('boom'); }) } });
    procRef.proc = proc;
    proc.value = 'exited';
    await service.reconcileActive();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('could not be quiesced'), expect.any(Error));
    expect(respawnWorker).toHaveBeenCalledTimes(1);
  }));
});

describe('claim session fence (defect 5b)', () => {
  it('dispatch binds the claim to the delivered session; late events from another session are ignored, the bound session is accepted', async () => fixture(async (filePath) => {
    const { service, store, clock, unit } = await setup(filePath, ['slot-1']);
    const claim = await unit();
    expect(claim.claimedBy).toEqual({ slotId: 'slot-1', sessionId: 'session-slot-1' });
    clock.t += 80_000; // inside the persist window of the lease
    const before = (await unit()).leaseExpiresAt;
    expect(await store.renewWorkerLease('execution-1', 'slot-1', { output: true, sessionId: 'old-session' })).toBeUndefined();
    expect((await unit()).leaseExpiresAt).toBe(before);
    expect(await store.recordClaimSignal('execution-1', 'slot-1', { turn: true, sessionId: 'old-session' })).toBe(false);
    expect((await unit()).lastTurnAt).toBeUndefined();
    await service.recordWorkerTurn('execution-1', 'slot-1', 'old-session');
    expect((await unit()).lastTurnAt).toBeUndefined();
    await service.renewWorkerLease('execution-1', 'slot-1', 'old-session');
    expect((await unit()).leaseExpiresAt).toBe(before);
    // New (current) session is accepted.
    expect(await store.recordClaimSignal('execution-1', 'slot-1', { turn: true, sessionId: 'session-slot-1' })).toBe(true);
    expect((await unit()).lastTurnAt).toBeDefined();
    await service.renewWorkerLease('execution-1', 'slot-1', 'session-slot-1');
    expect((await unit()).leaseExpiresAt).toBeGreaterThan(before!);
  }));

  it('events without a session id still match by slot (modern member path); an unbound claim accepts any session', async () => fixture(async (filePath) => {
    const { store, unit } = await setup(filePath, ['slot-1']);
    expect(await store.recordClaimSignal('execution-1', 'slot-1', { turn: true })).toBe(true);
    const claim = await unit();
    expect(await store.bindClaimSession('execution-1', 'a', 'stale-claim', 's')).toBe(false); // wrong claim id
    expect(await store.bindClaimSession('execution-1', 'missing', claim.claimId!, 's')).toBe(false);
    expect(await store.bindClaimSession('execution-1', 'a', claim.claimId!, 'session-slot-1')).toBe(true); // idempotent re-bind
    expect(await store.bindClaimSession('execution-1', 'a', claim.claimId!, 'session-slot-1')).toBe(true);
  }));

  it('binding is cleared with the claim: a reclaimed unit is no longer fenced to the old session', async () => fixture(async (filePath) => {
    const { store, clock, unit } = await setup(filePath, ['slot-1']);
    const claim = await unit();
    clock.t += 1_000;
    await store.reclaimExpiredClaims('execution-1', [{ workUnitId: 'a', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
    expect((await unit()).claimedBy).toBeUndefined();
    expect(await store.bindClaimSession('execution-1', 'a', claim.claimId!, 'late')).toBe(false); // not CLAIMED
  }));
});
