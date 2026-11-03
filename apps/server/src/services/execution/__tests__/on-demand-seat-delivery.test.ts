import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService, type DeferredWorkerSpawnResult } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

/**
 * #580: a seat that starts on demand has a lifecycle worker with no session
 * (process 'authorized'). The engine starts it through `spawnDeferredWorker`
 * just before it delivers the first assignment.
 */
async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-on-demand-seat-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const unit = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id.toUpperCase(), task: `do ${id}`, dependencies: [], files: [`${id}.txt`], verification: [`check ${id}`], ...extra });
const deferredWorker = { slotId: 'slot-1', projectId: 'project-1', process: 'authorized' };
const runningWorker = { slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' };

async function setup(filePath: string, opts: {
  workers?: Array<Record<string, unknown>>;
  noCoordinator?: boolean;
  workersRef?: () => Array<Record<string, unknown>>;
  spawnDeferredWorker?: (recordId: string, slotId: string) => Promise<DeferredWorkerSpawnResult>;
  deliverAssignment?: (...args: any[]) => Promise<any>;
  units?: Array<Record<string, unknown>>;
  slotIds?: string[];
  closeWorkerSession?: (sessionId: string) => void;
} = {}) {
  const slotIds = opts.slotIds ?? ['slot-1'];
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  const deliverAssignment = opts.deliverAssignment ?? vi.fn(async () => ({ state: 'accepted' as const }));
  const service = new ExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: coordinator.slotId, personaId: 'lead', authorizationIdDigest: 'lead-d' },
        ...slotIds.map((slotId) => ({ slotId, personaId: 'worker', authorizationIdDigest: `${slotId}-d` }))
      ]
    } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ id: 'lifecycle-1', orchestratorSessionId: opts.noCoordinator ? undefined : 'coordinator', workers: opts.workersRef ? opts.workersRef() : (opts.workers ?? [deferredWorker]) }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: () => true,
    deliverAssignment: deliverAssignment as never,
    resolveExactNativeRecoverySnapshots: () => [],
    ...(opts.closeWorkerSession ? { closeWorkerSession: opts.closeWorkerSession } : {}),
    ...(opts.spawnDeferredWorker ? { spawnDeferredWorker: opts.spawnDeferredWorker } : {})
  } as never);
  const started = await service.start('owner', 'project-1', {
    version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }],
    coordinationMode: 'job-team', workUnits: opts.units ?? [unit('a')]
  } as never);
  if (!started.ok) throw new Error(started.message);
  return { service, store, deliverAssignment };
}

const isTerminal = (state?: string) => state === 'STOPPED' || state === 'FAILED' || state === 'COMPLETED' || state === 'CANCELED';
const unitState = async (store: ReturnType<typeof createExecutionStore>, index = 0) => (await store.get('execution-1'))?.workUnits?.[index];

describe('REQ-4 starting a deferred seat when its first unit is dispatched', () => {
  it('spawns the seat, then delivers the assignment to the new session (in that order)', async () => fixture(async (filePath) => {
    const order: string[] = [];
    const spawnDeferredWorker = vi.fn(async () => { order.push('spawn'); return { ok: true as const, sessionId: 'late-session' }; });
    const deliverAssignment = vi.fn(async () => { order.push('deliver'); return { state: 'accepted' as const }; });
    const { service, store } = await setup(filePath, { spawnDeferredWorker, deliverAssignment });
    await service.dispatchReady(coordinator);
    expect(spawnDeferredWorker).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
    expect(deliverAssignment).toHaveBeenCalledWith('late-session', expect.stringContaining('assigned work unit `a`'), expect.anything());
    expect(order).toEqual(['spawn', 'deliver']);
    expect(await unitState(store)).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1' });
  }));

  it('does not call the spawner for a seat that already has a session (REQ-3 path)', async () => fixture(async (filePath) => {
    const spawnDeferredWorker = vi.fn(async () => ({ ok: true as const, sessionId: 'never' }));
    const { service, deliverAssignment } = await setup(filePath, { workers: [runningWorker], spawnDeferredWorker });
    await service.dispatchReady(coordinator);
    expect(spawnDeferredWorker).not.toHaveBeenCalled();
    expect(deliverAssignment).toHaveBeenCalledWith('worker-1', expect.any(String), expect.anything());
  }));

  it('still releases a session-less seat that is not deferred (old behaviour)', async () => fixture(async (filePath) => {
    const spawnDeferredWorker = vi.fn(async () => ({ ok: true as const, sessionId: 'never' }));
    const { service, store } = await setup(filePath, { workers: [{ slotId: 'slot-1', projectId: 'project-1', process: 'spawn-failed' }], spawnDeferredWorker });
    await service.dispatchReady(coordinator);
    expect(spawnDeferredWorker).not.toHaveBeenCalled();
    expect((await unitState(store))?.state).toBe('READY');
  }));

  it('releases the assignment when no spawner is wired (dependency absent)', async () => fixture(async (filePath) => {
    const { service, store, deliverAssignment } = await setup(filePath, {});
    await service.dispatchReady(coordinator);
    expect(deliverAssignment).not.toHaveBeenCalled();
    expect((await unitState(store))?.state).toBe('READY');
  }));
});

