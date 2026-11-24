import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService, OWNER_RESTART_MIN_INTERVAL_MS, type ExecutionServiceDeps } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// Plan step owner-recovery-tools (AC2, AC3): owner-scoped slot restart, unit release and respond liveness.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-owner-recovery-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
type Restart = NonNullable<ExecutionServiceDeps['restartWorker']>;
const restarted: Restart = async () => ({ ok: true, sessionId: 'session-slot-1', mode: 'restarted' });

async function setup(filePath: string, over: { restartWorker?: Restart; respawnWorker?: ExecutionServiceDeps['respawnWorker']; agentState?: () => string } = {}) {
  const clock = { t: 1_000 };
  const now = () => clock.t;
  const proc = { value: 'running' };
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const replyToSession = vi.fn(() => true);
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: coordinator.slotId, personaId: 'lead', authorizationIdDigest: 'lead-d' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 's1-d' }
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ id: 'lifecycle-1', orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'session-slot-1', projectId: 'project-1', process: proc.value }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession, now, logError: () => undefined,
    resolveExactNativeRecoverySnapshots: () => [],
    ...(over.agentState ? { getAgentState: over.agentState } : {}),
    ...(over.restartWorker ? { restartWorker: over.restartWorker } : {}),
    ...(over.respawnWorker ? { respawnWorker: over.respawnWorker } : {})
  } as never);
  const started = await service.start('owner', 'project-1', {
    version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }],
    coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }]
  } as never);
  if (!started.ok) throw new Error(started.message);
  await service.dispatchReady(coordinator);
  const unit = async () => (await store.get('execution-1'))!.workUnits![0];
  return { service, store, clock, proc, replyToSession, unit };
}

describe('restartSlotAsOwner', () => {
  it('restarts through the host hook without spending the respawn cap', async () => fixture(async (filePath) => {
    const restartWorker = vi.fn(restarted);
    const { service, store } = await setup(filePath, { restartWorker });
    const result = await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1');
    expect(result).toEqual({ ok: true, value: { slotId: 'slot-1', sessionId: 'session-slot-1', mode: 'restarted', sessionLive: true } });
    expect(restartWorker).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
    expect((await store.get('execution-1'))?.workerRespawns).toBeUndefined();
  }));

  it('rate-limits to one restart per slot per minute, then allows another', async () => fixture(async (filePath) => {
    const restartWorker = vi.fn(restarted);
    const { service, clock } = await setup(filePath, { restartWorker });
    expect((await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).ok).toBe(true);
    clock.t += OWNER_RESTART_MIN_INTERVAL_MS - 1_000;
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'RATE_LIMITED', message: expect.stringContaining('1s') });
    expect(restartWorker).toHaveBeenCalledTimes(1);
    clock.t += 1_000;
    expect((await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).ok).toBe(true);
    expect(restartWorker).toHaveBeenCalledTimes(2);
  }));

  it('a failed or throwing restart still spends the rate limit and reports the reason', async () => fixture(async (filePath) => {
    const restartWorker = vi.fn<Restart>()
      .mockResolvedValueOnce({ ok: false, reason: 'relaunch-failed', message: 'no tmux' })
      .mockRejectedValueOnce(new Error('boom'));
    const { service, clock } = await setup(filePath, { restartWorker });
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'RESTART_FAILED', message: 'relaunch-failed: no tmux' });
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    clock.t += OWNER_RESTART_MIN_INTERVAL_MS;
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'RESTART_FAILED' });
  }));

  it('is owner-scoped: a stranger, a wrong project, the coordinator slot and unknown slots are refused without a host call', async () => fixture(async (filePath) => {
    const restartWorker = vi.fn(restarted);
    const { service } = await setup(filePath, { restartWorker });
    expect(await service.restartSlotAsOwner('stranger', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.restartSlotAsOwner('owner', 'project-2', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'orchestrator:lead')).toMatchObject({ ok: false, code: 'DENIED' });
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'nope')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', '')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'x'.repeat(121))).toMatchObject({ ok: false, code: 'INVALID' });
    expect(restartWorker).not.toHaveBeenCalled();
  }));

  it('refuses without a host hook, for a terminal run, and for a non-running run', async () => fixture(async (filePath) => {
    const { service } = await setup(filePath);
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    await fixture(async (second) => {
      const restartWorker = vi.fn(restarted);
      const ctx = await setup(second, { restartWorker });
      const record = (await ctx.store.get('execution-1'))!;
      await ctx.store.transition('execution-1', record.stateVersion, 'BLOCKED', 'info', 'blocked');
      expect(await ctx.service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'INVALID' });
      const blocked = (await ctx.store.get('execution-1'))!;
      await ctx.store.transition('execution-1', blocked.stateVersion, 'STOPPED', 'info', 'stopped');
      expect(await ctx.service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'TERMINAL' });
      expect(restartWorker).not.toHaveBeenCalled();
    });
  }));

  it('does not restart a live worker that is mid-turn, and does not spend the rate limit on that refusal', async () => fixture(async (filePath) => {
    const state = { value: 'working' };
    const restartWorker = vi.fn(restarted);
    const { service } = await setup(filePath, { restartWorker, agentState: () => state.value });
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'NOT_QUIET' });
    expect(restartWorker).not.toHaveBeenCalled();
    state.value = 'idle';
    expect((await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).ok).toBe(true);
  }));

  it('restarts a dead slot even when its stale agent state says working', async () => fixture(async (filePath) => {
    const restartWorker = vi.fn<Restart>(async () => ({ ok: true, sessionId: 'new', mode: 'respawned' }));
    const { service, proc } = await setup(filePath, { restartWorker, agentState: () => 'working' });
    proc.value = 'exited';
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: true, value: { mode: 'respawned', sessionId: 'new' } });
  }));

  it('refuses a concurrent second restart of the same slot', async () => fixture(async (filePath) => {
    let release!: () => void;
    const restartWorker = vi.fn<Restart>(() => new Promise((resolve) => { release = () => resolve({ ok: true, sessionId: 's', mode: 'restarted' }); }));
    const { service } = await setup(filePath, { restartWorker });
    const first = service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1');
    await vi.waitFor(() => expect(restartWorker).toHaveBeenCalled());
    expect(await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1')).toMatchObject({ ok: false, code: 'BUSY' });
    release();
    expect((await first).ok).toBe(true);
  }));
});

