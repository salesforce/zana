import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService, type ExecutionServiceDeps } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-failed-run-cleanup-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }]
};

type Cancel = ExecutionServiceDeps['cancelTeamLaunch'];
const done = { ok: true, value: { canceledSessionIds: ['w'], pendingSessionIds: [], lifecycleState: 'canceled' } };

function deps(filePath: string, over: Partial<ExecutionServiceDeps> = {}) {
  const sleep = vi.fn(async () => undefined);
  return {
    store: createExecutionStore({ filePath, id: () => 'execution-1' }),
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }] }),
    cancelTeamLaunch: (async () => done) as Cancel,
    cancelSettle: { attempts: 3, intervalMs: 5, sleep },
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: () => [],
    ...over
  } as ExecutionServiceDeps & { store: ReturnType<typeof createExecutionStore> };
}

const failedSlotsLifecycle = {
  workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }],
  launchResult: { failedSlots: [{ slotId: 'slot-2', reason: 'spawn refused' }] }
};

describe('failed run cleanup', () => {
  it('cancels the launch once when reconcile writes FAILED, even with no squad worktree', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const service = new ExecutionService(deps(filePath, { getTeamLaunch: async () => failedSlotsLifecycle, cancelTeamLaunch: cancel as Cancel }));
    await service.start('session-1', 'project-1', request);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('session-1', 'request-1');
    // Later status reads see a terminal record and never cancel again.
    await service.status('session-1', 'project-1', 'execution-1');
    expect(cancel).toHaveBeenCalledTimes(1);
    service.dispose();
  }));

  it('only the caller that wrote the transition cancels: concurrent reconciles cancel once', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const onTerminal = vi.fn();
    const service = new ExecutionService(deps(filePath, { getTeamLaunch: async () => failedSlotsLifecycle, cancelTeamLaunch: cancel as Cancel, onTerminal }));
    await service.start('session-1', 'project-1', request);
    const reads = await Promise.all([1, 2, 3, 4].map(() => service.status('session-1', 'project-1', 'execution-1')));
    expect(reads.every((record) => record?.state === 'FAILED')).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    service.dispose();
  }));

  it('a launch that throws is cancelled once by the caller that wrote FAILED', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const service = new ExecutionService(deps(filePath, { cancelTeamLaunch: cancel as Cancel, launchTeam: async () => { throw new Error('boom'); } }));
    const result = await service.start('owner', 'project-1', request);
    expect(result).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    expect(cancel).toHaveBeenCalledTimes(1);
    service.dispose();
  }));

  it('a throwing launch still cancels directly when the FAILED write itself throws', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const d = deps(filePath, { cancelTeamLaunch: cancel as Cancel, launchTeam: async () => { throw new Error('boom'); } });
    const realTransition = d.store.transition.bind(d.store);
    vi.spyOn(d.store, 'transition').mockImplementation(async (...args: Parameters<typeof realTransition>) => {
      if (args[2] === 'FAILED') throw new Error('disk full');
      return realTransition(...args);
    });
    const service = new ExecutionService(d);
    await expect(service.start('owner', 'project-1', request)).rejects.toThrow('disk full');
    expect(cancel).toHaveBeenCalledTimes(1);
    service.dispose();
  }));

  it('does not cancel when another writer already made the run terminal before failLaunch', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const d = deps(filePath, { cancelTeamLaunch: cancel as Cancel, launchTeam: async () => ({ ok: true }) });
    const service = new ExecutionService(d);
    await service.start('owner', 'project-1', request);
    const current = (await d.store.get('execution-1'))!;
    await d.store.transition(current.id, current.stateVersion, 'STOPPED', 'info', 'stopped elsewhere');
    const failed = await (service as unknown as { failLaunch(r: unknown, s: string): Promise<{ state: string }> }).failLaunch(current, 'late failure');
    expect(failed.state).toBe('STOPPED');
    expect(cancel).not.toHaveBeenCalled();
    service.dispose();
  }));

  it('cleanup never touches another run\'s launch request', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const service = new ExecutionService(deps(filePath, { getTeamLaunch: async () => failedSlotsLifecycle, cancelTeamLaunch: cancel as Cancel }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');
    for (const call of cancel.mock.calls as unknown as string[][]) expect(call.slice(0, 2)).toEqual(['session-1', 'request-1']);
    service.dispose();
  }));

  it('a failed-run cancel that throws is logged and does not undo the FAILED transition', async () => fixture(async (filePath) => {
    const logError = vi.fn();
    const service = new ExecutionService(deps(filePath, {
      getTeamLaunch: async () => failedSlotsLifecycle, logError,
      cancelTeamLaunch: (async () => { throw new Error('lifecycle down'); }) as Cancel
    }));
    await service.start('session-1', 'project-1', request);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('failed-launch cleanup'), expect.any(Error));
    service.dispose();
  }));
});

