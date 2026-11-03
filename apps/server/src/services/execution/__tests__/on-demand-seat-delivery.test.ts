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
  spawnDeferredWorker?: (recordId: string, slotId: string) => Promise<DeferredWorkerSpawnResult>;
  deliverAssignment?: (...args: any[]) => Promise<any>;
  units?: Array<Record<string, unknown>>;
  slotIds?: string[];
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
    getTeamLaunch: async () => ({ id: 'lifecycle-1', orchestratorSessionId: 'coordinator', workers: opts.workers ?? [deferredWorker] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: () => true,
    deliverAssignment: deliverAssignment as never,
    resolveExactNativeRecoverySnapshots: () => [],
    ...(opts.spawnDeferredWorker ? { spawnDeferredWorker: opts.spawnDeferredWorker } : {})
  } as never);
  const started = await service.start('owner', 'project-1', {
    version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }],
    coordinationMode: 'job-team', workUnits: opts.units ?? [unit('a')]
  } as never);
  if (!started.ok) throw new Error(started.message);
  return { service, store, deliverAssignment };
}

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

describe('REQ-6 a failed spawn releases the assignment undelivered', () => {
  it.each([
    ['a refusal', async () => ({ ok: false as const, message: 'spawn-failed' })],
    ['a thrown error', async () => { throw new Error('pty exploded'); }]
  ])('leaves the unit READY and delivers nothing after %s', async (_label, spawn) => fixture(async (filePath) => {
    const spawnDeferredWorker = vi.fn(spawn);
    const { service, store, deliverAssignment } = await setup(filePath, { spawnDeferredWorker });
    await service.dispatchReady(coordinator).catch(() => undefined);
    expect(spawnDeferredWorker).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
    expect(deliverAssignment).not.toHaveBeenCalled();
    expect((await unitState(store))?.state).toBe('READY');
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