describe('releaseUnitAsOwner', () => {
  it('returns a CLAIMED unit to READY (then re-dispatch), for the owner only', async () => fixture(async (filePath) => {
    const { service, unit } = await setup(filePath);
    expect(await unit()).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1' });
    expect(await service.releaseUnitAsOwner('stranger', 'project-1', 'execution-1', 'a')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await unit()).state).toBe('CLAIMED');
    const released = await service.releaseUnitAsOwner('owner', 'project-1', 'execution-1', 'a');
    expect(released.ok).toBe(true);
    expect((await unit()).history.some((entry) => entry.action === 'released')).toBe(true);
    // Not claimed any more (READY or re-claimed): releasing again is refused unless re-claimed.
    const again = await service.releaseUnitAsOwner('owner', 'project-1', 'execution-1', 'missing');
    expect(again).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('refuses invalid ids, a unit that is not claimed, and a terminal run', async () => fixture(async (filePath) => {
    const { service, store, unit } = await setup(filePath);
    expect(await service.releaseUnitAsOwner('owner', 'project-1', 'execution-1', '')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await service.releaseUnitAsOwner('owner', 'project-1', 'execution-1', 'x'.repeat(257))).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await service.releaseUnitAsOwner('owner', 'project-1', 'unknown', 'a')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const record = (await store.get('execution-1'))!;
    const claimed = await unit();
    expect(claimed.state).toBe('CLAIMED');
    await store.transition('execution-1', record.stateVersion, 'STOPPED', 'info', 'stopped');
    expect(await service.releaseUnitAsOwner('owner', 'project-1', 'execution-1', 'a')).toMatchObject({ ok: false, code: 'TERMINAL' });
  }));

  it('refuses a unit that is not CLAIMED', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath);
    const record = (await store.get('execution-1'))!;
    await store.releaseWork('execution-1', record.stateVersion, { role: 'orchestrator', slotId: 'board:owner' }, 'a');
    expect(await service.releaseUnitAsOwner('owner', 'project-1', 'execution-1', 'a')).toMatchObject({ ok: false, code: 'INVALID', message: expect.stringContaining('not claimed') });
  }));
});

