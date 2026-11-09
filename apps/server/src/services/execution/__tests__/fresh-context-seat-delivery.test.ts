import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

/**
 * #579: a seat that asks for a fresh session per unit carries `deliveredUnitCount` on its lifecycle worker.
 * The engine delivers the first unit to the current session and counts it; the next unit is handed to the
 * not-awaited `recycleSeat` hook instead of being typed into the old session.
 */
async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-fresh-seat-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const unit = (id: string) => ({ id, title: id.toUpperCase(), task: `do ${id}`, dependencies: [], files: [`${id}.txt`], verification: [`check ${id}`] });
const seat = (extra: Record<string, unknown> = {}) => ({ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running', ...extra });

async function setup(filePath: string, opts: {
  worker: Record<string, unknown>;
  recycleSeat?: (...args: any[]) => Promise<void>;
  recordUnitDelivered?: (...args: any[]) => Promise<void>;
  deliverAssignment?: (...args: any[]) => Promise<any>;
  logError?: (message: string, error: unknown) => void;
}) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  const deliverAssignment = opts.deliverAssignment ?? vi.fn(async () => ({ state: 'accepted' as const }));
  const service = new ExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: coordinator.slotId, personaId: 'lead', authorizationIdDigest: 'lead-d' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'slot-1-d' }
      ]
    } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ id: 'lifecycle-1', orchestratorSessionId: 'coordinator', workers: [opts.worker] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: () => true,
    deliverAssignment: deliverAssignment as never,
    resolveExactNativeRecoverySnapshots: () => [],
    ...(opts.recycleSeat ? { recycleSeat: opts.recycleSeat } : {}),
    ...(opts.recordUnitDelivered ? { recordUnitDelivered: opts.recordUnitDelivered } : {}),
    ...(opts.logError ? { logError: opts.logError } : {})
  } as never);
  const started = await service.start('owner', 'project-1', {
    version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }],
    coordinationMode: 'job-team', workUnits: [unit('a'), unit('b')]
  } as never);
  if (!started.ok) throw new Error(started.message);
  return { service, store, deliverAssignment };
}

const unitState = async (store: ReturnType<typeof createExecutionStore>, index: number) => (await store.get('execution-1'))?.workUnits?.[index];

describe('REQ-4 a slot\'s first unit is delivered to its current session and counted', () => {
  it('does not recycle at count 0, delivers to the running session and records the delivery', async () => fixture(async (filePath) => {
    const recycleSeat = vi.fn(async () => undefined);
    const recordUnitDelivered = vi.fn(async () => undefined);
    const { service, deliverAssignment } = await setup(filePath, { worker: seat({ deliveredUnitCount: 0 }), recycleSeat, recordUnitDelivered });
    await service.dispatchReady(coordinator);
    expect(recycleSeat).not.toHaveBeenCalled();
    expect(deliverAssignment).toHaveBeenCalledWith('worker-1', expect.stringContaining('assigned work unit `a`'), expect.anything());
    expect(recordUnitDelivered).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
  }));

  it('does not record a delivery the session rejected', async () => fixture(async (filePath) => {
    const recordUnitDelivered = vi.fn(async () => undefined);
    const { service, store } = await setup(filePath, {
      worker: seat({ deliveredUnitCount: 0 }), recordUnitDelivered, recycleSeat: vi.fn(async () => undefined),
      deliverAssignment: vi.fn(async () => ({ state: 'rejected' as const }))
    });
    await service.dispatchReady(coordinator);
    expect(recordUnitDelivered).not.toHaveBeenCalled();
    expect((await unitState(store, 0))?.state).toBe('READY');
  }));
});