describe('cancel verifies the stop', () => {
  const pending = (ids: string[], lifecycleState = 'cancel-pending') => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: ids, lifecycleState } });

  it('reports CANCEL_INCOMPLETE and keeps the run active when a session refuses to die', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => pending(['worker-1']));
    const d = deps(filePath, { cancelTeamLaunch: cancel as Cancel });
    const service = new ExecutionService(d);
    await service.start('owner', 'project-1', request);
    const stopped = await service.stop('owner', 'project-1', 'execution-1', 4);
    expect(stopped).toMatchObject({ ok: false, code: 'CANCEL_INCOMPLETE' });
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(d.cancelSettle!.sleep).toHaveBeenCalledTimes(2);
    expect((await d.store.get('execution-1'))?.state).not.toBe('STOPPED');
    service.dispose();
  }));

  it('a session that is still closing when first asked, then gone, is a verified stop', async () => fixture(async (filePath) => {
    const cancel = vi.fn()
      .mockResolvedValueOnce(pending(['worker-1']))
      .mockResolvedValueOnce(pending(['worker-1']))
      .mockResolvedValue(done);
    const d = deps(filePath, { cancelTeamLaunch: cancel as Cancel });
    const service = new ExecutionService(d);
    await service.start('owner', 'project-1', request);
    const stopped = await service.stop('owner', 'project-1', 'execution-1', 4);
    expect(stopped).toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(cancel).toHaveBeenCalledTimes(3);
    service.dispose();
  }));

  it('a closed-but-not-yet-exited launch (cancel-pending, nothing pending) is waited on, not success', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [], lifecycleState: 'cancel-pending' } }));
    const service = new ExecutionService(deps(filePath, { cancelTeamLaunch: cancel as Cancel }));
    await service.start('owner', 'project-1', request);
    const stopped = await service.stop('owner', 'project-1', 'execution-1', 4);
    expect(stopped).toMatchObject({ ok: false, code: 'CANCEL_INCOMPLETE', message: 'Team sessions are still closing' });
    service.dispose();
  }));

  it('does not retry a refused cancellation inside the wait and passes NOT_FOUND through', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => ({ ok: false, code: 'NOT_FOUND', message: 'gone' }));
    const service = new ExecutionService(deps(filePath, { cancelTeamLaunch: cancel as Cancel }));
    await service.start('owner', 'project-1', request);
    const stopped = await service.stop('owner', 'project-1', 'execution-1', 4);
    expect(stopped).toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(cancel).toHaveBeenCalledTimes(1);
    service.dispose();
  }));

  it('Stop on a FAILED run reports pending sessions instead of success', async () => fixture(async (filePath) => {
    const cancel = vi.fn()
      .mockResolvedValueOnce(done) // written-FAILED cleanup
      .mockResolvedValue(pending(['worker-1']));
    const d = deps(filePath, { getTeamLaunch: async () => failedSlotsLifecycle, cancelTeamLaunch: cancel as Cancel });
    const service = new ExecutionService(d);
    await service.start('session-1', 'project-1', request);
    const failed = await service.status('session-1', 'project-1', 'execution-1');
    expect(failed?.state).toBe('FAILED');
    const stopped = await service.stop('session-1', 'project-1', 'execution-1', failed!.stateVersion);
    expect(stopped).toMatchObject({ ok: false, code: 'CANCEL_INCOMPLETE' });
    service.dispose();
  }));

  it('double Stop, reconcile and start cleanup each see a settled launch without surfacing an error', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const d = deps(filePath, { getTeamLaunch: async () => failedSlotsLifecycle, cancelTeamLaunch: cancel as Cancel });
    const service = new ExecutionService(d);
    await service.start('session-1', 'project-1', request);
    const failed = await service.status('session-1', 'project-1', 'execution-1');
    const [a, b] = await Promise.all([
      service.stop('session-1', 'project-1', 'execution-1', failed!.stateVersion),
      service.stop('session-1', 'project-1', 'execution-1', failed!.stateVersion)
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    service.dispose();
  }));

  it('plan-correction stop throws on surviving sessions so the card is not resolved', async () => fixture(async (filePath) => {
    const cancel = vi.fn()
      .mockResolvedValueOnce(pending(['worker-1']))
      .mockResolvedValueOnce(pending(['worker-1']))
      .mockResolvedValueOnce(pending(['worker-1']))
      .mockResolvedValue(done);
    const d = deps(filePath, { cancelTeamLaunch: cancel as Cancel });
    const service = new ExecutionService(d);
    const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team' });
    if (!started.ok) throw new Error(started.message);
    await expect(service.stopForPlanCorrection(started.value.id)).rejects.toThrow('CANCEL_INCOMPLETE');
    await expect(service.stopForPlanCorrection(started.value.id)).resolves.toMatchObject({ state: 'STOPPED' });
    service.dispose();
  }));

  it('dismiss keeps the card visible while sessions survive', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => pending(['worker-1']));
    const service = new ExecutionService(deps(filePath, { getTeamLaunch: async () => failedSlotsLifecycle, cancelTeamLaunch: cancel as Cancel }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');
    await expect(service.dismiss('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'CANCEL_INCOMPLETE' });
    service.dispose();
  }));

  it('lands FAILED and cancels once when members bump stateVersion during a failing launch', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const d = deps(filePath, { cancelTeamLaunch: cancel as Cancel });
    d.launchTeam = (async () => {
      for (let i = 0; i < 3; i += 1) {
        const current = (await d.store.get('execution-1'))!;
        await d.store.event('execution-1', current.stateVersion, 'info', `member progress ${i}`);
      }
      return { ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'spawn refused' };
    }) as ExecutionServiceDeps['launchTeam'];
    const service = new ExecutionService(d);
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
    expect(cancel).toHaveBeenCalledTimes(1);
    service.dispose();
  }));
});