describe('respondToSlotAsOwner', () => {
  it('reports sessionLive true for a live slot and delivers without restarting', async () => fixture(async (filePath) => {
    const restartWorker = vi.fn(restarted);
    const { service, store, replyToSession } = await setup(filePath, { restartWorker });
    const version = (await store.get('execution-1'))!.stateVersion;
    const result = await service.respondToSlotAsOwner('owner', 'project-1', 'execution-1', version, 'slot-1', 'hello');
    expect(result).toMatchObject({ ok: true, sessionLive: true });
    expect(replyToSession).toHaveBeenCalledWith('session-slot-1', 'hello');
    expect(restartWorker).not.toHaveBeenCalled();
  }));

  it('restarts a dead session before delivery and reports it', async () => fixture(async (filePath) => {
    const restartWorker = vi.fn<Restart>(async () => ({ ok: true, sessionId: 'session-slot-1', mode: 'respawned' }));
    const { service, store, proc, replyToSession } = await setup(filePath, { restartWorker });
    proc.value = 'exited';
    const version = (await store.get('execution-1'))!.stateVersion;
    const order: string[] = [];
    restartWorker.mockImplementationOnce(async () => { order.push('restart'); proc.value = 'running'; return { ok: true, sessionId: 'session-slot-1', mode: 'respawned' }; });
    replyToSession.mockImplementationOnce(() => { order.push('deliver'); return true; });
    const result = await service.respondToSlotAsOwner('owner', 'project-1', 'execution-1', version, 'slot-1', 'hello');
    expect(result).toMatchObject({ ok: true, sessionLive: true, restarted: 'respawned' });
    expect(order).toEqual(['restart', 'deliver']);
  }));

  it('does not deliver when a dead session cannot be restarted, and says sessionLive false', async () => fixture(async (filePath) => {
    const { service, store, proc, replyToSession } = await setup(filePath, { restartWorker: async () => ({ ok: false, reason: 'run-closing', message: 'closing' }) });
    proc.value = 'exited';
    replyToSession.mockClear();
    const version = (await store.get('execution-1'))!.stateVersion;
    const result = await service.respondToSlotAsOwner('owner', 'project-1', 'execution-1', version, 'slot-1', 'hello');
    expect(result).toMatchObject({ ok: false, code: 'RESTART_FAILED', sessionLive: false, message: expect.stringContaining('could not be restarted') });
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('a dead session inside the restart rate limit is reported, not delivered to', async () => fixture(async (filePath) => {
    const { service, store, proc, replyToSession } = await setup(filePath, { restartWorker: restarted });
    await service.restartSlotAsOwner('owner', 'project-1', 'execution-1', 'slot-1');
    proc.value = 'exited';
    replyToSession.mockClear();
    const version = (await store.get('execution-1'))!.stateVersion;
    expect(await service.respondToSlotAsOwner('owner', 'project-1', 'execution-1', version, 'slot-1', 'hi')).toMatchObject({ ok: false, code: 'RATE_LIMITED', sessionLive: false });
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('refuses a stranger and keeps the existing failure shape for an unknown slot', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { restartWorker: restarted });
    const version = (await store.get('execution-1'))!.stateVersion;
    expect(await service.respondToSlotAsOwner('stranger', 'project-1', 'execution-1', version, 'slot-1', 'hi')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.respondToSlotAsOwner('owner', 'project-1', 'execution-1', version, 'nope', 'hi')).toMatchObject({ ok: false, sessionLive: false });
  }));
});

describe('blockerSlotLive', () => {
  it('reports the blocker slot liveness and undefined for unknown blockers or the coordinator', async () => fixture(async (filePath) => {
    const { service, store, proc } = await setup(filePath);
    const record = (await store.get('execution-1'))!;
    await store.blockWork('execution-1', record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'b1', question: 'which?' });
    expect(await service.blockerSlotLive('owner', 'project-1', 'execution-1', 'b1')).toBe(true);
    proc.value = 'exited';
    expect(await service.blockerSlotLive('owner', 'project-1', 'execution-1', 'b1')).toBe(false);
    expect(await service.blockerSlotLive('owner', 'project-1', 'execution-1', 'nope')).toBeUndefined();
    expect(await service.blockerSlotLive('stranger', 'project-1', 'execution-1', 'b1')).toBeUndefined();
  }));
});
