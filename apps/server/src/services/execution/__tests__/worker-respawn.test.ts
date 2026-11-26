import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService, type ExecutionServiceDeps } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-worker-respawn-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const worker = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
const exited = { slotId: 'slot-1', sessionId: 'old', projectId: 'project-1', process: 'exited' };
type Respawn = NonNullable<ExecutionServiceDeps['respawnWorker']>;

async function setup(filePath: string, opts: { workers?: Array<Record<string, unknown>>; respawnWorker?: Respawn; cap?: number; onRunWarning?: ExecutionServiceDeps['onRunWarning'] } = {}) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  const service = new ExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: coordinator.slotId, personaId: 'lead', authorizationIdDigest: 'lead-d' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 's1-d' },
        { slotId: 'slot-2', personaId: 'worker', authorizationIdDigest: 's2-d' }
      ]
    } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ id: 'lifecycle-1', orchestratorSessionId: 'coordinator', workers: opts.workers ?? [exited, { ...exited, slotId: 'slot-2', sessionId: 'old-2' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: () => [],
    ...(opts.respawnWorker ? { respawnWorker: opts.respawnWorker } : {}),
    ...(opts.cap === undefined ? {} : { workerRespawnCap: opts.cap }),
    ...(opts.onRunWarning ? { onRunWarning: opts.onRunWarning } : {}),
    logError: () => undefined
  } as never);
  const started = await service.start('owner', 'project-1', {
    version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }],
    coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }]
  } as never);
  if (!started.ok) throw new Error(started.message);
  return { service, store };
}
const ok: Respawn = async () => ({ ok: true, sessionId: 'new-session' });