describe('single Stop on a BLOCKED run', () => {
  it('lands STOPPED in one call even when cancelling closes sessions that advance stateVersion', async () => fixture(async (filePath) => {
    let store: ReturnType<typeof createExecutionStore>;
    let bumps = 0;
    const cancel = vi.fn(async () => {
      // A closing session's exit event writes to the run while the cancel is in flight, twice.
      for (let i = 0; i < 2; i += 1) {
        const live = (await store.get('execution-1'))!;
        await store.command(live.id, live.stateVersion, 'worker exit recorded');
        bumps += 1;
      }
      return done;
    });
    const d = deps(filePath, { cancelTeamLaunch: cancel as Cancel });
    store = d.store;
    const service = new ExecutionService(d);
    await service.start('session-1', 'project-1', request);
    const running = (await store.get('execution-1'))!;
    const blocked = await store.transition(running.id, running.stateVersion, 'BLOCKED', 'warning', 'lost its only worker');
    const stopped = await service.stop('session-1', 'project-1', 'execution-1', blocked.stateVersion);
    expect(stopped).toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect((await store.get('execution-1'))?.state).toBe('STOPPED');
    expect(bumps).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    service.dispose();
  }));

  it('accepts a terminal state another actor wrote during the cancel without rewriting it', async () => fixture(async (filePath) => {
    let store: ReturnType<typeof createExecutionStore>;
    const cancel = vi.fn(async () => {
      const live = (await store.get('execution-1'))!;
      await store.transition(live.id, live.stateVersion, 'FAILED', 'error', 'failed elsewhere');
      return done;
    });
    const d = deps(filePath, { cancelTeamLaunch: cancel as Cancel });
    store = d.store;
    const service = new ExecutionService(d);
    await service.start('session-1', 'project-1', request);
    const running = (await store.get('execution-1'))!;
    const blocked = await store.transition(running.id, running.stateVersion, 'BLOCKED', 'warning', 'lost its only worker');
    const stopped = await service.stop('session-1', 'project-1', 'execution-1', blocked.stateVersion);
    expect(stopped).toMatchObject({ ok: true, value: { state: 'FAILED' } });
    service.dispose();
  }));
});