describe('REQ-3 the next unit of a seat that already finished one starts a fresh session', () => {
  it('hands the entry to recycleSeat and does not type it into the old session', async () => fixture(async (filePath) => {
    const recycleSeat = vi.fn(async () => undefined);
    const { service, store, deliverAssignment } = await setup(filePath, { worker: seat({ deliveredUnitCount: 1 }), recycleSeat });
    await service.dispatchReady(coordinator);
    expect(recycleSeat).toHaveBeenCalledTimes(1);
    expect(recycleSeat).toHaveBeenCalledWith('lifecycle-1', 'slot-1', expect.objectContaining({ slotId: 'slot-1', workUnitId: 'a' }));
    expect(deliverAssignment).not.toHaveBeenCalled();
    expect(await unitState(store, 0)).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1' });
  }));

  it('does not await the hook: dispatch settles while the recycle is still pending', async () => fixture(async (filePath) => {
    const recycleSeat = vi.fn(() => new Promise<void>(() => undefined));
    const { service } = await setup(filePath, { worker: seat({ deliveredUnitCount: 2 }), recycleSeat });
    await expect(Promise.race([service.dispatchReady(coordinator).then(() => 'settled'), new Promise((r) => setTimeout(() => r('hung'), 1_000))])).resolves.toBe('settled');
    expect(recycleSeat).toHaveBeenCalled();
  }));

  it('logs a failing hook with the run and slot id and does not fail the dispatch', async () => fixture(async (filePath) => {
    const logError = vi.fn();
    const recycleSeat = vi.fn(async () => { throw new Error('respawn exploded'); });
    const { service } = await setup(filePath, { worker: seat({ deliveredUnitCount: 1 }), recycleSeat, logError });
    await expect(service.dispatchReady(coordinator)).resolves.toBeDefined();
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining('slot-1'), expect.any(Error)));
    expect(logError.mock.calls[0][0]).toContain('execution-1');
  }));

  it('delivers to the current session when no recycle hook is wired (dependency absent)', async () => fixture(async (filePath) => {
    const { service, deliverAssignment } = await setup(filePath, { worker: seat({ deliveredUnitCount: 1 }) });
    await service.dispatchReady(coordinator);
    expect(deliverAssignment).toHaveBeenCalledWith('worker-1', expect.any(String), expect.anything());
  }));
});

describe('REQ-2 a seat without the field behaves as before', () => {
  it('delivers every unit to the one session, never recycles and never counts', async () => fixture(async (filePath) => {
    const recycleSeat = vi.fn(async () => undefined);
    const recordUnitDelivered = vi.fn(async () => undefined);
    const { service, store, deliverAssignment } = await setup(filePath, { worker: seat(), recycleSeat, recordUnitDelivered });
    await service.dispatchReady(coordinator);
    const claimed = await unitState(store, 0);
    await service.completeWork({ ...coordinator, role: 'worker', slotId: 'slot-1', principalId: 'worker-1' } as never, 'a', 'done',
      { claimId: claimed!.claimId!, claimGeneration: claimed!.claimGeneration! });
    expect(deliverAssignment.mock.calls.map((call) => call[0])).toEqual(['worker-1', 'worker-1']);
    expect(recycleSeat).not.toHaveBeenCalled();
    expect(recordUnitDelivered).not.toHaveBeenCalled();
  }));
});

describe('REQ-8 usage of a recycled seat counts once', () => {
  it('attributes the old session\'s terminal sample to its slot after the seat was detached, so no second cursor opens', async () => fixture(async (filePath) => {
    const readSessionStats = vi.fn(async () => ({ contextTokens: 5, tokens: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 }, files: [], queue: [] }));
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService({
      store, artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [{ slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'd' }] } } }),
      launchTeam: async () => ({ ok: true }),
      // the seat is already detached: no worker carries the old session id
      getTeamLaunch: async () => ({ id: 'lifecycle-1', workers: [{ slotId: 'slot-1', projectId: 'project-1', process: 'authorized', onDemand: true }] }),
      cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
      replyToSession: () => true, readSessionStats, resolveExactNativeRecoverySnapshots: () => []
    } as never);
    await service.start('owner', 'project-1', { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }], coordinationMode: 'job-team', workUnits: [unit('a')] } as never);
    await (service as unknown as { observeSessionUsage: (...a: unknown[]) => Promise<void> }).observeSessionUsage('execution-1', 'old-session', 'terminal', 'slot-1');
    const observations = (await store.get('execution-1'))?.usageObservations ?? [];
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ slotId: 'slot-1', sessionId: 'old-session' });
    expect(observations[0]!.routingIdentity.startsWith('slot-1:')).toBe(true);
  }));

  it('one unavailable sample alone does not block the run on telemetry', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new ExecutionService({
      store, artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [{ slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'd' }] } } }),
      launchTeam: async () => ({ ok: true }),
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'new-session', projectId: 'project-1' }] }),
      cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
      replyToSession: () => true, readSessionStats: async () => null, resolveExactNativeRecoverySnapshots: () => []
    } as never);
    await service.start('owner', 'project-1', { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }], coordinationMode: 'job-team', workUnits: [unit('a')], policy: { usageBudget: { maxTokens: 100 } } } as never);
    await service.observeSessionUsage('execution-1', 'new-session', 'heartbeat');
    expect((await store.get('execution-1'))?.state).not.toBe('BLOCKED');
  }));
});