describe('REQ-5 two dispatches at once start the seat once', () => {
  it('calls the spawner once for two concurrent dispatches and delivers once', async () => fixture(async (filePath) => {
    let release!: (value: DeferredWorkerSpawnResult) => void;
    const spawnDeferredWorker = vi.fn(() => new Promise<DeferredWorkerSpawnResult>((resolve) => { release = resolve; }));
    const { service, deliverAssignment } = await setup(filePath, { spawnDeferredWorker });
    const first = service.dispatchReady(coordinator);
    const second = service.dispatchReady(coordinator);
    await vi.waitFor(() => expect(spawnDeferredWorker).toHaveBeenCalled());
    release({ ok: true, sessionId: 'late-session' });
    await Promise.all([first, second]);
    expect(spawnDeferredWorker).toHaveBeenCalledTimes(1);
    expect(deliverAssignment).toHaveBeenCalledTimes(1);
  }));
});

describe('REQ-6 a failed spawn never delivers, and a seat that cannot start does not wedge the unit', () => {
  it.each([
    ['a refusal', async () => ({ ok: false as const, message: 'spawn-failed' })],
    ['a thrown error', async () => { throw new Error('pty exploded'); }]
  ])('blocks the only unit to a person after %s, because no other seat can take it (not offered to the dead seat again)', async (_label, spawn) => fixture(async (filePath) => {
    const spawnDeferredWorker = vi.fn(spawn);
    const { service, store, deliverAssignment } = await setup(filePath, { spawnDeferredWorker });
    await service.dispatchReady(coordinator).catch(() => undefined);
    expect(spawnDeferredWorker).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
    expect(deliverAssignment).not.toHaveBeenCalled();
    expect((await unitState(store))?.state).toBe('BLOCKED');
    expect((await store.get('execution-1'))?.blockers?.[0]).toMatchObject({ audience: 'human', resolved: false });
  }));

  it('re-homes the unit to a running seat when the on-demand seat cannot start', async () => fixture(async (filePath) => {
    const spawnDeferredWorker = vi.fn(async () => ({ ok: false as const, message: 'gone' }));
    const { service, store, deliverAssignment } = await setup(filePath, {
      slotIds: ['slot-1', 'slot-2'], spawnDeferredWorker, units: [unit('a')],
      workers: [deferredWorker, { slotId: 'slot-2', sessionId: 'worker-2', projectId: 'project-1', process: 'running' }]
    });
    await service.dispatchReady(coordinator);
    expect(spawnDeferredWorker).toHaveBeenCalledTimes(1);
    expect(await unitState(store)).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-2' });
    expect(deliverAssignment).toHaveBeenCalledWith('worker-2', expect.any(String), expect.anything());
  }));

  it('keeps the unit READY for a refusal that may pass (retryable): the seat stays waiting', async () => fixture(async (filePath) => {
    const spawnDeferredWorker = vi.fn(async () => ({ ok: false as const, message: 'busy', retryable: true as const }));
    const { service, store } = await setup(filePath, { spawnDeferredWorker });
    await service.dispatchReady(coordinator);
    expect((await unitState(store))?.state).toBe('READY');
  }));

  it('a seat that ended without ever starting (restart) quarantines its unit instead of releasing it forever', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { workers: [{ slotId: 'slot-1', projectId: 'project-1', process: 'spawn-failed', onDemand: true }] });
    await service.dispatchReady(coordinator);
    expect((await unitState(store))?.state).toBe('BLOCKED');
  }));
});

describe('a start that returns after the run ended', () => {
  it('stops the new session and releases the assignment instead of leaking the session', async () => fixture(async (filePath) => {
    const closeWorkerSession = vi.fn();
    let finish!: () => void;
    const spawnDeferredWorker = vi.fn(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return { ok: true as const, sessionId: 'late-session' };
    });
    const { service, store, deliverAssignment } = await setup(filePath, { spawnDeferredWorker, closeWorkerSession });
    const dispatching = service.dispatchReady(coordinator);
    await vi.waitFor(() => expect(spawnDeferredWorker).toHaveBeenCalled());
    const record = await store.get('execution-1');
    await store.transition(record!.id, record!.stateVersion, 'STOPPED', 'info', 'test stop');
    finish();
    await dispatching;
    expect(isTerminal((await store.get('execution-1'))?.state)).toBe(true);
    expect(closeWorkerSession).toHaveBeenCalledWith('late-session');
    expect(deliverAssignment).not.toHaveBeenCalled();
  }));
});

describe('several on-demand seats in one dispatch start together', () => {
  it('starts them concurrently, not one after another', async () => fixture(async (filePath) => {
    let inflight = 0; let peak = 0;
    const spawnDeferredWorker = vi.fn(async (_r: string, slotId: string) => {
      inflight += 1; peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inflight -= 1;
      return { ok: true as const, sessionId: `late-${slotId}` };
    });
    const { service, deliverAssignment } = await setup(filePath, {
      slotIds: ['slot-1', 'slot-2'], units: [unit('a'), unit('b')], spawnDeferredWorker,
      workers: [deferredWorker, { ...deferredWorker, slotId: 'slot-2' }]
    });
    await service.dispatchReady(coordinator);
    expect(peak).toBe(2);
    expect(deliverAssignment).toHaveBeenCalledTimes(2);
  }));
});

