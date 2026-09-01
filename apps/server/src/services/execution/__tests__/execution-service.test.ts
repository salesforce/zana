import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService, type ExecutionRequestV1, SquadExecutionService, deriveJobTitle } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { createResumeGrantStore } from '../resume-grant-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-service-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release\nignored',
  slots: [{ initialTask: 'Run tests' }]
};

function deps(filePath: string, over: Partial<ConstructorParameters<typeof SquadExecutionService>[0]> = {}) {
  return {
    store: createExecutionStore({ filePath, id: () => 'execution-1' }),
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession: () => true,
    ...over
  };
}

describe('SquadExecutionService', () => {
  it('exposes generic execution API while defaulting durable launch metadata to Team', async () => fixture(async (filePath) => {
    const service = new ExecutionService(deps(filePath));
    const genericRequest: ExecutionRequestV1 = { ...request, launchDisplay: { label: 'Release execution' } };
    const started = await service.start('session-1', 'project-1', genericRequest);
    expect(started).toMatchObject({
      ok: true,
      value: { launchKind: 'team', launchDisplay: { label: 'Release execution' }, request: { launchKind: 'team', launchDisplay: { label: 'Release execution' } } }
    });
  }));

  it('persists generic preplanned work before launching the Team', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new ExecutionService(deps(filePath, { launchTeam }));
    const started = await service.start('session-1', 'project-1', {
      ...request,
      coordinationMode: 'job-team',
      workUnits: [{ id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }]
    });
    expect(started).toMatchObject({ ok: true, value: { workUnits: [expect.objectContaining({ id: 'a', state: 'READY' })] } });
    expect(launchTeam).toHaveBeenCalledTimes(1);
  }));

  it('replays pre-normalization records when launchKind remains omitted', async () => fixture(async (filePath) => {
    let launchCount = 0;
    const input = deps(filePath, { launchTeam: async () => { launchCount += 1; return { ok: true }; } });
    const service = new ExecutionService(input);
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: true });
    const state = JSON.parse(await readFile(filePath, 'utf8')) as { records: Array<{ launchKind?: unknown; launchDisplay?: unknown; request: Record<string, unknown> }> };
    delete state.records[0].launchKind;
    delete state.records[0].launchDisplay;
    delete state.records[0].request.launchKind;
    delete state.records[0].request.launchDisplay;
    await writeFile(filePath, JSON.stringify(state));

    const replay = await service.start('session-1', 'project-1', request);
    expect(replay).toMatchObject({ ok: true, value: { id: 'execution-1' } });
    expect(launchCount).toBe(1);
  }));

  it('treats explicit Team launch kind as the legacy default for idempotency', async () => fixture(async (filePath) => {
    let launchCount = 0;
    const service = new ExecutionService(deps(filePath, { launchTeam: async () => { launchCount += 1; return { ok: true }; } }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: true });
    await expect(service.start('session-1', 'project-1', { ...request, launchKind: 'team' })).resolves.toMatchObject({ ok: true, value: { id: 'execution-1' } });
    expect(launchCount).toBe(1);
  }));

  it('separates host-bound coordinator and worker authority across executions', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('owner-1', 'project-1', request);
    await service.start('owner-2', 'project-1', { ...request, launchRequestId: 'request-2' });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead-1', role: 'orchestrator' as const };
    const worker = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    await expect(service.registerPlan(coordinator, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }])).resolves.toMatchObject({ ok: true });
    await expect(service.claimWork(worker, 'a')).resolves.toMatchObject({ ok: true, value: { workUnits: [{ assignedSlotId: 'slot-1' }] } });
    await expect(service.completeWork({ ...worker, slotId: 'slot-2' }, 'a', 'forged')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeByCoordinatorBinding({ ...coordinator, executionId: 'execution-2' }, 'execution-1', 'forged')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
  }));

  it('separates coordinator assignment from worker self-claim', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', request);
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, slotId: 'worker-1', role: 'worker' as const };
    await service.registerPlan(coordinator, [
      { id: 'assigned', title: 'Assigned', task: 'Assigned', dependencies: [], readOnly: true },
      { id: 'claimed', title: 'Claimed', task: 'Claimed', dependencies: [], readOnly: true }
    ]);
    await expect(service.claimWork(coordinator, 'assigned')).resolves.toEqual({
      ok: false, code: 'DENIED', message: 'coordinator must use execution.work.assign'
    });
    await expect(service.assignWork(coordinator, 'assigned', 'worker-1')).resolves.toMatchObject({ ok: true });
    await expect(service.claimWork(worker, 'claimed')).resolves.toMatchObject({
      ok: true, value: { workUnits: expect.arrayContaining([expect.objectContaining({ id: 'claimed', assignedSlotId: 'worker-1' })]) }
    });
  }));

  it('rejects coordinator work outcomes while allowing assigned workers', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', request);
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, slotId: 'worker-1', role: 'worker' as const };
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'a', title: 'A', task: 'A', dependencies: [], files: ['a.txt'], verification: ['check a'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, coordinator, 'a', 'worker-1');
    await expect(service.completeWork(coordinator, 'a', 'wrong')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.failWork(coordinator, 'a', 'wrong')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.blockWork(coordinator, 'a', { id: 'b', question: 'Wrong?' })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.releaseWork(coordinator, 'a')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeWork(worker, 'a', 'done')).resolves.toMatchObject({ ok: true });
  }));

  it('lets execution owner retry, release, and reassign eligible work only within durable roster', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'slot-1', personaId: 'persona', authorizationIdDigest: 'digest-1' },
        { slotId: 'slot-2', personaId: 'persona', authorizationIdDigest: 'digest-2' }
      ] }
    } }) }));
    await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team' });
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'failed', title: 'Failed', task: 'Retry me', dependencies: [], files: ['failed.txt'], verification: ['check failed'] },
      { id: 'claimed', title: 'Claimed', task: 'Release me', dependencies: [], files: ['claimed.txt'], verification: ['check claimed'] },
      { id: 'ready', title: 'Ready', task: 'Reassign me', dependencies: [], files: ['ready.txt'], verification: ['check ready'] }
    ]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'failed', 'slot-1');
    record = await store.failWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'failed', 'boom');
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'claimed', 'slot-1');

    const board = service as SquadExecutionService & {
      retryWorkFromBoard(owner: string, project: string, execution: string, version: number, unit: string, slot?: string): Promise<unknown>;
      releaseWorkFromBoard(owner: string, project: string, execution: string, version: number, unit: string): Promise<unknown>;
      reassignWorkFromBoard(owner: string, project: string, execution: string, version: number, unit: string, slot: string): Promise<unknown>;
    };
    expect(typeof board.retryWorkFromBoard).toBe('function');
    await expect(board.retryWorkFromBoard('other', 'project-1', record.id, record.stateVersion, 'failed', 'slot-2')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(board.retryWorkFromBoard('owner', 'project-1', record.id, record.stateVersion, 'failed', 'forged')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    const retried = await board.retryWorkFromBoard('owner', 'project-1', record.id, record.stateVersion, 'failed', 'slot-2') as { ok: true; value: typeof record };
    expect(retried.value.workUnits).toContainEqual(expect.objectContaining({ id: 'failed', state: 'READY', assignedSlotId: 'slot-2' }));
    const released = await board.releaseWorkFromBoard('owner', 'project-1', record.id, retried.value.stateVersion, 'claimed') as { ok: true; value: typeof record };
    expect(released.value.workUnits?.find((unit) => unit.id === 'claimed')).toMatchObject({ id: 'claimed', state: 'READY' });
    expect(released.value.workUnits?.find((unit) => unit.id === 'claimed')).not.toHaveProperty('assignedSlotId');
    const reassigned = await board.reassignWorkFromBoard('owner', 'project-1', record.id, released.value.stateVersion, 'ready', 'slot-1') as { ok: true; value: typeof record };
    expect(reassigned.value.workUnits).toContainEqual(expect.objectContaining({ id: 'ready', state: 'READY', assignedSlotId: 'slot-1' }));
  }));

  it('accepts producer events and artifacts from bound cohort and stamps authority server-side', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('owner', 'project-1', request);
    const worker = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    await expect(service.reportBoundEvent(worker, { id: 'event-1', type: 'progress', severity: 'info', summary: 'working' })).resolves.toMatchObject({ ok: true });
    await expect(service.putBoundArtifact(worker, 'result.md', 'text/markdown', 'done')).resolves.toMatchObject({ ok: true });
    const events = await service.events('owner', 'project-1', 'execution-1');
    expect(events.events).toContainEqual(expect.objectContaining({ id: 'event-1', slotId: 'slot-1', producerRole: 'worker' }));
  }));

  it('binds source reads to the coordinator execution and persisted content reference', async () => fixture(async (filePath) => {
    const sources = { list: vi.fn(async () => ({ sources: [{ id: 'source-1' }] })), read: vi.fn(async () => ({ content: 'chunk', totalBytes: 5 })) };
    const service = new SquadExecutionService(deps(filePath, { sources: sources as never }));
    await service.start('owner', 'project-1', { ...request, sourceBundle: { contentRef: 'request-1/sources.json', sources: [{ id: 'source-1', name: 'source.txt', mediaType: 'text/plain', byteSize: 5, contentDigest: `sha256:${'1'.repeat(64)}`, extractionStatus: 'READY', extractionWarnings: [] }] } });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead', role: 'orchestrator' as const };
    await expect(service.listSources(coordinator, { offset: 0, limit: 10 })).resolves.toMatchObject({ ok: true });
    await expect(service.readSource(coordinator, 'source-1', { offset: 0, maxBytes: 4 })).resolves.toMatchObject({ ok: true, value: { content: 'chunk' } });
    await expect(service.readSource({ ...coordinator, role: 'worker' as const }, 'source-1', { offset: 0, maxBytes: 4 })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    expect(sources.read).toHaveBeenCalledWith(
      'request-1/sources.json',
      'source-1',
      { offset: 0, maxBytes: 4 },
      [expect.objectContaining({ id: 'source-1', contentDigest: `sha256:${'1'.repeat(64)}` })],
      expect.any(Function)
    );
  }));

  it('runs execution-aware source retention as best-effort maintenance', async () => fixture(async (filePath) => {
    const retainedSourceContentRefs = vi.fn(async () => new Set(['execution-1/sources.json']));
    const pruneSnapshots = vi.fn(async () => undefined);
    const store = createExecutionStore({ filePath });
    const service = new SquadExecutionService(deps(filePath, {
      store: { ...store, retainedSourceContentRefs } as never,
      sources: { list: vi.fn(), read: vi.fn(), pruneSnapshots } as never
    }));
    await expect(service.pruneRetainedSources()).resolves.toBeUndefined();
    expect(pruneSnapshots).toHaveBeenCalledWith(new Set(['execution-1/sources.json']), 30 * 24 * 60 * 60 * 1_000);

    retainedSourceContentRefs.mockRejectedValueOnce(new Error('store unavailable'));
    await expect(service.pruneRetainedSources()).resolves.toBeUndefined();
  }));

  it('requires the live coordinator for explicit completion', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.completeByCoordinator('worker-1', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeByCoordinator('coordinator', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: true, value: { state: 'COMPLETED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('allows a bound monitor to complete after its coordinator exits', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }));
    const input = deps(filePath, { getTeamLaunch });
    const service = new SquadExecutionService(input);
    await service.start('session-1', 'project-1', request);
    await input.store.addEffectiveOwner('execution-1', 'monitor');
    await expect(service.completeByCoordinator('monitor', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: true, value: { state: 'COMPLETED' } });
  }));

  it('keeps an execution running when its coordinator exits for monitor recovery', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.handleCoordinatorExit('project-1', 'execution-1', 'monitor');
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    await service.handleCoordinatorExit('project-1', 'execution-1', 'coordinator');
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('stops an overdue execution and cancels its Team lifecycle', async () => fixture(async (filePath) => {
    let now = Date.now();
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, {
      now: () => now,
      cancelTeamLaunch,
      getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] })
    }));
    await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });
    now += 101;
    await expect(service.status('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ state: 'STOPPED' });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('stops at its deadline without renderer status or list polling', async () => fixture(async (filePath) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    try {
      const store = createExecutionStore({ filePath, id: () => 'execution-1', now: Date.now });
      const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
      const service = new SquadExecutionService(deps(filePath, { store, now: Date.now, cancelTeamLaunch }));

      await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });
      await vi.advanceTimersByTimeAsync(101);

      await expect(store.get('execution-1')).resolves.toMatchObject({ state: 'STOPPED' });
      expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    } finally {
      vi.useRealTimers();
    }
  }));

  it('cancels workers spawned after deadline wins during launch startup', async () => fixture(async (filePath) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    try {
      let releaseLaunch!: () => void;
      const launchStarted = new Promise<void>((resolve) => { releaseLaunch = resolve; });
      const launchTeam = vi.fn(async () => {
        await launchStarted;
        return { ok: true };
      });
      const cancelTeamLaunch = vi.fn()
        .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'lifecycle not reserved yet' })
        .mockResolvedValue({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } });
      const store = createExecutionStore({ filePath, id: () => 'execution-1', now: Date.now });
      const service = new SquadExecutionService(deps(filePath, { store, now: Date.now, launchTeam, cancelTeamLaunch }));

      const starting = service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });
      await vi.advanceTimersByTimeAsync(101);
      await vi.waitFor(async () => expect(await store.get('execution-1')).toMatchObject({ state: 'STOPPED' }));
      releaseLaunch();

      await expect(starting).resolves.toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });
      await vi.waitFor(() => expect(cancelTeamLaunch).toHaveBeenCalledTimes(2));
      expect((await store.get('execution-1'))?.state).toBe('STOPPED');
    } finally {
      vi.useRealTimers();
    }
  }));

  it('retries timeout cancellation when cancellation returns failure or throws', async () => fixture(async (filePath) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    try {
      const cancelTeamLaunch = vi.fn()
        .mockResolvedValueOnce({ ok: false, code: 'TRANSPORT', message: 'cancel unavailable' })
        .mockRejectedValueOnce(new Error('cancel threw'))
        .mockResolvedValue({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } });
      const store = createExecutionStore({ filePath, id: () => 'execution-1', now: Date.now });
      const service = new SquadExecutionService(deps(filePath, { store, now: Date.now, cancelTeamLaunch }));
      await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 100 } });

      await vi.advanceTimersByTimeAsync(101);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(cancelTeamLaunch).toHaveBeenCalledTimes(3);
      expect((await store.get('execution-1'))?.state).toBe('STOPPED');
    } finally {
      vi.useRealTimers();
    }
  }));

  it('re-arms an active deadline on idempotent start replay', async () => fixture(async (filePath) => {
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const setTimer = vi.fn((fn: () => void) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id as unknown as NodeJS.Timeout;
    });
    const clearTimer = vi.fn((timer: NodeJS.Timeout) => timers.delete(timer as unknown as number));
    const service = new SquadExecutionService(deps(filePath, { setTimer, clearTimer }));
    await service.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 1_000 } });
    service.dispose();
    expect(timers.size).toBe(0);

    const replayService = new SquadExecutionService(deps(filePath, { setTimer, clearTimer }));
    await replayService.start('session-1', 'project-1', { ...request, policy: { deadlineMs: 1_000 } });
    expect(timers.size).toBe(1);
    replayService.dispose();
  }));

  it('clears deadline timers on stop, completion, and dispose', async () => fixture(async (filePath) => {
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const setTimer = vi.fn((fn: () => void) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id as unknown as NodeJS.Timeout;
    });
    const clearTimer = vi.fn((timer: NodeJS.Timeout) => timers.delete(timer as unknown as number));
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })() });
    const service = new SquadExecutionService(deps(filePath, {
      store, setTimer, clearTimer,
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [] })
    }));

    const first = await service.start('owner', 'project-1', { ...request, policy: { deadlineMs: 1_000 } });
    if (!first.ok) throw new Error(first.message);
    await service.stop('owner', 'project-1', first.value.id, first.value.stateVersion);
    expect(timers.size).toBe(0);

    const second = await service.start('owner', 'project-1', { ...request, launchRequestId: 'request-2', policy: { deadlineMs: 1_000 } });
    if (!second.ok) throw new Error(second.message);
    await service.completeByCoordinator('coordinator', 'project-1', second.value.id, 'Done');
    expect(timers.size).toBe(0);

    await service.start('owner', 'project-1', { ...request, launchRequestId: 'request-3', policy: { deadlineMs: 1_000 } });
    service.dispose();
    expect(timers.size).toBe(0);
    expect(clearTimer).toHaveBeenCalledTimes(3);
  }));

  it('restores persisted active deadlines on boot without project polling', async () => fixture(async (filePath) => {
    let now = 1_000;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    const first = new SquadExecutionService(deps(filePath, { store, now: () => now }));
    await first.start('owner', 'project-1', { ...request, policy: { deadlineMs: 100 } });
    first.dispose();
    now = 1_101;

    const pending: Array<() => void> = [];
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const restored = new SquadExecutionService(deps(filePath, {
      store, now: () => now, cancelTeamLaunch,
      setTimer: ((fn: () => void) => { pending.push(fn); return pending.length as unknown as NodeJS.Timeout; }),
      clearTimer: vi.fn()
    }));
    await restored.restoreDeadlines();
    expect(pending).toHaveLength(1);
    pending[0]();
    await vi.waitFor(async () => expect(await store.get('execution-1')).toMatchObject({ state: 'STOPPED' }));
    expect(cancelTeamLaunch).toHaveBeenCalledWith('owner', 'request-1');
    restored.dispose();
  }));

  it('prefers caller job title and launches only after durable reservation and authorization', async () => fixture(async (filePath) => {
    const authorizeTeamLaunch = vi.fn(() => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTask: 'Run tests', authorizationId: 'auth-1' }],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [{ slotId: 'slot-1', personaId: 'persona-1', authorizationIdDigest: 'sha256:auth' }] }
    } }));
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch, launchTeam }));
    const result = await service.start('session-1', 'project-1', { ...request, jobTitle: 'Caller title' });
    expect(result).toMatchObject({ ok: true, value: { id: 'execution-1', jobTitle: 'Caller title', state: 'RUNNING', authorizationContext: { principalId: 'team:team-1:session-1:request-1' }, authorizationContextDigest: expect.any(String), launchIntent: { slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTaskDigest: expect.any(String) }] } } });
    expect(authorizeTeamLaunch).toHaveBeenCalledWith('session-1', 'team-1', 'project-1', 'request-1', {}, request.slots);
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.objectContaining({ requirePreauthorization: true }));
  }));

  it('preserves worker-only generic launch behavior unless Job Team mode is explicit', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, { launchTeam }));
    await service.start('session-1', 'project-1', request);
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.not.objectContaining({ coordinationMode: 'job-team' }));
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.not.objectContaining({ jobContext: expect.anything() }));
  }));

  it('blocks before launch when Team authorization rejects', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn();
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch: () => ({ ok: false as const, code: 'DENIED', message: 'team disabled' }), launchTeam, getTeamLaunch: async () => undefined }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toEqual({ ok: false, code: 'DENIED', message: 'team disabled' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('retries a pre-dispatch authorization block with a fresh Team launch request', async () => fixture(async (filePath) => {
    let calls = 0;
    const authorizeTeamLaunch = vi.fn((_caller: string, _team: string, _project: string, launchRequestId: string) => {
      calls += 1;
      if (calls === 1) return { ok: false as const, code: 'DENIED', message: 'team temporarily disabled' };
      return { ok: true as const, value: {
        teamId: 'team-1', projectId: 'project-1', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTask: 'Run tests', authorizationId: 'fresh-auth' }],
        context: { version: 1 as const, principalId: `team:team-1:session-1:${launchRequestId}`, authorizedAt: 10, expiresAt: 20, slots: [{ slotId: 'slot-1', personaId: 'persona-1', authorizationIdDigest: 'sha256:fresh' }] }
      } };
    });
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch, launchTeam }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    const blocked = await service.status('session-1', 'project-1', 'execution-1');
    if (!blocked) throw new Error('missing blocked execution');
    await expect(service.retry('session-1', 'project-1', 'execution-1', blocked.stateVersion)).resolves.toMatchObject({ ok: true, value: { id: 'execution-1', attempt: 2, state: 'RUNNING', teamLaunchRequestId: 'execution-1:attempt:2' } });
    expect(authorizeTeamLaunch).toHaveBeenLastCalledWith('session-1', 'team-1', 'project-1', 'execution-1:attempt:2', {}, request.slots);
    expect(launchTeam).toHaveBeenCalledWith('team-1', 'project-1', expect.objectContaining({ launchRequestId: 'execution-1:attempt:2', executionId: 'execution-1', executionJobTitle: 'Build release' }));
  }));

  it('uses immutable audit owner for retries requested by an effective owner', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let tokenNumber = 0;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `resume-token-${++tokenNumber}` });
    let calls = 0;
    const authorizeTeamLaunch = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? { ok: false as const, code: 'DENIED', message: 'blocked' }
        : { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'owner', authorizedAt: 10, expiresAt: 20, slots: [] } } };
    });
    const service = new SquadExecutionService(deps(filePath, { store, resumeGrants: grants, authorizeTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    const grant = await service.mintResumeGrant('session-1', 'project-1', 'execution-1');
    if (!grant.ok) throw new Error('missing replacement grant');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', grant.value.token)).resolves.toMatchObject({ ok: true });
    const blocked = await store.get('execution-1');
    if (!blocked) throw new Error('missing execution');
    await expect(service.retry('session-2', 'project-1', 'execution-1', blocked.stateVersion)).resolves.toMatchObject({ ok: true });
    expect(authorizeTeamLaunch).toHaveBeenLastCalledWith('session-1', 'team-1', 'project-1', 'execution-1:attempt:2', {}, request.slots);
  }));

  it('reruns workflow profile preflight before retry', async () => fixture(async (filePath) => {
    let preflights = 0;
    const service = new SquadExecutionService(deps(filePath, {
      authorizeTeamLaunch: () => ({ ok: false as const, code: 'DENIED', message: 'team disabled' }),
      preflightWorkflow: () => (++preflights === 1 ? { ok: true } : { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'profile drifted' })
    }));
    const workflow = { schemaVersion: 1 as const, profileId: 'profile', profileVersion: '1', controller: { personaId: 'controller', slotId: 'orchestrator:controller' }, workers: [], supportedRequestVersions: [1] };
    await service.start('session-1', 'project-1', { ...request, workflow });
    const record = await service.status('session-1', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.retry('session-1', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'profile drifted' });
  }));

  it('blocks before launch when Team authorization lacks a durable context', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn();
    const service = new SquadExecutionService(deps(filePath, {
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [] } }),
      launchTeam
    }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'AUTHORIZATION_CONTEXT_UNAVAILABLE' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('derives title from first summary line and confines reads to execution owner', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    expect(deriveJobTitle(request)).toBe('Build release');
    expect(await service.status('replacement-session', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.list('replacement-session', 'project-1')).toEqual([]);
    expect(await service.events('replacement-session', 'project-1', 'execution-1')).toEqual({ events: [] });
    expect(await service.status('replacement-session', 'other-project', 'execution-1')).toBeUndefined();
    expect(await service.list('replacement-session', 'other-project')).toEqual([]);
    expect(await service.events('replacement-session', 'other-project', 'execution-1')).toEqual({ events: [] });
    await expect(service.stop('replacement-session', 'project-1', 'execution-1', 3)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('rebinds a fresh owner with one durable grant without rewriting audit ownership', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }));
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, getTeamLaunch, cancelTeamLaunch }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true, value: { callerPrincipalId: 'session-1', effectiveOwnerPrincipalIds: ['session-2'] } });
    expect(await service.status('session-2', 'project-1', 'execution-1')).toMatchObject({ id: 'execution-1' });
    expect(await service.events('session-2', 'project-1', 'execution-1')).toMatchObject({ events: expect.any(Array) });
    const record = await service.status('session-2', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('session-2', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: true });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    await expect(service.resumeBinding('session-3', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false });
  }));

  it('rejects resume binding while an existing execution owner remains live', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants,
      hasLivePredecessor: (_projectId, ownerIds) => ownerIds.includes('session-1')
    }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken))
      .resolves.toEqual({ ok: false, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' });
  }));

  it('serializes competing resume bindings so only one replacement owner is admitted', async () => fixture(async (filePath) => {
    let token = 0;
    let firstCheck = true;
    let releaseCheck!: () => void;
    const checkStarted = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `resume-token-${++token}` });
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants,
      hasLivePredecessor: (_projectId, ownerIds) => {
        if (firstCheck) {
          firstCheck = false;
          releaseCheck();
          return false;
        }
        return ownerIds.includes('session-2');
      }
    }));
    await service.start('session-1', 'project-1', request);
    const replacement = await service.mintResumeGrant('session-1', 'project-1', 'execution-1');
    if (!replacement.ok) throw new Error('missing replacement grant');
    const binding = service.resumeBinding('session-2', 'project-1', 'execution-1', replacement.value.token);
    await checkStarted;
    const competing = service.resumeBinding('session-3', 'project-1', 'execution-1', replacement.value.token);
    await expect(binding).resolves.toMatchObject({ ok: true });
    await expect(competing).resolves.toEqual({
      ok: false, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor'
    });
  }));

  it('recovers a consumed binding after transient effective-owner persistence failure', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const addEffectiveOwner = store.addEffectiveOwner;
    let failOnce = true;
    const service = new SquadExecutionService(deps(filePath, {
      store: { ...store, addEffectiveOwner: async (...args) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('temporary write failure');
        }
        return addEffectiveOwner(...args);
      } },
      resumeGrants: grants
    }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false, code: 'BINDING_TRANSIENT' });
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true, value: { effectiveOwnerPrincipalIds: ['session-2'] } });
  }));

  it('revokes an abandoned consumed binding and removes its effective owner', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('abandoned-monitor', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await service.abandonResumeBinding('project-1', 'execution-1', 'abandoned-monitor');
    await expect(service.resumeBinding('abandoned-monitor', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await service.status('abandoned-monitor', 'project-1', 'execution-1')).toBeUndefined();
  }));

  it('lets immutable owner mint a replacement grant after start token is lost', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'replacement-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    await service.start('session-1', 'project-1', request);
    await expect(service.mintResumeGrant('other', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.mintResumeGrant('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: true, value: { token: 'replacement-token', expiresAt: expect.any(Number), generation: 1, recoveryGeneration: 1 } });
  }));

  it('converges after repeated CAS failures without advancing durable grant more than one generation', async () => fixture(async (filePath) => {
    let token = 0;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `token-${++token}` });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const rotateRecoveryGeneration = store.rotateRecoveryGeneration;
    let crashesRemaining = 2;
    const service = new SquadExecutionService(deps(filePath, {
      store: { ...store, rotateRecoveryGeneration: async (...args) => {
        if (crashesRemaining > 0) { crashesRemaining -= 1; throw new Error('simulated crash after grant rotate'); }
        return rotateRecoveryGeneration(...args);
      } },
      resumeGrants: grants
    }));
    await service.start('session-1', 'project-1', request);
    const record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    await expect(service.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    await expect(service.resumeBinding('replacement', 'project-1', record.id, 'token-2')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.resumeBinding('replacement', 'project-1', record.id, 'token-3')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: true, value: { token: 'token-4', generation: 1, recoveryGeneration: 1 } });
    await expect(service.resumeBinding('replacement', 'project-1', record.id, 'token-4')).resolves.toMatchObject({ ok: true });
  }));

  it('caps replacement grant expiry at fixed execution recovery deadline', async () => fixture(async (filePath) => {
    let clock = 10_000;
    let token = 0;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, now: () => clock, token: () => `token-${++token}` });
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => clock });
    const service = new SquadExecutionService(deps(filePath, { store, resumeGrants: grants, now: () => clock }));
    await service.start('session-1', 'project-1', request);
    const record = await store.get('execution-1');
    if (!record?.recoveryDeadlineAt) throw new Error('missing recovery deadline');
    clock += 20 * 24 * 60 * 60 * 1_000;
    const minted = await service.mintResumeGrant('session-1', 'project-1', record.id);
    expect(minted).toMatchObject({ ok: true, value: { expiresAt: record.recoveryDeadlineAt } });
  }));

  it('rotates recovery only after verified coordinator loss with exact CAS binding', async () => fixture(async (filePath) => {
    let token = 0;
    const cacheResumeToken = vi.fn();
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `token-${++token}` });
    let live = false;
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants, cacheResumeToken,
      hasLivePredecessor: () => live
    }));
    await service.start('session-1', 'project-1', request);
    const record = await service.status('session-1', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');

    await expect(service.rotateRecoveryGrant('other-project', record.id, record.stateVersion, 0)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    live = true;
    await expect(service.rotateRecoveryGrant(record.projectId, record.id, record.stateVersion, 0)).resolves.toEqual({ ok: false, code: 'LIVE_PREDECESSOR', message: 'execution still has a live coordinator' });
    live = false;
    await expect(service.rotateRecoveryGrant(record.projectId, record.id, record.stateVersion - 1, 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    const rotated = await service.rotateRecoveryGrant(record.projectId, record.id, record.stateVersion, 0);
    expect(rotated).toMatchObject({ ok: true, value: { recoveryGeneration: 1, generation: 1, token: 'token-2' } });
    expect(cacheResumeToken).toHaveBeenLastCalledWith('project-1', 'execution-1', 'token-2', expect.any(Number));
    await expect(service.resumeBinding('replacement', 'project-1', 'execution-1', 'token-1')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.resumeBinding('replacement', 'project-1', 'execution-1', 'token-2')).resolves.toMatchObject({ ok: true });
    await expect(service.resumeBinding('replacement', 'project-1', 'execution-1', 'token-2')).resolves.toMatchObject({ ok: true });
  }));

  it('denies terminal recovery rotation and converges after token-cache failure', async () => fixture(async (filePath) => {
    let token = 0;
    let failCache = false;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `token-${++token}` });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, {
      store, resumeGrants: grants,
      cacheResumeToken: () => { if (failCache) throw new Error('cache failed'); }
    }));
    await service.start('session-1', 'project-1', request);
    failCache = true;
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    await expect(service.rotateRecoveryGrant('project-1', running.id, running.stateVersion, 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    const converging = await store.get(running.id);
    expect(converging).toMatchObject({ recoveryGeneration: 1 });
    failCache = false;
    await expect(service.rotateRecoveryGrant('project-1', running.id, converging!.stateVersion, 1)).resolves.toMatchObject({ ok: true, value: { generation: 2 } });
    const latest = await store.get(running.id);
    await store.transition(running.id, latest!.stateVersion, 'STOPPED', 'info', 'stopped');
    const terminal = await store.get(running.id);
    await expect(service.rotateRecoveryGrant('project-1', running.id, terminal!.stateVersion, terminal!.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));

  it('revokes durable grants and clears in-app token after terminal service transition', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const clearResumeToken = vi.fn();
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, clearResumeToken }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    const record = await service.status('session-1', 'project-1', 'execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('session-1', 'project-1', 'execution-1', record.stateVersion)).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(clearResumeToken).toHaveBeenCalledWith('project-1', 'execution-1');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('runs terminal grant and token cleanup after coordinator completion', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const revoke = vi.spyOn(grants, 'revoke');
    const clearResumeToken = vi.fn();
    const service = new SquadExecutionService(deps(filePath, {
      resumeGrants: grants, clearResumeToken,
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [] })
    }));
    await service.start('session-1', 'project-1', request);
    await expect(service.completeByCoordinator('coordinator', 'project-1', 'execution-1', 'done')).resolves.toMatchObject({ ok: true });
    expect(revoke).toHaveBeenCalledWith('execution-1', 'project-1');
    expect(clearResumeToken).toHaveBeenCalledWith('project-1', 'execution-1');
  }));

  it('writes the initial resume token only through main-owned storage', async () => fixture(async (filePath) => {
    const cacheResumeToken = vi.fn();
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, cacheResumeToken }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: true });
    expect(cacheResumeToken).toHaveBeenCalledWith('project-1', 'execution-1', 'resume-token', expect.any(Number));
  }));

  it('permits a fresh owner to bind and resume a blocked execution', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, resumeGrants: grants }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    const blocked = await store.transition('execution-1', running.stateVersion, 'BLOCKED', 'warning', 'Waiting');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await expect(service.resume('session-2', 'project-1', 'execution-1', blocked.stateVersion + 1, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: true, value: { state: 'RUNNING' } });
  }));

  it('rejects a consumed handoff when its execution became terminal', async () => fixture(async (filePath) => {
    const dependencySet = deps(filePath);
    const cancelTeamLaunch = vi.fn(dependencySet.cancelTeamLaunch);
    const service = new SquadExecutionService({ ...dependencySet, cancelTeamLaunch });
    await service.start('session-1', 'project-1', request);
    const running = await service.status('session-1', 'project-1', 'execution-1');
    if (!running) throw new Error('missing execution');
    await dependencySet.store.transition('execution-1', running.stateVersion, 'COMPLETED', 'info', 'Execution completed');
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'session-1', projectId: 'project-1', executionId: 'execution-1' }, 'stop', running.stateVersion + 1)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('records producer events once with stable sequence and owner scope', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    const input = { id: 'event-1', slotId: 'slot-1', type: 'blocker' as const, severity: 'warning' as const, summary: 'Need input', blocker: { question: 'Ship now?', options: ['yes', 'no'] } };
    await expect(service.reportEvent('other', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.reportEvent('session-1', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: true, value: { outcome: 'accepted', event: { sequence: expect.any(Number), blocker: input.blocker } } });
    await expect(service.reportEvent('session-1', 'project-1', 'execution-1', input)).resolves.toMatchObject({ ok: true, value: { outcome: 'replay' } });
  }));

  it('rejects bound work, events, and artifacts after terminal execution', async () => fixture(async (filePath) => {
    const input = deps(filePath);
    const service = new SquadExecutionService(input);
    await service.start('owner', 'project-1', request);
    const running = await input.store.get('execution-1');
    if (!running) throw new Error('missing execution');
    await input.store.transition(running.id, running.stateVersion, 'COMPLETED', 'info', 'Done');
    const worker = { executionId: 'execution-1', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const };
    await expect(service.claimWork(worker, 'unit')).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
    await expect(service.reportBoundEvent(worker, { id: 'late', type: 'progress', severity: 'info', summary: 'late' })).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
    await expect(service.putBoundArtifact(worker, 'late.txt', 'text/plain', 'late')).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));


  it('completes worker-only Teams from worker task reports', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ projectId: 'project-1', task: 'caller-reported-complete' }] }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('COMPLETED');
  }));

  it('blocks a replay when lifecycle evidence is missing instead of trusting durable execution state', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => undefined }));
    await service.start('session-1', 'project-1', request);
    await expect(service.start('session-1', 'project-1', request)).resolves.toEqual({
      ok: false, code: 'BLOCKED', message: 'execution is blocked'
    });
  }));

  it('records failed state when authorization throws', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath, { authorizeTeamLaunch: () => { throw new Error('authorization store unavailable'); }, getTeamLaunch: async () => undefined }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, message: 'authorization store unavailable' });
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('does not report a failed launch as success after a concurrent state update', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const launchTeam = vi.fn(async () => {
      const record = await store.get('execution-1');
      if (!record) throw new Error('missing execution');
      await store.event(record.id, record.stateVersion, 'info', 'Concurrent update');
      throw new Error('launch transport failed');
    });
    const service = new SquadExecutionService(deps(filePath, { store, launchTeam }));
    await expect(service.start('session-1', 'project-1', request)).resolves.toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    expect((await store.get('execution-1'))?.state).toBe('FAILED');
  }));

  it('does not block status polling during durable startup before Team lifecycle exists', async () => fixture(async (filePath) => {
    let releaseAuthorization!: () => void;
    const authorization = new Promise<never>((_resolve, reject) => { releaseAuthorization = () => reject(new Error('stop test')); });
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, authorizeTeamLaunch: () => authorization, getTeamLaunch: async () => undefined }));
    const start = service.start('session-1', 'project-1', request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('STARTING');
    releaseAuthorization();
    await expect(start).resolves.toMatchObject({ ok: false });
  }));

  it('recovers stale startup without Team lifecycle as a blocker', async () => fixture(async (filePath) => {
    let now = 0;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => now });
    const claimed = await store.claim({
      callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Build',
      requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
    });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    now = 2 * 60_000;
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch: async () => undefined }));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('recovers a persisted startup when Team lifecycle has live workers', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim({ callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Build', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] } });
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch: async () => ({ workers: [{ projectId: 'project-1', process: 'running' }] }) }));
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
  }));

  it('fails execution when Team lifecycle records failed launch slots or all workers exit', async () => fixture(async (filePath) => {
    const lifecycle = { workers: [{ projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle }));
    await service.start('session-1', 'project-1', request);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('keeps failed partial launches stoppable while workers remain live', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const lifecycle = { workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');
    await expect(service.stop('session-1', 'project-1', 'execution-1', 5)).resolves.toMatchObject({ ok: true, value: { state: 'FAILED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
  }));

  it('cancels live Team workers before dismissing terminal execution history', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const lifecycle = { workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');

    await expect(service.dismiss('session-1', 'project-1', 'execution-1')).resolves.toEqual({ ok: true, value: { dismissedSessionIds: ['worker-1'] } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.dismissedAt).toBeDefined();
  }));

  it('keeps terminal execution history visible when Team cancellation fails', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: false, code: 'CANCEL_FAILED', message: 'worker teardown unavailable' }));
    const lifecycle = { workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }], launchResult: { failedSlots: [{ slotId: 'slot-2' }] } };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.status('session-1', 'project-1', 'execution-1');

    await expect(service.dismiss('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({
      ok: false, code: 'CANCEL_FAILED', message: 'worker teardown unavailable'
    });
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.dismissedAt).toBeUndefined();
  }));

  it('stops and dismisses blocked execution when Team cancellation returns NOT_FOUND', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: false as const, code: 'NOT_FOUND' as const, message: 'team launch request not found for caller' }));
    const preflightWorkflow = vi.fn(() => ({ ok: false as const, code: 'INVALID', message: 'workflow profile references an unknown persona' }));
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch, preflightWorkflow }));
    
    await service.start('session-1', 'project-1', { ...request, workflow: {} as any });
    
    const record = await service.status('session-1', 'project-1', 'execution-1');
    expect(record?.state).toBe('BLOCKED');
    
    // stop will gracefully ignore NOT_FOUND
    await expect(service.stop('session-1', 'project-1', 'execution-1', record!.stateVersion)).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    
    // dismiss will gracefully ignore NOT_FOUND
    await expect(service.dismiss('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: true });
  }));

  it('stops only caller-owned execution through the existing Team cancellation path', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.stop('session-1', 'project-1', 'execution-1', 4)).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    await expect(service.stop('other', 'project-1', 'execution-1', 4)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('rejects stale stop before Team cancellation', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.stop('session-1', 'project-1', 'execution-1', 0)).resolves.toMatchObject({ ok: false, code: 'CONFLICT', current: { stateVersion: 4 } });
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('responds only through an owned slot and resumes blocked work after delivery', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, replyToSession }));
    await service.start('session-1', 'project-1', request);
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    let record = await store.registerPlan(running.id, running.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Continue?' });
    await expect(service.resume('session-1', 'project-1', 'execution-1', record.stateVersion, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: true, pending: true, delivery: { blockerId: 'blocker-1', state: 'PENDING' }, value: { state: 'BLOCKED' } });
    expect(replyToSession).toHaveBeenCalledWith('worker-1', expect.stringContaining('execution.delivery.pull'));
    await expect(service.respond('session-1', 'project-1', 'execution-1', record.stateVersion + 1, 'other-slot', 'Nope')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('keeps accepted blocker delivery pending when best-effort PTY notification fails', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, replyToSession: () => { throw new Error('notify failed'); } }));
    await service.start('session-1', 'project-1', request);
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'b', question: 'Help?' });
    await expect(service.resume('session-1', 'project-1', 'execution-1', record.stateVersion, 'slot-1', 'Answer'))
      .resolves.toMatchObject({ ok: true, pending: true, notified: false, delivery: { state: 'PENDING' } });
    const after = await store.get('execution-1');
    expect(after).toMatchObject({ state: 'BLOCKED', blockers: [{ resolved: false }], workUnits: [{ state: 'BLOCKED' }], deliveries: [{ blockerId: 'b', state: 'PENDING' }] });
    expect(after?.blockers?.[0].response).toBeUndefined();
  }));

  it('targets exact blocker with caller idempotency identity', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    const accepted = await service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', 'client-1', 'Answer');
    expect(accepted).toMatchObject({ ok: true, delivery: { blockerId: 'blocker-1', clientRequestId: 'client-1' } });
    await expect(service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion + 1, 'blocker-1', 'client-1', 'Answer')).resolves.toMatchObject({ ok: true, delivery: { id: (accepted as { delivery: { id: string } }).delivery.id } });
    await expect(service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion + 1, 'missing', 'client-2', 'Answer')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('rejects blocker responses above the 16 KiB UTF-8 transport limit', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    await expect(service.resumeBlocker('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', 'client-1', '😀'.repeat(4097)))
      .resolves.toEqual({ ok: false, code: 'INVALID', message: 'invalid execution blocker delivery request' });
  }));

  it('authorizes delivery retry by owner, project, blocker, delivery, and state version', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    record = (await store.enqueueBlockerDelivery(record.id, record.stateVersion, { clientRequestId: 'client-1', blockerId: 'blocker-1', text: 'Answer' })).record;
    const state = JSON.parse(await readFile(filePath, 'utf8')) as { records: typeof record[] };
    state.records[0].deliveries![0].state = 'FAILED';
    await writeFile(filePath, JSON.stringify(state));
    record = state.records[0];
    const deliveryId = record.deliveries![0].id;
    await expect(service.retryBlockerDelivery('other', 'project-1', record.id, record.stateVersion, 'blocker-1', deliveryId)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.retryBlockerDelivery('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', 'wrong')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.retryBlockerDelivery('session-1', 'project-1', record.id, record.stateVersion, 'blocker-1', deliveryId)).resolves.toMatchObject({ ok: true, value: { deliveries: [{ id: deliveryId, clientRequestId: 'client-1', state: 'PENDING' }] } });
  }));

  it('pulls and acknowledges deliveries only through exact bound worker route', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    await service.resume('session-1', 'project-1', record.id, record.stateVersion, 'slot-1', 'Answer');
    const worker = { executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-1', authorizationId: 'auth-current' };
    await expect(service.pullDelivery({ ...worker, slotId: 'slot-2' })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    const pulled = await service.pullDelivery(worker);
    expect(pulled).toMatchObject({ ok: true, value: { id: expect.any(String), leaseId: expect.any(String), payload: { text: 'Answer' } } });
    if (!pulled.ok || !pulled.value) throw new Error('missing delivery');
    const ack = await service.ackDelivery(worker, pulled.value.id, pulled.value.leaseId!, { delivered: true });
    expect(ack).toMatchObject({ ok: true, value: { deliveryId: pulled.value.id, state: 'DELIVERED', blockerId: 'blocker-1', resolved: true } });
    expect(JSON.stringify(ack)).not.toContain('deliveries');
    expect(JSON.stringify(ack)).not.toContain('Answer');
  }));

  it('denies a stale same-slot worker and accepts the current restored worker session', async () => fixture(async (filePath) => {
    let currentSessionId = 'worker-old';
    let currentAuthorizationId = 'auth-old';
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ slotId: 'slot-1', sessionId: currentSessionId, authorizationId: currentAuthorizationId, projectId: 'project-1' }] }));
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    let record = (await store.get('execution-1'))!;
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    await service.resume('session-1', 'project-1', record.id, record.stateVersion, 'slot-1', 'Secret answer');
    currentSessionId = 'worker-restored';
    currentAuthorizationId = 'auth-restored';
    const stale = { executionId: record.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-old', authorizationId: 'auth-old' };
    const restored = { ...stale, principalId: currentSessionId, authorizationId: currentAuthorizationId };
    await expect(service.pullDelivery(stale)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.pullDelivery(restored)).resolves.toMatchObject({ ok: true, value: { recipientPrincipalId: 'worker-restored', recipientAuthorizationId: 'auth-restored' } });
  }));

  it('blocks legacy grant mint while a recovered monitor is live and converges concurrent mint calls', async () => fixture(async (filePath) => {
    let token = 0;
    let live = false;
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => `token-${++token}` });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants, hasLivePredecessor: () => live }));
    await service.start('session-1', 'project-1', request);
    live = true;
    await expect(service.mintResumeGrant('session-1', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'LIVE_PREDECESSOR' });
    live = false;
    const [left, right] = await Promise.all([
      service.mintResumeGrant('session-1', 'project-1', 'execution-1'),
      service.mintResumeGrant('session-1', 'project-1', 'execution-1')
    ]);
    expect(left).toEqual(right);
  }));

  it('denies an unauthorized caller instead of joining an authorized resume-grant mint flight', async () => fixture(async (filePath) => {
    let releaseRotate!: () => void;
    const rotateGate = new Promise<void>((resolve) => { releaseRotate = resolve; });
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'owner-token' });
    const rotate = vi.fn(async (...args: Parameters<typeof grants.rotate>) => {
      await rotateGate;
      return grants.rotate(...args);
    });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: { ...grants, rotate } }));
    await service.start('owner', 'project-1', request);

    const ownerMint = service.mintResumeGrant('owner', 'project-1', 'execution-1');
    await vi.waitFor(() => expect(rotate).toHaveBeenCalledTimes(1));
    const unauthorizedMint = service.mintResumeGrant('intruder', 'project-1', 'execution-1');
    releaseRotate();

    await expect(ownerMint).resolves.toMatchObject({ ok: true, value: { token: 'owner-token' } });
    const denied = await unauthorizedMint;
    expect(denied).toMatchObject({ ok: false, code: 'DENIED' });
    expect(JSON.stringify(denied)).not.toContain('owner-token');
    expect(rotate).toHaveBeenCalledTimes(1);
  }));

  it('rejects stale resume before reading or messaging Team workers', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }));
    const replyToSession = vi.fn(() => true);
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch, replyToSession }));
    await service.start('session-1', 'project-1', request);
    await expect(service.resume('session-1', 'project-1', 'execution-1', 0, 'slot-1', 'Continue')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(getTeamLaunch).toHaveBeenCalledTimes(0);
    expect(replyToSession).not.toHaveBeenCalled();
  }));

  it('records write-once artifacts and permits same-project replacement reads', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":true}')).resolves.toMatchObject({ ok: true, value: { contentDigest: expect.stringMatching(/^sha256:/) } });
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":false}')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await service.listArtifacts('replacement-session', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.listArtifacts('replacement-session', 'other-project', 'execution-1')).toBeUndefined();
  }));

  it('reads a bounded durable snapshot without reconciling Team lifecycle', async () => fixture(async (filePath) => {
    const getTeamLaunch = vi.fn(async () => ({ workers: [] }));
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await service.putArtifact('session-1', 'project-1', 'execution-1', 'result.json', 'application/json', '{"ok":true}');
    const snapshot = await service.snapshot('session-1', 'project-1', 'execution-1');
    expect(snapshot).toMatchObject({ execution: { id: 'execution-1', state: 'RUNNING' }, executions: [{ id: 'execution-1' }], artifacts: [{ name: 'result.json' }], truncated: false });
    expect(getTeamLaunch).not.toHaveBeenCalled();
  }));

  it('reads exact bound execution snapshot without owner execution history', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => `execution-${++n}`; })() });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('owner', 'project-1', request);
    await service.start('owner', 'project-1', { ...request, launchRequestId: 'request-2' });
    const binding = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
    const snapshot = await service.snapshotBound(binding);
    expect(snapshot).toMatchObject({ execution: { id: 'execution-1' }, executions: [{ id: 'execution-1' }] });
    expect(snapshot?.executions).toHaveLength(1);
    await expect(service.snapshotBound({ ...binding, executionId: 'execution-2' })).resolves.toMatchObject({ execution: { id: 'execution-2' } });
    await expect(service.snapshotBound({ ...binding, projectId: 'other-project' })).resolves.toBeUndefined();
  }));

  it('loads every retained bounded event page into terminal detail snapshots', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const base = deps(filePath, { store });
    await new SquadExecutionService(base).start('session-1', 'project-1', request);
    const eventsInProject = vi.fn(async (_projectId: string, _executionId: string, after: number) => {
      const start = after;
      const events = Array.from({ length: Math.min(100, 225 - start) }, (_, index) => ({ id: `event-${start + index + 1}`, sequence: start + index + 1 }));
      return { events, ...(start + events.length < 225 ? { nextSequence: start + events.length } : {}) };
    });
    const service = new SquadExecutionService({ ...base, store: { ...store, eventsInProject } as never });
    const snapshot = await service.snapshot('session-1', 'project-1', 'execution-1');
    expect(snapshot?.events).toHaveLength(225);
    expect(snapshot?.truncated).toBe(false);
    expect(eventsInProject).toHaveBeenCalledTimes(3);
  }));

  it('stops durable snapshot before later reads when total deadline expires', async () => fixture(async (filePath) => {
    let clock = 0;
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, monotonicNow: () => clock }));
    await service.start('session-1', 'project-1', request);
    const originalList = store.list;
    store.list = async (...args) => {
      clock = 15_000;
      return originalList(...args);
    };
    await expect(service.snapshot('session-1', 'project-1', 'execution-1')).rejects.toThrow('Snapshot exceeded 15-second budget');
  }));

  it('does not accept artifacts after execution reaches a terminal state', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store }));
    await service.start('session-1', 'project-1', request);
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    await store.transition(running.id, running.stateVersion, 'COMPLETED', 'info', 'Done');
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', 'late.json', 'application/json', '{}')).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));

  it('persists workflow preflight failure before blocking launch', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const service = new SquadExecutionService(deps(filePath, {
      launchTeam,
      preflightWorkflow: () => ({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'missing controller slot' })
    }));
    await expect(service.start('session-1', 'project-1', {
      ...request,
      workflow: { schemaVersion: 1, profileId: 'profile', profileVersion: '1', controller: { personaId: 'controller', slotId: 'orchestrator:controller' }, workers: [], supportedRequestVersions: [1] }
    })).resolves.toEqual({ ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'missing controller slot' });
    expect(launchTeam).not.toHaveBeenCalled();
    expect(await service.status('session-1', 'project-1', 'execution-1')).toMatchObject({ state: 'BLOCKED', jobTitle: 'Build release' });
  }));

  it('lists executions for an effective owner after a successful resume binding', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    const started = await service.start('session-1', 'project-1', request);
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await expect(service.resumeBinding('session-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await expect(service.list('session-2', 'project-1')).resolves.toMatchObject([{ id: 'execution-1' }]);
  }));

  it('persists explicit resolved models and rejects duplicate slot snapshots', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    const started = await service.start('session-1', 'project-1', { ...request, resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model' }] });
    expect(started).toMatchObject({ ok: true, value: { resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model' }] } });
    const duplicate = await service.start('session-1', 'project-1', { ...request, launchRequestId: 'request-2', resolvedModels: [{ slotId: 'slot-1', provider: 'a', model: 'a' }, { slotId: 'slot-1', provider: 'b', model: 'b' }] });
    expect(duplicate).toEqual({ ok: false, code: 'INVALID', message: 'duplicate resolved model slot' });
  }));

  it('records optional policy result without rewriting generic execution completion', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('session-1', 'project-1', request);
    const result = await service.recordPolicyResult('project-1', 'execution-1', {
      version: 1, executionId: 'execution-1', attempt: 1, outputDigest: 'sha256:output', extensionDigest: 'sha256:extension', status: 'ELIGIBLE_FOR_DELIVERY', summary: 'Policy approved'
    });
    expect(result).toMatchObject({ ok: true, value: { state: 'RUNNING', policyResult: { status: 'ELIGIBLE_FOR_DELIVERY' } } });
    expect(await service.recordPolicyResult('other-project', 'execution-1', {})).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it.each([
    [{ ...request, version: 2 }, 'invalid version'],
    [{ ...request, teamId: ' ' }, 'blank team'],
    [{ ...request, launchRequestId: '' }, 'blank request id'],
    [{ ...request, slots: [] }, 'empty slots'],
    [{ ...request, launchKind: 'unknown' }, 'unknown launch kind']
  ])('rejects malformed start input before durable reservation: %s', async (invalid, _label) => fixture(async (filePath) => {
    const input = deps(filePath);
    const service = new SquadExecutionService(input);
    await expect(service.start('session-1', 'project-1', invalid as never)).resolves.toEqual({ ok: false, code: 'INVALID', message: 'invalid execution request' });
    expect(await input.store.list('session-1', 'project-1')).toEqual([]);
  }));

  it('maps durable reservation and resume-grant failures without launching workers', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: true }));
    const storeFailure = new SquadExecutionService(deps(filePath, {
      store: { ...createExecutionStore({ filePath }), claim: async () => { throw 'store offline'; } }, launchTeam
    }));
    await expect(storeFailure.start('session-1', 'project-1', request)).resolves.toEqual({ ok: false, code: 'EXECUTION_STORE_ERROR', message: 'store offline' });
    const grants = { mint: vi.fn(async () => { throw 'grant offline'; }), consume: vi.fn(), revoke: vi.fn() };
    const grantFailure = new SquadExecutionService(deps(`${filePath}.grant`, { resumeGrants: grants as never, launchTeam }));
    await expect(grantFailure.start('session-1', 'project-1', request)).resolves.toEqual({ ok: false, code: 'EXECUTION_STORE_ERROR', message: 'grant offline' });
    expect(launchTeam).not.toHaveBeenCalled();
  }));

  it('enforces bound roles, missing executions, source membership, and dependency failures', async () => fixture(async (filePath) => {
    const sources = { list: vi.fn(async () => { throw 'list offline'; }), read: vi.fn(async () => { throw new Error('read offline'); }) };
    const artifacts = createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' });
    const put = artifacts.put;
    const service = new SquadExecutionService(deps(filePath, {
      sources: sources as never,
      artifacts: { ...artifacts, put: async (input) => input.name === 'throw.md' ? Promise.reject('artifact offline') : put(input) }
    }));
    await service.start('owner', 'project-1', { ...request, sourceBundle: { contentRef: 'sources.json', sources: [{ id: 'source-1', name: 'one.txt', mediaType: 'text/plain', byteSize: 3, contentDigest: `sha256:${'1'.repeat(64)}`, extractionStatus: 'READY', extractionWarnings: [] }] } });
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead', role: 'orchestrator' as const };
    const worker = { ...coordinator, role: 'worker' as const, slotId: 'slot-1' };
    const missing = { ...coordinator, executionId: 'missing' };
    await expect(service.registerPlan(worker, [])).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.registerPlan(missing, [])).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.reportBoundEvent(missing, { id: 'e', type: 'progress', severity: 'info', summary: 'x' })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.putBoundArtifact(missing, 'x', 'text/plain', 'x')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.listBoundArtifacts(missing)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.listSources(worker, {})).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.readSource(coordinator, 'foreign', {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.listSources(coordinator, {})).resolves.toMatchObject({ ok: false, code: 'INVALID', message: 'list offline' });
    await expect(service.readSource(coordinator, 'source-1', {})).resolves.toMatchObject({ ok: false, code: 'INVALID', message: 'read offline' });
    await expect(service.putBoundArtifact(coordinator, 'throw.md', 'text/plain', 'x')).resolves.toMatchObject({ ok: false, code: 'INVALID', message: 'artifact offline' });
    await expect(service.completeByCoordinatorBinding(worker, 'execution-1', 'done')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.completeByCoordinatorBinding(coordinator, 'other', 'done')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
  }));

  it('validates completion, delivery, handoff, and cancellation boundaries', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => false);
    const cancelTeamLaunch = vi.fn(async () => ({ ok: false as const, code: 'TRANSPORT', message: 'cancel unavailable' }));
    const service = new SquadExecutionService(deps(filePath, { replyToSession, cancelTeamLaunch }));
    await service.start('session-1', 'project-1', request);
    await expect(service.completeByCoordinator('session-1', 'project-1', 'execution-1', ' ')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.completeByCoordinator('session-1', 'project-1', 'missing', 'done')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.respond('session-1', 'project-1', 'execution-1', 4, '', 'answer')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.respond('session-1', 'project-1', 'execution-1', 4, 'slot-1', ' ')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.respond('other', 'project-1', 'execution-1', 4, 'slot-1', 'answer')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.respond('session-1', 'project-1', 'execution-1', 4, 'slot-1', 'answer')).resolves.toMatchObject({ ok: false, code: 'SESSION_GONE' });
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'other', projectId: 'project-1', executionId: 'execution-1' }, 'stop', 4)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'session-1', projectId: 'project-1', executionId: 'execution-1' }, 'respond', 5)).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.stop('session-1', 'project-1', 'execution-1', 4)).resolves.toEqual({ ok: false, code: 'TRANSPORT', message: 'cancel unavailable' });
  }));

  it('maps artifact, policy, retry, and resume-grant error paths', async () => fixture(async (filePath) => {
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'token' });
    const service = new SquadExecutionService(deps(filePath, { resumeGrants: grants }));
    await service.start('session-1', 'project-1', request);
    await expect(service.putArtifact('other', 'project-1', 'execution-1', 'x', 'text/plain', 'x')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.putArtifact('session-1', 'project-1', 'execution-1', '', 'text/plain', 'x')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.recordPolicyResult('project-1', 'missing', {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.recordPolicyResult('project-1', 'execution-1', { version: 1, executionId: 'other', attempt: 1 })).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.retry('other', 'project-1', 'execution-1', 0)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.retry('session-1', 'project-1', 'execution-1', 4)).resolves.toMatchObject({ ok: false, code: 'RETRY_NOT_ALLOWED' });
    await expect(service.mintResumeGrant('other', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.revokeResumeGrant('other', 'project-1', 'execution-1')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.revokeResumeGrant('session-1', 'project-1', 'execution-1', 'monitor')).resolves.toMatchObject({ ok: true });
  }));

  it('keeps active state when lifecycle lookup fails and handles worker failure terminal signals', async () => fixture(async (filePath) => {
    let lifecycle: unknown = undefined;
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => {
      if (lifecycle === 'throw') throw new Error('lifecycle offline');
      return lifecycle as never;
    } }));
    await service.start('session-1', 'project-1', request);
    lifecycle = 'throw';
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    lifecycle = { workers: [{ projectId: 'project-1', task: 'caller-reported-failed', process: 'running' }] };
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('covers delivery route denial, invalid input, and transient store branches', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let n = 0; return () => n++ === 0 ? 'execution-1' : `id-${n}`; })() });
    const base = deps(filePath, { store });
    const service = new SquadExecutionService(base);
    await service.start('owner', 'project-1', request);
    const missing = { executionId: 'missing', projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-1' };
    const coordinator = { ...missing, executionId: 'execution-1', role: 'orchestrator' as const };
    const worker = { ...missing, executionId: 'execution-1' };
    await expect(service.pullDelivery(missing)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.pullDelivery(coordinator)).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.ackDelivery(missing, 'delivery', 'lease', { delivered: true })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.ackDelivery(coordinator, 'delivery', 'lease', { delivered: true })).resolves.toMatchObject({ ok: false, code: 'DENIED' });
    await expect(service.ackDelivery(worker, 'delivery', 'lease', { delivered: true })).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.retryBlockerDelivery('owner', 'project-1', 'execution-1', 0, '', '')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.resumeBlocker('owner', 'project-1', 'execution-1', 0, '', '', '')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.resumeBlocker('other', 'project-1', 'execution-1', 0, 'b', 'c', 'text')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.listSources(coordinator, {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.readSource(coordinator, 'source', {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }));

  it('maps launch failure with default transport message', async () => fixture(async (filePath) => {
    const launchTeam = vi.fn(async () => ({ ok: false }));
    const service = new SquadExecutionService(deps(filePath, { launchTeam }));
    await expect(service.start('owner', 'project-1', request)).resolves.toEqual({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'Team launch failed' });
  }));

  it('covers lifecycle mismatch after startup completes', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let lifecycle: any = { workers: [{ projectId: 'project-1', process: 'running' }] };
    const service = new SquadExecutionService(deps(filePath, { store, getTeamLaunch: async () => lifecycle }));
    await service.start('owner', 'project-1', request);
    lifecycle = { workers: [{ projectId: 'wrong' }] };
    expect((await service.status('owner', 'project-1', 'execution-1'))?.state).toBe('BLOCKED');
  }));

  it('covers owner read and control boundary variants', async () => fixture(async (filePath) => {
    const input = deps(filePath);
    const service = new SquadExecutionService(input);
    await service.start('owner', 'project-1', request);
    expect(await service.snapshot('other', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.listArtifacts('other', 'project-1', 'execution-1')).toBeUndefined();
    expect(await service.readArtifact('other', 'project-1', 'execution-1', 'missing')).toBeUndefined();
    expect(await service.readArtifact('owner', 'project-1', 'execution-1', 'missing')).toBeUndefined();
    await expect(service.reportEvent('other', 'project-1', 'execution-1', { id: 'e', type: 'progress', severity: 'info', summary: 'x' })).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.completeByCoordinator('owner', 'project-1', 'execution-1', 'x'.repeat(64 * 1024 + 1))).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await expect(service.controlWithHandoff({ sourceOwnerSessionId: 'owner', projectId: 'project-1', executionId: 'execution-1' }, 'respond', 4, 'slot-1')).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    await service.handleCoordinatorExit('wrong', 'execution-1', 'coordinator');
    await service.handleCoordinatorExit('project-1', 'execution-1', 'other');
  }));

  it('covers recovery unavailable, malformed generation, and transient rotation branches', async () => fixture(async (filePath) => {
    const input = deps(filePath);
    const service = new SquadExecutionService(input);
    await service.start('owner', 'project-1', request);
    const record = await input.store.get('execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.resumeBinding('replacement', 'project-1', record.id, 'token')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });

    const grants = { mint: vi.fn(), consume: vi.fn(), revoke: vi.fn(), rotate: vi.fn(async () => { throw new Error('storage offline'); }) };
    const rotating = new SquadExecutionService(deps(filePath, { resumeGrants: grants as never }));
    await expect(rotating.rotateRecoveryGrant('project-1', record.id, record.stateVersion, record.recoveryGeneration ?? 0)).resolves.toMatchObject({ ok: false, code: 'ROTATE_TRANSIENT' });
  }));

  it('covers project listing and title fallback variants', async () => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await service.start('owner', 'project-1', request);
    await expect(service.listProject('project-1', undefined, 1)).resolves.toMatchObject({ records: [{ id: 'execution-1' }], hasMore: false });
    expect(deriveJobTitle({ teamId: 'team', summary: '  ' })).toBe('team');
    expect(deriveJobTitle({ teamId: 'team', jobTitle: ` ${'x'.repeat(300)} ` })).toHaveLength(240);
  }));

  it.each([
    [{ slotId: '', provider: 'p', model: 'm' }, 'blank slot'],
    [{ slotId: 's', provider: '', model: 'm' }, 'blank provider'],
    [{ slotId: 's', provider: 'p', model: '' }, 'blank model']
  ])('rejects malformed resolved-model snapshot: %s', async (model) => fixture(async (filePath) => {
    const service = new SquadExecutionService(deps(filePath));
    await expect(service.start('owner', 'project-1', { ...request, resolvedModels: [model] })).resolves.toMatchObject({ ok: false, code: 'INVALID' });
  }));

  it('covers completed, failed, and stale failed stop variants', async () => fixture(async (filePath) => {
    const completedStore = createExecutionStore({ filePath, id: () => 'execution-1' });
    const completedService = new SquadExecutionService(deps(filePath, { store: completedStore }));
    await completedService.start('owner', 'project-1', request);
    let record = await completedStore.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await completedStore.transition(record.id, record.stateVersion, 'COMPLETED', 'info', 'done');
    await expect(completedService.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });

    const failedPath = `${filePath}.failed`;
    const failedStore = createExecutionStore({ filePath: failedPath, id: () => 'execution-2' });
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }));
    const failedService = new SquadExecutionService(deps(failedPath, { store: failedStore, launchTeam: async () => ({ ok: false }), cancelTeamLaunch }));
    await failedService.start('owner', 'project-1', { ...request, launchRequestId: 'request-2' });
    record = await failedStore.get('execution-2');
    if (!record) throw new Error('missing failed execution');
    await expect(failedService.stop('owner', 'project-1', record.id, record.stateVersion - 1)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    await expect(failedService.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: true, value: { state: 'FAILED' } });
  }));

  it('covers worker-only lifecycle states that remain running or fail after every exit', async () => fixture(async (filePath) => {
    let lifecycle: any = { workers: [{ projectId: 'project-1', task: 'working', process: 'running' }] };
    const service = new SquadExecutionService(deps(filePath, { getTeamLaunch: async () => lifecycle }));
    await service.start('owner', 'project-1', request);
    expect((await service.status('owner', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    lifecycle = { workers: [{ projectId: 'project-1', task: 'working', process: 'exited' }] };
    expect((await service.status('owner', 'project-1', 'execution-1'))?.state).toBe('FAILED');
  }));

  it('covers retry authorization-context, launch, and thrown transport failures', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    let authorizationMode: 'deny' | 'missing' | 'ok' = 'deny';
    let launchMode: 'ok' | 'fail' | 'throw' = 'ok';
    const service = new SquadExecutionService(deps(filePath, {
      store,
      authorizeTeamLaunch: () => authorizationMode === 'deny'
        ? { ok: false as const, code: 'DENIED', message: 'blocked' }
        : authorizationMode === 'missing'
          ? { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [] } }
          : { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [] } } },
      launchTeam: async () => {
        if (launchMode === 'throw') throw 'transport offline';
        return launchMode === 'fail' ? { ok: false as const } : { ok: true as const };
      }
    }));
    await service.start('owner', 'project-1', request);
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    authorizationMode = 'missing';
    await expect(service.retry('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'AUTHORIZATION_CONTEXT_UNAVAILABLE' });
    record = await store.get(record.id);
    if (!record) throw new Error('missing execution');
    authorizationMode = 'ok';
    launchMode = 'fail';
    await expect(service.retry('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'Team launch failed' });

    const throwPath = `${filePath}.throw`;
    const throwStore = createExecutionStore({ filePath: throwPath, id: () => 'execution-2' });
    let denyThrowRetry = true;
    const throwing = new SquadExecutionService(deps(throwPath, {
      store: throwStore,
      authorizeTeamLaunch: () => denyThrowRetry
        ? { ok: false as const, code: 'DENIED', message: 'blocked' }
        : { ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [] } } },
      launchTeam: async () => { throw 'transport offline'; }
    }));
    await throwing.start('owner', 'project-1', { ...request, launchRequestId: 'request-2' });
    record = await throwStore.get('execution-2');
    if (!record) throw new Error('missing execution');
    denyThrowRetry = false;
    await expect(throwing.retry('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'transport offline' });
  }));

  it('covers source success without bundle, artifact replay, and delivery retry conflicts', async () => fixture(async (filePath) => {
    const sources = { list: vi.fn(), read: vi.fn() };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, sources: sources as never }));
    await service.start('owner', 'project-1', request);
    const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'lead', role: 'orchestrator' as const };
    await expect(service.listSources(coordinator, {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.readSource(coordinator, 'missing', {})).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await expect(service.putArtifact('owner', 'project-1', 'execution-1', 'same.txt', 'text/plain', 'same')).resolves.toMatchObject({ ok: true });
    await expect(service.putArtifact('owner', 'project-1', 'execution-1', 'same.txt', 'text/plain', 'same')).resolves.toMatchObject({ ok: true });
    await expect(service.retryBlockerDelivery('owner', 'project-1', 'execution-1', 0, 'blocker', 'delivery')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
  }));

  it('covers failed cancellation defaults and stopped terminal control', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, cancelTeamLaunch: async () => ({ ok: false }) }));
    await service.start('owner', 'project-1', request);
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toEqual({ ok: false, code: 'CANCEL_FAILED', message: 'Team cancellation failed' });
    record = await store.get(record.id);
    if (!record) throw new Error('missing execution');
    record = await store.transition(record.id, record.stateVersion, 'STOPPED', 'info', 'stopped');
    await expect(service.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toMatchObject({ ok: false, code: 'TERMINAL' });
  }));

  it('covers failed-state cancellation defaults', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, launchTeam: async () => ({ ok: false }), cancelTeamLaunch: async () => ({ ok: false }) }));
    await service.start('owner', 'project-1', request);
    const record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    await expect(service.stop('owner', 'project-1', record.id, record.stateVersion)).resolves.toEqual({ ok: false, code: 'CANCEL_FAILED', message: 'Team cancellation failed' });
  }));

  it('automatically appends linked Inbox entry on blockWork', async () => fixture(async (filePath) => {
    const append = vi.fn(async (input) => ({ id: 'entry-1', ...input }));
    const inbox = { append };
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, inbox }));
    
    await service.start('session-1', 'project-1', request);
    const running = await store.get('execution-1');
    if (!running) throw new Error('missing execution');
    
    let record = await store.registerPlan(running.id, running.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    
    await service.blockWork({ role: 'worker', slotId: 'slot-1', projectId: 'project-1', executionId: 'execution-1' }, 'a', { id: 'blocker-1', question: 'Help?', options: ['Yes', 'No'] });
    
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      subject: 'Build release',
      comments: 'Help?',
      executionId: 'execution-1',
      blockerId: 'blocker-1',
      question: expect.objectContaining({
        options: [
          { id: 'A', label: 'Yes' },
          { id: 'B', label: 'No' }
        ]
      })
    }));
  }));

  it('triggers immediate delivery drain check on blocker enqueue', async () => fixture(async (filePath) => {
    const triggerDeliveryDrain = vi.fn();
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const service = new SquadExecutionService(deps(filePath, { store, triggerDeliveryDrain }));
    await service.start('owner', 'project-1', request);
    let record = await store.get('execution-1');
    if (!record) throw new Error('missing execution');
    record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'a', title: 'A', task: 'A', dependencies: [] }]);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'orchestrator', slotId: 'lead' }, 'a', 'slot-1');
    record = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a', { id: 'blocker-1', question: 'Q?' });
    
    await service.respond('owner', 'project-1', 'execution-1', record.stateVersion, 'slot-1', 'Done');
    expect(triggerDeliveryDrain).toHaveBeenCalledTimes(1);
    expect(triggerDeliveryDrain).toHaveBeenCalledWith('worker-1');
  }));

});