describe('execution worker respawn', () => {
  it('respawns a dead slot for the coordinator and counts it', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn(ok);
    const { service, store } = await setup(filePath, { respawnWorker });
    const result = await service.respawnWorker(coordinator, 'slot-1');
    expect(result).toEqual({ ok: true, value: { slotId: 'slot-1', sessionId: 'new-session', respawn: 1, cap: 2 } });
    expect(respawnWorker).toHaveBeenCalledWith('lifecycle-1', 'slot-1');
    expect((await store.get('execution-1'))?.workerRespawns).toEqual({ 'slot-1': 1 });
    const log = (await store.events('owner', 'project-1', 'execution-1')).events;
    expect(log.some((event) => /Respawned worker slot-1 \(1 of 2\)/.test(event.summary))).toBe(true);
  }));

  it('refuses a worker caller and the coordinator slots', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn(ok);
    const { service } = await setup(filePath, { respawnWorker });
    expect(await service.respawnWorker(worker, 'slot-2')).toMatchObject({ ok: false, code: 'DENIED' });
    expect(await service.respawnWorker(coordinator, 'orchestrator:lead')).toMatchObject({ ok: false, code: 'DENIED' });
    expect(await service.respawnWorker(coordinator, 'orchestrator:recovery')).toMatchObject({ ok: false, code: 'DENIED' });
    expect(respawnWorker).not.toHaveBeenCalled();
  }));

  it('refuses an unknown slot, a bad slot id and a missing execution without spending the cap', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn(ok);
    const { service, store } = await setup(filePath, { respawnWorker });
    expect(await service.respawnWorker(coordinator, 'nope')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.respawnWorker(coordinator, '')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await service.respawnWorker({ ...coordinator, executionId: 'other' }, 'slot-1')).toMatchObject({ ok: false });
    expect((await store.get('execution-1'))?.workerRespawns).toBeUndefined();
    expect(respawnWorker).not.toHaveBeenCalled();
  }));

  it('refuses a worker that is still running or has no lifecycle row, without spending the cap', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn(ok);
    const { service, store } = await setup(filePath, { respawnWorker, workers: [{ ...exited, process: 'running' }] });
    expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ ok: false, code: 'INVALID', message: expect.stringContaining('still running') });
    expect(await service.respawnWorker(coordinator, 'slot-2')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await store.get('execution-1'))?.workerRespawns).toBeUndefined();
    expect(respawnWorker).not.toHaveBeenCalled();
  }));

  it('is unavailable without a host respawn hook', async () => fixture(async (filePath) => {
    const { service } = await setup(filePath);
    expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  }));

  it('refuses a terminal execution', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn(ok);
    const { service, store } = await setup(filePath, { respawnWorker });
    const record = (await store.get('execution-1'))!;
    await store.transition('execution-1', record.stateVersion, 'STOPPED', 'info', 'stopped');
    expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ ok: false, code: 'TERMINAL' });
    expect(respawnWorker).not.toHaveBeenCalled();
  }));

  it('enforces the per-slot cap, persists it, and raises a warning when it is used up', async () => fixture(async (filePath) => {
    const onRunWarning = vi.fn();
    const respawnWorker = vi.fn(ok);
    const { service, store } = await setup(filePath, { respawnWorker, onRunWarning });
    expect((await service.respawnWorker(coordinator, 'slot-1')).ok).toBe(true);
    expect((await service.respawnWorker(coordinator, 'slot-1')).ok).toBe(true);
    const third = await service.respawnWorker(coordinator, 'slot-1');
    expect(third).toMatchObject({ ok: false, code: 'CAP_EXCEEDED' });
    expect(respawnWorker).toHaveBeenCalledTimes(2);
    expect(onRunWarning).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ slotId: 'slot-1', kind: 'worker-respawn' }));
    // Another slot has its own budget.
    expect((await service.respawnWorker(coordinator, 'slot-2')).ok).toBe(true);
    // The count survives a restart: a new store over the same file sees it.
    const reopened = createExecutionStore({ filePath, id: () => 'execution-2' });
    expect((await reopened.get('execution-1'))?.workerRespawns).toEqual({ 'slot-1': 2, 'slot-2': 1 });
    const list = (await store.events('owner', 'project-1', 'execution-1')).events;
    expect(list.some((event) => event.severity === 'warning' && /limit of 2/.test(event.summary))).toBe(true);
  }));

  it('honours a configured cap', async () => fixture(async (filePath) => {
    const { service } = await setup(filePath, { respawnWorker: ok, cap: 1 });
    expect((await service.respawnWorker(coordinator, 'slot-1')).ok).toBe(true);
    expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ ok: false, code: 'CAP_EXCEEDED' });
  }));

  it('spawns once for concurrent calls on one slot', async () => fixture(async (filePath) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const respawnWorker = vi.fn(async () => { await gate; return { ok: true as const, sessionId: 'new' }; });
    const { service, store } = await setup(filePath, { respawnWorker });
    const first = service.respawnWorker(coordinator, 'slot-1');
    const second = service.respawnWorker(coordinator, 'slot-1');
    expect(await second).toMatchObject({ ok: false, code: 'BUSY' });
    release();
    expect((await first).ok).toBe(true);
    expect(respawnWorker).toHaveBeenCalledTimes(1);
    expect((await store.get('execution-1'))?.workerRespawns).toEqual({ 'slot-1': 1 });
  }));

  it('never spends more than the cap under concurrent store reservations', async () => fixture(async (filePath) => {
    const { store } = await setup(filePath);
    const results = await Promise.all(Array.from({ length: 6 }, () => store.reserveWorkerRespawn('execution-1', 'slot-1', 2)));
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results.filter((result) => !result.ok && result.reason === 'cap')).toHaveLength(4);
    expect((await store.get('execution-1'))?.workerRespawns).toEqual({ 'slot-1': 2 });
  }));

  it('does not spend the cap on a refusal before the seat was reopened', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn<Respawn>()
      .mockResolvedValueOnce({ ok: false, reason: 'no-spawner', message: 'resume the run' })
      .mockResolvedValueOnce({ ok: false, reason: 'closing', message: 'the run is stopping' })
      .mockResolvedValueOnce({ ok: false, reason: 'unsupported', message: 'remote' })
      .mockResolvedValue({ ok: true, sessionId: 'n' });
    const { service, store } = await setup(filePath, { respawnWorker });
    for (const reason of ['no-spawner', 'closing', 'unsupported']) {
      expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ ok: false, code: 'RESPAWN_FAILED', message: expect.stringContaining(reason) });
      expect((await store.get('execution-1'))?.workerRespawns).toBeUndefined();
    }
    expect((await service.respawnWorker(coordinator, 'slot-1')).ok).toBe(true);
    expect((await service.respawnWorker(coordinator, 'slot-1')).ok).toBe(true);
    expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ code: 'CAP_EXCEEDED' });
  }));

  it('keeps the count spent once the seat was reopened, and warns', async () => fixture(async (filePath) => {
    const onRunWarning = vi.fn();
    const respawnWorker = vi.fn<Respawn>()
      .mockResolvedValueOnce({ ok: false, reason: 'spawn-failed', message: 'no capacity', committed: true })
      .mockRejectedValueOnce(new Error('boom at /Users/me/secret/x'));
    const { service, store } = await setup(filePath, { respawnWorker, onRunWarning });
    expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ ok: false, code: 'RESPAWN_FAILED', message: 'spawn-failed: no capacity' });
    const thrown = await service.respawnWorker(coordinator, 'slot-1');
    expect(thrown).toMatchObject({ ok: false, code: 'RESPAWN_FAILED' });
    expect(JSON.stringify(thrown)).not.toContain('/Users/me');
    expect(onRunWarning).toHaveBeenCalledTimes(2);
    expect((await store.get('execution-1'))?.workerRespawns).toEqual({ 'slot-1': 2 });
    expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ code: 'CAP_EXCEEDED' });
  }));

  it('answers QUEUED, without spending the cap, for a worker already waiting to restart', async () => fixture(async (filePath) => {
    const respawnWorker = vi.fn(ok);
    const { service, store } = await setup(filePath, { respawnWorker, workers: [{ slotId: 'slot-1', projectId: 'project-1', process: 'authorized', onDemand: true, respawned: 'normal' }] });
    expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ ok: false, code: 'QUEUED' });
    expect(respawnWorker).not.toHaveBeenCalled();
    expect((await store.get('execution-1'))?.workerRespawns).toBeUndefined();
  }));

  it('records the exhausted cap once per slot, however often it is asked again', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { respawnWorker: ok, cap: 1 });
    await service.respawnWorker(coordinator, 'slot-1');
    for (let index = 0; index < 4; index += 1) expect(await service.respawnWorker(coordinator, 'slot-1')).toMatchObject({ code: 'CAP_EXCEEDED' });
    const list = (await store.events('owner', 'project-1', 'execution-1')).events;
    expect(list.filter((event) => /was not respawned/.test(event.summary))).toHaveLength(1);
  }));

  it('refund of an unspent slot is a no-op and a started respawn on a finished run adds no event', async () => fixture(async (filePath) => {
    const { store } = await setup(filePath);
    await store.settleWorkerRespawn('execution-1', 'slot-1', { refund: true });
    expect((await store.get('execution-1'))?.workerRespawns).toBeUndefined();
    const record = (await store.get('execution-1'))!;
    await store.transition('execution-1', record.stateVersion, 'STOPPED', 'info', 'stopped');
    const before = (await store.events('owner', 'project-1', 'execution-1')).events.length;
    await store.settleWorkerRespawn('execution-1', 'slot-1', { started: { count: 1, cap: 2 } });
    expect((await store.events('owner', 'project-1', 'execution-1')).events.length).toBe(before);
    await expect(store.settleWorkerRespawn('missing', 'slot-1', { refund: true })).rejects.toThrow(/not found/);
  }));

  it('store refuses orchestrator and unknown slots and non-running runs', async () => fixture(async (filePath) => {
    const { store } = await setup(filePath);
    expect(await store.reserveWorkerRespawn('execution-1', 'orchestrator:lead')).toEqual({ ok: false, reason: 'orchestrator-slot' });
    expect(await store.reserveWorkerRespawn('execution-1', 'zzz')).toEqual({ ok: false, reason: 'unknown-slot' });
    const record = (await store.get('execution-1'))!;
    await store.transition('execution-1', record.stateVersion, 'STOPPED', 'info', 'stopped');
    await expect(store.reserveWorkerRespawn('execution-1', 'slot-1')).rejects.toThrow(/stopped/);
    await expect(store.reserveWorkerRespawn('missing', 'slot-1')).rejects.toThrow(/not found/);
  }));
});
