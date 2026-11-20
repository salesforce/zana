import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService, type ExecutionServiceDeps } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-worker-exit-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

type Worker = Record<string, unknown>;

async function runningWithClaim(filePath: string, now: () => number, slotId = 'slot-1') {
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Work', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] } })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
  record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId }, 'unit');
  return { store, record };
}

function service(filePath: string, store: ReturnType<typeof createExecutionStore>, workers: Worker[], over: Partial<ExecutionServiceDeps> = {}) {
  return new ExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: false as const, code: 'x', message: 'x' }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: () => [],
    claimRecoveryObserveEnabled: () => true,
    claimRecoveryEnforceEnabled: () => true,
    ...over
  } as unknown as ExecutionServiceDeps);
}

const exited = (extra: Worker = {}): Worker => ({ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'exited', ...extra });

describe('worker exit warnings', () => {
  it('records a run warning and notifies the host on a non-zero exit', async () => fixture(async (filePath) => {
    const { store, record } = await runningWithClaim(filePath, () => 1_000);
    const onRunWarning = vi.fn();
    await service(filePath, store, [exited({ exitCode: 1, exitReason: 'bad model /Users/me/x/claude' })], { onRunWarning }).recoverExitedWorker(record.id, 'slot-1');
    const events = (await store.eventsInProject('project-1', record.id)).events;
    const warn = events.find((e) => e.severity === 'warning' && e.slotId === 'slot-1');
    expect(warn?.summary).toBe('Worker slot-1 exited with code 1: bad model claude');
    expect(onRunWarning).toHaveBeenCalledWith(expect.objectContaining({ id: record.id }), { slotId: 'slot-1', summary: warn?.summary, kind: 'worker-exit' });
  }));

  it('reports a signal-only exit', async () => fixture(async (filePath) => {
    const { store, record } = await runningWithClaim(filePath, () => 1_000);
    const onRunWarning = vi.fn();
    await service(filePath, store, [exited({ exitSignal: 9 })], { onRunWarning }).recoverExitedWorker(record.id, 'slot-1');
    expect(onRunWarning.mock.calls[0][1].summary).toBe('Worker slot-1 was stopped by signal 9');
  }));

  it.each([
    ['clean exit', exited({ exitCode: 0 })],
    ['unknown exit detail', exited()],
    ['user cancel', exited({ process: 'canceled', exitCode: 1 })],
    ['idle on-demand seat', { ...exited({ exitCode: 1 }), slotId: 'slot-idle', onDemand: true }]
  ])('does not warn on %s', async (_name, worker) => fixture(async (filePath) => {
    const { store, record } = await runningWithClaim(filePath, () => 1_000);
    const onRunWarning = vi.fn();
    await service(filePath, store, [worker as Worker], { onRunWarning }).recoverExitedWorker(record.id, (worker as Worker).slotId as string);
    expect(onRunWarning).not.toHaveBeenCalled();
    expect((await store.eventsInProject('project-1', record.id)).events.some((e) => e.slotId === (worker as Worker).slotId && e.severity === 'warning')).toBe(false);
  }));

  it('warns for an on-demand seat that was given work', async () => fixture(async (filePath) => {
    const { store, record } = await runningWithClaim(filePath, () => 1_000);
    const onRunWarning = vi.fn();
    await service(filePath, store, [exited({ exitCode: 2, onDemand: true })], { onRunWarning }).recoverExitedWorker(record.id, 'slot-1');
    expect(onRunWarning).toHaveBeenCalledTimes(1);
  }));

  it('survives a failing host notification and a failing store write', async () => fixture(async (filePath) => {
    const { store, record } = await runningWithClaim(filePath, () => 1_000);
    const logError = vi.fn();
    await service(filePath, store, [exited({ exitCode: 1 })], { onRunWarning: () => { throw new Error('inbox down'); }, logError }).recoverExitedWorker(record.id, 'slot-1');
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('delivery failed'), expect.any(Error));
    // The claim is still reclaimed even though the notification failed.
    expect((await store.get(record.id))?.workUnits?.[0].state).toBe('READY');

    const failingStore = Object.assign(Object.create(store), { warning: async () => { throw new Error('disk'); } });
    const onRunWarning = vi.fn();
    await service(filePath, failingStore, [exited({ exitCode: 1 })], { onRunWarning, logError }).recoverExitedWorker(record.id, 'slot-1');
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Worker warning failed'), expect.any(Error));
    expect(onRunWarning).not.toHaveBeenCalled();
  }));
});

