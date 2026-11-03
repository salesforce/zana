import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

/** #580: a seat that never started must not keep a finished run open, and a lifecycle id is optional. */
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const unit = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check'] };

async function build(dir: string, workers: unknown[], lifecycleId: string | undefined, over: Record<string, unknown> = {}) {
  const filePath = join(dir, 'executions.json');
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  const spawnDeferredWorker = vi.fn(async () => ({ ok: true as const, sessionId: 'late' }));
  const service = new ExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: coordinator.slotId, personaId: 'lead', authorizationIdDigest: 'l' }, { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w' }]
    } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ ...(lifecycleId ? { id: lifecycleId } : {}), orchestratorSessionId: 'coordinator', workers }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: () => true,
    deliverAssignment: vi.fn(async () => ({ state: 'accepted' as const })),
    resolveExactNativeRecoverySnapshots: () => [],
    spawnDeferredWorker,
    ...over
  } as never);
  const started = await service.start('owner', 'project-1', {
    version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }],
    coordinationMode: 'job-team', workUnits: [unit]
  } as never);
  if (!started.ok) throw new Error(started.message);
  return { service, store, spawnDeferredWorker };
}
const withDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-on-demand-reconcile-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

describe('on-demand seats and the run state (#580)', () => {
  it('does not start a seat when the lifecycle record has no id (cannot key the spawner)', async () => withDir(async (dir) => {
    const { service, store, spawnDeferredWorker } = await build(dir, [{ slotId: 'slot-1', projectId: 'project-1', process: 'authorized' }], undefined);
    await service.dispatchReady(coordinator);
    expect(spawnDeferredWorker).not.toHaveBeenCalled();
    expect((await store.get('execution-1'))?.workUnits?.[0].state).toBe('READY');
  }));

  it('releases the assignment when the lifecycle record carries a non-string id', async () => withDir(async (dir) => {
    const { service, spawnDeferredWorker } = await build(dir, [{ slotId: 'slot-1', projectId: 'project-1', process: 'authorized' }], 7 as never);
    await service.dispatchReady(coordinator);
    expect(spawnDeferredWorker).not.toHaveBeenCalled();
  }));

  it('logs and releases when the spawner throws', async () => withDir(async (dir) => {
    const logError = vi.fn();
    const { service, store } = await build(dir, [{ slotId: 'slot-1', projectId: 'project-1', process: 'authorized' }], 'lc-1', {
      spawnDeferredWorker: async () => { throw new Error('boom'); }, logError
    });
    await service.dispatchReady(coordinator);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('slot-1'), expect.any(Error));
    expect((await store.get('execution-1'))?.workUnits?.[0].state).toBe('READY');
  }));

  it('delivers through the idle-gated path to the new session when no receipt transport is wired', async () => withDir(async (dir) => {
    const deliverToWorker = vi.fn(async () => true);
    const triggerDeliveryDrain = vi.fn();
    const { service } = await build(dir, [{ slotId: 'slot-1', projectId: 'project-1', process: 'authorized' }], 'lc-1', {
      deliverAssignment: undefined, deliverToWorker, triggerDeliveryDrain
    });
    await service.dispatchReady(coordinator);
    expect(deliverToWorker).toHaveBeenCalledWith('late', expect.any(String));
    expect(triggerDeliveryDrain).toHaveBeenCalledWith('late');
  }));

  it('keeps a run open while a seat is waiting alone, and fails it once every started seat has exited', async () => withDir(async (dir) => {
    const exited = { slotId: 'slot-0', sessionId: 's0', projectId: 'project-1', task: 'unknown', process: 'exited', exitCode: 1 };
    const seat = { slotId: 'slot-1', projectId: 'project-1', task: 'unknown', process: 'authorized' };
    const onlySeat = await build(dir, [seat], 'lc-1');
    expect(await onlySeat.service.status('owner', 'project-1', 'execution-1')).toMatchObject({ state: expect.not.stringMatching(/FAILED/) });
    await rm(join(dir, 'executions.json'), { force: true });
    const exitedAndSeat = await build(dir, [exited, seat], 'lc-1');
    expect(await exitedAndSeat.service.status('owner', 'project-1', 'execution-1')).toMatchObject({ state: 'FAILED' });
  }));
});