describe('REQ-7 routing does not need a live session', () => {
  it('picks the deferred seat when it is the only eligible one', async () => fixture(async (filePath) => {
    const spawnDeferredWorker = vi.fn(async () => ({ ok: true as const, sessionId: 'late-session' }));
    const { service, store } = await setup(filePath, {
      slotIds: ['slot-1', 'slot-2'],
      workers: [deferredWorker, { slotId: 'slot-2', sessionId: 'worker-2', projectId: 'project-1', process: 'exited' }],
      spawnDeferredWorker
    });
    await service.dispatchReady(coordinator);
    expect(await unitState(store)).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1' });
    expect(spawnDeferredWorker).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
  }));
});

describe('OBL-004 a second dispatch sees a claimed but unbound seat', () => {
  // Changed in fix-review-1 with the coordinator's approval (blocker qa-test-change-1): the engine gives a busy
  // slot only one unit (store.ts freeSlots excludes CLAIMED slots), so two simultaneous deliveries to one seat
  // cannot happen. The defect behind it, a second dispatch releasing a session-less `spawning` seat, stays pinned.
  it('lets the second dispatch join the one spawn: one spawn, one delivery to the new session, the other unit stays READY', async () => fixture(async (filePath) => {
    let release!: (value: DeferredWorkerSpawnResult) => void;
    const spawnDeferredWorker = vi.fn(() => new Promise<DeferredWorkerSpawnResult>((resolve) => { release = resolve; }));
    let workers: Array<Record<string, unknown>> = [deferredWorker];
    const { service, store, deliverAssignment } = await setup(filePath, { spawnDeferredWorker, units: [unit('a'), unit('b')], workersRef: () => workers } as never);
    const first = service.dispatchReady(coordinator);
    await vi.waitFor(() => expect(spawnDeferredWorker).toHaveBeenCalled());
    // the store claim has moved the seat to spawning, with no session yet
    workers = [{ slotId: 'slot-1', projectId: 'project-1', process: 'spawning' }];
    const second = service.dispatchReady(coordinator);
    release({ ok: true, sessionId: 'late-session' });
    await Promise.all([first, second]);
    expect(spawnDeferredWorker).toHaveBeenCalledTimes(1);
    expect(deliverAssignment).toHaveBeenCalledTimes(1);
    expect(deliverAssignment.mock.calls[0][0]).toBe('late-session');
    expect(await unitState(store, 0)).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1' });
    expect(await unitState(store, 1)).toMatchObject({ state: 'READY' });
  }));

  it('hands the next unit to the same session with no second spawn once the first one completes', async () => fixture(async (filePath) => {
    const spawnDeferredWorker = vi.fn(async () => ({ ok: true as const, sessionId: 'late-session' }));
    let workers: Array<Record<string, unknown>> = [deferredWorker];
    const { service, store, deliverAssignment } = await setup(filePath, { spawnDeferredWorker, units: [unit('a'), unit('b')], workersRef: () => workers } as never);
    await service.dispatchReady(coordinator);
    workers = [{ slotId: 'slot-1', sessionId: 'late-session', projectId: 'project-1', process: 'running' }];
    const claimed = await unitState(store, 0);
    await service.completeWork({ ...coordinator, role: 'worker', slotId: 'slot-1', principalId: 'late-session' } as never, 'a', 'done',
      { claimId: claimed!.claimId!, claimGeneration: claimed!.claimGeneration! });
    expect(spawnDeferredWorker).toHaveBeenCalledTimes(1);
    expect(deliverAssignment.mock.calls.map((call) => call[0])).toEqual(['late-session', 'late-session']);
    expect(await unitState(store, 1)).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1' });
  }));
});

describe('OBL-014 a never-started seat does not keep a dead run open (design D7, seam doc)', () => {
  const exited = { slotId: 'slot-2', sessionId: 'worker-2', projectId: 'project-1', process: 'exited', task: 'unknown' };

  it('fails the run as all-exited when every started worker has exited and only a never-started seat remains', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { slotIds: ['slot-1', 'slot-2'], workers: [deferredWorker, exited], noCoordinator: true });
    await service.status('owner', 'project-1', 'execution-1');
    expect((await store.get('execution-1'))?.state).toBe('FAILED');
  }));

  it('keeps the run RUNNING while a started worker is still alive next to a never-started seat', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { slotIds: ['slot-1', 'slot-2'], workers: [deferredWorker, { ...exited, process: 'running' }], noCoordinator: true });
    await service.status('owner', 'project-1', 'execution-1');
    expect((await store.get('execution-1'))?.state).toBe('RUNNING');
  }));

  it('control: the same exited worker with no deferred seat also fails (old behaviour)', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { slotIds: ['slot-2'], workers: [exited], noCoordinator: true });
    await service.status('owner', 'project-1', 'execution-1');
    expect((await store.get('execution-1'))?.state).toBe('FAILED');
  }));
});