describe('no-turn warnings', () => {
  const live = (): Worker => ({ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' });

  it('warns once when a claimed worker takes no turn within the injected window', async () => fixture(async (filePath) => {
    let now = 1_000;
    const { store } = await runningWithClaim(filePath, () => now);
    const onRunWarning = vi.fn();
    const svc = service(filePath, store, [live()], { now: () => now, onRunWarning, noTurnWarnWindowMs: () => 5_000 });
    now = 5_999;
    await svc.reconcileActive();
    expect(onRunWarning).not.toHaveBeenCalled();
    now = 6_000;
    await svc.reconcileActive();
    await svc.reconcileActive();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
    expect(onRunWarning.mock.calls[0][1]).toMatchObject({ slotId: 'slot-1', kind: 'worker-no-turn' });
    expect(onRunWarning.mock.calls[0][1].summary).toContain('no turn for 5 seconds');
  }));

  it('defaults the window to the run stall limit', async () => fixture(async (filePath) => {
    let now = 1_000;
    const { store } = await runningWithClaim(filePath, () => now);
    const onRunWarning = vi.fn();
    const svc = service(filePath, store, [live()], { now: () => now, onRunWarning });
    now = 1_000 + 9 * 60_000;
    await svc.reconcileActive();
    expect(onRunWarning).not.toHaveBeenCalled();
    now = 1_000 + 10 * 60_000;
    await svc.reconcileActive();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
  }));

  it('does not warn for a worker that is dead (its exit warns instead)', async () => fixture(async (filePath) => {
    const { store } = await runningWithClaim(filePath, () => 1_000);
    const onRunWarning = vi.fn();
    // Observe-only recovery leaves the claim in place, so only the dead-worker skip is under test.
    await service(filePath, store, [exited({ exitCode: 1 })], { now: () => 100_000, onRunWarning, noTurnWarnWindowMs: () => 1, claimRecoveryEnforceEnabled: () => false }).reconcileActive();
    expect(onRunWarning).not.toHaveBeenCalled();
  }));

  it('does not warn for a worker that reported a turn', async () => fixture(async (filePath) => {
    const { store, record } = await runningWithClaim(filePath, () => 1_000);
    const unit = record.workUnits![0];
    const claimed = (await store.get(record.id))!.workUnits![0];
    await store.heartbeatWork(record.id, (await store.get(record.id))!.stateVersion, { role: 'worker', slotId: 'slot-1' }, unit.id, { claimId: claimed.claimId!, claimGeneration: claimed.claimGeneration!, turnCount: 1 });
    const onRunWarning = vi.fn();
    await service(filePath, store, [live()], { now: () => 100_000, onRunWarning, noTurnWarnWindowMs: () => 1 }).reconcileActive();
    expect(onRunWarning).not.toHaveBeenCalled();
  }));

  it('still warns when the lifecycle read fails (slot liveness unknown)', async () => fixture(async (filePath) => {
    let now = 1_000;
    const { store } = await runningWithClaim(filePath, () => now);
    const onRunWarning = vi.fn();
    now = 100_000;
    await service(filePath, store, [], { now: () => now, onRunWarning, noTurnWarnWindowMs: () => 1, getTeamLaunch: async () => { throw new Error('nope'); }, logError: vi.fn() }).reconcileActive();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
  }));
});

describe('store.warning worker variant', () => {
  it('rejects an unknown execution and bounds the stored summary and slot id', async () => fixture(async (filePath) => {
    const { store, record } = await runningWithClaim(filePath, () => 1_000);
    await expect(store.warning('missing', { slotId: 's', summary: 'x' })).rejects.toThrow('execution not found');
    await store.warning(record.id, { slotId: 's'.repeat(300), summary: `bad\u0000${'y'.repeat(5000)}` });
    const event = (await store.eventsInProject('project-1', record.id)).events.at(-1)!;
    expect(event.slotId!.length).toBeLessThanOrEqual(120);
    expect(event.summary.length).toBeLessThan(2100);
    expect(event.summary).not.toContain('\u0000');
  }));
});
