import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp as mkdtempAsync, rm as rmAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { createTeamLifecycleStore } from '../../launch/team-lifecycle-store.js';

// Acceptance tests for REQ-9 (start launch failure closes the team), REQ-13 (cleanup once),
// REQ-14 (Cancel reports incomplete) and REQ-15 (closing marker). Red until
// launch-throw-hardening and failed-run-cleanup land.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtempAsync(join(tmpdir(), 'zcc-swi-launch-cleanup-'));
  try { await run(join(dir, 'executions.json')); } finally { await rmAsync(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }]
};

function deps(filePath: string, over: Record<string, unknown> = {}) {
  return {
    store: createExecutionStore({ filePath, id: () => 'execution-1' }),
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? [],
    ...over
  } as unknown as ConstructorParameters<typeof SquadExecutionService>[0];
}

describe('start() launch failure closes the team (REQ-9)', () => {
  it('closes the sessions of this launch request exactly once when the launch throws', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const d = deps(filePath, { launchTeam: async () => { throw new Error('tail exploded'); }, cancelTeamLaunch });
    const service = new SquadExecutionService(d);
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false });
    expect(cancelTeamLaunch).toHaveBeenCalledTimes(1);
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    service.dispose();
  }));

  it('closes the sessions when the launch returns not ok', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { launchTeam: async () => ({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'no seats' }), cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    expect(cancelTeamLaunch).toHaveBeenCalledTimes(1);
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    service.dispose();
  }));

  it('never cancels a launch request that belongs to another run', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { launchTeam: async () => { throw new Error('boom'); }, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    for (const call of cancelTeamLaunch.mock.calls as unknown as Array<[string, string]>) expect(call[1]).toBe('request-1');
    service.dispose();
  }));
});

describe('failed-run cleanup runs once (REQ-13)', () => {
  it('cancels the launch once when status reads race on a run failed by a failed slot', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const launchTeam = async () => ({ ok: true, value: { failedSlots: [{ slotId: 'slot-2', personaId: 'qa', reason: 'spawn failed' }] } });
    const service = new SquadExecutionService(deps(filePath, { launchTeam, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', { ...request, coordinationMode: 'structured' } as never);
    await Promise.all([1, 2, 3].map(() => service.status('session-1', 'project-1', 'execution-1')));
    expect(cancelTeamLaunch).toHaveBeenCalledTimes(1);
    service.dispose();
  }));
});

describe('Cancel verifies the stop (REQ-14)', () => {
  it('reports CANCEL_INCOMPLETE when a session survives the bounded wait', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: ['worker-1'] } }));
    const getTeamLaunch = async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }] });
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch, getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    const record = await service.status('session-1', 'project-1', 'execution-1');
    await expect(service.stop('session-1', 'project-1', 'execution-1', record!.stateVersion))
      .resolves.toMatchObject({ ok: false, code: 'CANCEL_INCOMPLETE' });
    service.dispose();
  }), 30_000);

  it('reports success when nothing is pending (existing path unchanged)', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    const record = await service.status('session-1', 'project-1', 'execution-1');
    await expect(service.stop('session-1', 'project-1', 'execution-1', record!.stateVersion))
      .resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    service.dispose();
  }));
});

describe('durable closing marker (REQ-15)', () => {
  const dirs: string[] = [];
  afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
  const principal = { kind: 'team' as const, id: 'team:t', allowedProjectIds: ['p'], allowedTeamIds: ['t'], maxConcurrent: 4, maxLaunchesPerRun: 32 };
  const worker = { sessionId: 's1', authorizationId: 'a1', cohortId: 'c', slotId: '1:w:0', personaId: 'w', projectId: 'p', process: 'spawning' as const, attention: 'active' as const, task: 'unknown' as const, delivery: 'bound-at-spawn' as const };

  async function openRun() {
    const dir = mkdtempSync(join(tmpdir(), 'swi-closing-'));
    dirs.push(dir);
    const filePath = join(dir, 'lifecycle.json');
    const store = createTeamLifecycleStore({ filePath });
    const claim = await store.claim({ callerPrincipalId: 'o', launchRequestId: 'r', payloadDigest: 'd', capacity: { principal, launched: 0 } } as never);
    await store.addWorker(claim.record.id, worker);
    return { store, id: claim.record.id, filePath };
  }

  it('markClosing returns true once and false after, and isClosing reflects it', async () => {
    const { store, id } = await openRun();
    expect(store.isClosing(id)).toBe(false);
    expect(await store.markClosing(id)).toBe(true);
    expect(store.isClosing(id)).toBe(true);
    expect(await store.markClosing(id)).toBe(false);
  });

  it('persists the closing marker across a reload', async () => {
    const { store, id, filePath } = await openRun();
    await store.markClosing(id);
    expect(createTeamLifecycleStore({ filePath }).isClosing(id)).toBe(true);
  });

  it('refuses a late spawn commit on a closing run', async () => {
    const { store, id } = await openRun();
    expect(await store.workerMaySpawn(id, '1:w:0')).toBe(true);
    await store.markClosing(id);
    expect(await store.workerMaySpawn(id, '1:w:0')).toBe(false);
    expect(await store.claimWorkerRunning(id, '1:w:0')).toBe(false);
  });

  it('leaves a run that is not closing spawnable (existing-user path)', async () => {
    const { store, id } = await openRun();
    expect(await store.claimWorkerRunning(id, '1:w:0')).toBe(true);
  });
});