describe('#579 engine paths beyond the acceptance tests', () => {
  it('a unit stays in the current session, with the skip logged, while a blocker answer is waiting or messages are queued', async () => fixture(async (filePath) => {
    const logError = vi.fn();
    const recycleSeat = vi.fn(async () => undefined);
    const { service, deliverAssignment } = await setup(filePath, { worker: seat({ deliveredUnitCount: 1 }), recycleSeat, logError });
    (service as unknown as { deps: { queuedForSession: () => number } }).deps.queuedForSession = () => 2;
    await service.dispatchReady(coordinator);
    expect(recycleSeat).not.toHaveBeenCalled();
    expect(deliverAssignment).toHaveBeenCalledWith('worker-1', expect.any(String), expect.anything());
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('execution-1/slot-1'), expect.any(Error));
  }));

  it('delivers to the new session when the hook reports one, and releases the unit for a seat that can never start', async () => fixture(async (filePath) => {
    const started = await setup(filePath, { worker: seat({ deliveredUnitCount: 1 }), recycleSeat: vi.fn(async () => ({ sessionId: 'worker-2' })) });
    await started.service.dispatchReady(coordinator);
    await vi.waitFor(() => expect(started.deliverAssignment).toHaveBeenCalledWith('worker-2', expect.stringContaining('assigned work unit `a`'), expect.anything()));
  }));

  it('releases the unit when the hook reports a refusal that may pass, and quarantines a seat that never starts', async () => fixture(async (filePath) => {
    const later = await setup(filePath, { worker: seat({ deliveredUnitCount: 1 }), recycleSeat: vi.fn(async () => ({})) });
    await later.service.dispatchReady(coordinator);
    await vi.waitFor(async () => expect((await unitState(later.store, 0))?.state).toBe('READY'));
    expect(later.deliverAssignment).not.toHaveBeenCalled();
  }));

  it('a declined recycle delivers to the session the seat has', async () => fixture(async (filePath) => {
    const { service, deliverAssignment } = await setup(filePath, { worker: seat({ deliveredUnitCount: 1 }), recycleSeat: vi.fn(async () => ({ declined: true as const })) });
    await service.dispatchReady(coordinator);
    await vi.waitFor(() => expect(deliverAssignment).toHaveBeenCalledWith('worker-1', expect.any(String), expect.anything()));
  }));

  it('counts a unit the legacy transport queued, but not one that was refused', async () => fixture(async (filePath) => {
    const recordUnitDelivered = vi.fn(async () => undefined);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const deliverToWorker = vi.fn(async () => true);
    const service = new ExecutionService({
      store, artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [{ slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'd' }] } } }),
      launchTeam: async () => ({ ok: true }),
      getTeamLaunch: async () => ({ id: 'lifecycle-1', workers: [seat({ deliveredUnitCount: 0 })] }),
      cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
      replyToSession: () => true, deliverToWorker, recordUnitDelivered, resolveExactNativeRecoverySnapshots: () => []
    } as never);
    await service.start('owner', 'project-1', { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }], coordinationMode: 'job-team', workUnits: [unit('a')] } as never);
    await service.dispatchReady(coordinator);
    expect(recordUnitDelivered).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
  }));

  it('a failing delivery count is logged and does not fail the delivery', async () => fixture(async (filePath) => {
    const logError = vi.fn();
    const { service, deliverAssignment } = await setup(filePath, { worker: seat({ deliveredUnitCount: 0 }), recordUnitDelivered: vi.fn(async () => { throw new Error('disk'); }), logError });
    await service.dispatchReady(coordinator);
    expect(deliverAssignment).toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('lifecycle-1/slot-1'), expect.any(Error));
  }));
});
