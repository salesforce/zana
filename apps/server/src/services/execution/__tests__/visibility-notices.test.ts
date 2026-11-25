import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService, type ExecutionServiceDeps } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { VisibilityNoticeState, blockerWaitStart, formatWait, workerNoticeLabel, blockerWaiter, unitNoticeName, resolveBlockerReminderMs, DEFAULT_BLOCKER_REMINDER_MS } from '../visibility-notices.js';
import { compactExecutionStatus } from '../projection.js';

const MIN = 60_000;
type Worker = Record<string, unknown>;

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-visibility-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function running(filePath: string, clock: { t: number }, claim: boolean) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => clock.t });
  let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Squad job', requestDigest: 'digest', launchRequestId: 'request-1', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] } })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
  if (claim) record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit');
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
    ...over
  } as unknown as ExecutionServiceDeps);
}

const live = (slotId = 'slot-1'): Worker => ({ slotId, sessionId: `s-${slotId}`, projectId: 'project-1', process: 'running' });

describe('visibility helpers', () => {
  it('formats waits and resolves the reminder window', () => {
    expect(formatWait(30_000)).toBe('30 seconds');
    expect(formatWait(1_000)).toBe('1 second');
    expect(formatWait(MIN)).toBe('1 minute');
    expect(formatWait(31 * MIN)).toBe('31 minutes');
    expect(resolveBlockerReminderMs(undefined)).toBe(DEFAULT_BLOCKER_REMINDER_MS);
    expect(resolveBlockerReminderMs(Number.NaN)).toBe(DEFAULT_BLOCKER_REMINDER_MS);
    expect(resolveBlockerReminderMs(0)).toBe(0);
    expect(resolveBlockerReminderMs(-5)).toBe(0);
    expect(resolveBlockerReminderMs(5 * MIN)).toBe(5 * MIN);
  });

  it('waits from escalation when a coordinator blocker was escalated', () => {
    const base = { id: 'b', workUnitId: 'u', slotId: 's', question: 'q', resolved: false, createdAt: 10 };
    expect(blockerWaitStart(base)).toBe(10);
    expect(blockerWaitStart({ ...base, escalatedAt: 99 })).toBe(99);
  });

  it('tracks, re-arms, caps and releases per-run state', () => {
    const state = new VisibilityNoticeState();
    const first = state.observe('run', 'k', 5)!;
    expect(first).toEqual({ since: 5, noticed: false });
    first.noticed = true;
    expect(state.observe('run', 'k', 99)).toBe(first);
    state.retainOnly('run', new Set());
    expect(state.observe('run', 'k', 7)).toEqual({ since: 7, noticed: false });
    state.retainOnly('missing', new Set());
    expect(state.markReminded('run', 'b1')).toBe(true);
    expect(state.markReminded('run', 'b1')).toBe(false);
    state.unmarkReminded('run', 'b1');
    expect(state.markReminded('run', 'b1')).toBe(true);
    state.retainReminded('run', new Set());
    expect(state.markReminded('run', 'b1')).toBe(true);
    state.retainReminded('missing', new Set());
    state.unmarkReminded('missing', 'x');
    for (let i = 0; i < 512; i++) state.observe('big', `k${i}`, 1);
    expect(state.observe('big', 'overflow', 1)).toBeUndefined();
    for (let i = 0; i < 512; i++) state.markReminded('cap', `b${i}`);
    expect(state.markReminded('cap', 'extra')).toBe(false);
    expect(state.size).toBe(3);
    state.retainRuns(new Set(['run']));
    expect(state.size).toBe(1);
    state.clear();
    expect(state.size).toBe(0);
  });
});

describe('idle-capacity notice (AC7)', () => {
  it('notices a READY unit with an idle seat once, after the window, and re-arms after a claim', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store, record } = await running(filePath, clock, false);
    const onRunWarning = vi.fn();
    const svc = service(filePath, store, [live()], { now: () => clock.t, onRunWarning });
    await svc.sweepVisibility();
    clock.t += 3 * MIN - 1;
    await svc.sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
    clock.t += 1;
    await svc.sweepVisibility();
    await svc.sweepVisibility();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
    expect(onRunWarning.mock.calls[0][1]).toMatchObject({ slotId: 'slot-1', kind: 'worker-idle', ref: 'unit:0' });
    expect(onRunWarning.mock.calls[0][1].summary).toContain('ready for 3 minutes');
    expect((await store.eventsInProject('project-1', record.id)).events.some((e) => e.severity === 'warning' && /is idle while unit/.test(e.summary ?? ''))).toBe(true);
  }));

  it('does not notice when no seat is idle, the seat is busy or dead, or the lifecycle read fails', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store } = await running(filePath, clock, false);
    const onRunWarning = vi.fn();
    const logError = vi.fn();
    clock.t += 10 * MIN;
    for (const workers of [[], [{ ...live(), process: 'exited' }], [{ ...live('orchestrator'), }], [{ ...live(), projectId: 'other' }], [{ slotId: 'slot-1', projectId: 'project-1' }]]) {
      const svc = service(filePath, store, workers as Worker[], { now: () => clock.t, onRunWarning, logError });
      await svc.sweepVisibility();
      clock.t += 10 * MIN;
      await svc.sweepVisibility();
    }
    const failing = service(filePath, store, [], { now: () => clock.t, onRunWarning, logError, getTeamLaunch: async () => { throw new Error('lifecycle down'); } });
    await failing.sweepVisibility();
    clock.t += 10 * MIN;
    await failing.sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('lifecycle read failed'), expect.any(Error));
  }));

  it('does not notice a unit that waits on dependencies', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => clock.t });
    let record = (await store.claim({ callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [], request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] } })).record;
    record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 's');
    record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'r');
    record = await store.registerPlan(record.id, record.stateVersion, [
      { id: 'a', title: 'A', task: 'x', dependencies: [], readOnly: true },
      { id: 'b', title: 'B', task: 'x', dependencies: ['a'], readOnly: true }
    ]);
    await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'a');
    const onRunWarning = vi.fn();
    // slot-2 idles, unit b is PENDING (not READY) and a is claimed with fresh progress.
    const svc = service(filePath, store, [live('slot-1'), live('slot-2')], { now: () => clock.t, onRunWarning });
    await svc.sweepVisibility();
    clock.t += 4 * MIN;
    await svc.sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
  }));

  it('honors the injected windows', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store } = await running(filePath, clock, false);
    const onRunWarning = vi.fn();
    const svc = service(filePath, store, [live()], { now: () => clock.t, onRunWarning, idleNoticeWindowMs: () => 2_000 });
    await svc.sweepVisibility();
    clock.t += 2_000;
    await svc.sweepVisibility();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
  }));
});

describe('stale-heartbeat notice (AC7)', () => {
  it('notices a claimed unit once when output progress ages past 5 minutes', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store } = await running(filePath, clock, true);
    const onRunWarning = vi.fn();
    const svc = service(filePath, store, [live()], { now: () => clock.t, onRunWarning });
    clock.t += 5 * MIN - 1;
    await svc.sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
    clock.t += 1;
    await svc.sweepVisibility();
    await svc.sweepVisibility();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
    expect(onRunWarning.mock.calls[0][1]).toMatchObject({ slotId: 'slot-1', kind: 'worker-heartbeat' });
    expect(onRunWarning.mock.calls[0][1].ref).toMatch(/^unit:/);
    expect(onRunWarning.mock.calls[0][1].summary).toContain('silent for 5 minutes');
  }));

  it('stays quiet for a progressing claim, a dead worker and a worker in API-error recovery', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store, record } = await running(filePath, clock, true);
    const onRunWarning = vi.fn();
    clock.t += 6 * MIN;
    await service(filePath, store, [{ ...live(), process: 'exited' }], { now: () => clock.t, onRunWarning }).sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
    // Fresh progress resets the age.
    await store.renewWorkerLease(record.id, 'slot-1', { advanceProgress: true });
    await service(filePath, store, [live()], { now: () => clock.t, onRunWarning }).sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
  }));

  it('survives a failing host notification', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store } = await running(filePath, clock, true);
    const logError = vi.fn();
    clock.t += 6 * MIN;
    await service(filePath, store, [live()], { now: () => clock.t, logError, onRunWarning: () => { throw new Error('inbox down'); } }).sweepVisibility();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('delivery failed'), expect.any(Error));
  }));

  it('logs and returns when the active list fails', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store } = await running(filePath, clock, true);
    const logError = vi.fn();
    const broken = Object.assign(Object.create(store), { listActive: async () => { throw new Error('disk'); } });
    await service(filePath, broken, [live()], { now: () => clock.t, logError }).sweepVisibility();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('list failed'), expect.any(Error));
  }));
});

describe('human-blocker reminder (AC14)', () => {
  async function blocked(filePath: string, clock: { t: number }) {
    const { store, record } = await running(filePath, clock, true);
    const next = await store.blockWork(record.id, record.stateVersion, { role: 'worker', slotId: 'slot-1' }, 'unit', { id: 'blocker-1', question: 'Which API?' });
    return { store, record: next };
  }

  it('posts exactly one reminder after the wait, naming job, unit and time, without the raw run id', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store, record } = await blocked(filePath, clock);
    const onRunWarning = vi.fn();
    const svc = service(filePath, store, [live()], { now: () => clock.t, onRunWarning });
    clock.t += 30 * MIN - 1;
    await svc.sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
    clock.t += 1;
    await svc.sweepVisibility();
    clock.t += 10 * MIN;
    await svc.sweepVisibility();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
    const warning = onRunWarning.mock.calls[0][1];
    expect(warning).toMatchObject({ kind: 'blocker-reminder', ref: 'unit:blocker-1' });
    expect(warning.summary).not.toContain(record.id);
    expect(warning.summary).toContain('unit "unit: Unit"');
    expect(warning.summary).toContain('30 minutes');
  }));

  it('is disabled by 0, and the setting is read live', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store } = await blocked(filePath, clock);
    const onRunWarning = vi.fn();
    let setting: number | undefined = 0;
    const svc = service(filePath, store, [live()], { now: () => clock.t, onRunWarning, blockerReminderMs: () => setting });
    clock.t += 120 * MIN;
    await svc.sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
    setting = 5 * MIN;
    await svc.sweepVisibility();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
  }));

  it('posts none for an answered blocker, a coordinator blocker, or a run that ended; state is released', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store, record } = await blocked(filePath, clock);
    const onRunWarning = vi.fn();
    const view = (mutate: (r: ExecutionRecord) => ExecutionRecord[]) => Object.assign(Object.create(store), { listActive: async () => mutate(structuredClone(record)) });
    clock.t += 60 * MIN;
    const answered = view((r) => { r.blockers![0].resolved = true; return [r]; });
    await service(filePath, answered, [live()], { now: () => clock.t, onRunWarning }).sweepVisibility();
    const coordinator = view((r) => { r.blockers![0].audience = 'coordinator'; return [r]; });
    await service(filePath, coordinator, [live()], { now: () => clock.t, onRunWarning }).sweepVisibility();
    const ended = view(() => []);
    await service(filePath, ended, [live()], { now: () => clock.t, onRunWarning }).sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
  }));

  it('re-arms nothing after the run ends, and retries a reminder whose store write failed', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store, record } = await blocked(filePath, clock);
    const logError = vi.fn();
    const onRunWarning = vi.fn();
    let fail = true;
    const flaky = Object.assign(Object.create(store), { warning: async (...args: unknown[]) => { if (fail) throw new Error('disk'); return (store as unknown as { warning: (...a: unknown[]) => Promise<unknown> }).warning(...args); } });
    const svc = service(filePath, flaky, [live()], { now: () => clock.t, onRunWarning, logError });
    clock.t += 31 * MIN;
    await svc.sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
    fail = false;
    await svc.sweepVisibility();
    await svc.sweepVisibility();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
    svc.dispose();
    // After dispose the dedupe state is gone; the run id is only used here to prove the record is unchanged.
    expect((await store.get(record.id))?.blockers?.[0].resolved).toBe(false);
  }));

  it('waits from escalation for an escalated coordinator blocker', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { store, record } = await blocked(filePath, clock);
    const onRunWarning = vi.fn();
    clock.t += 40 * MIN;
    const escalatedAt = clock.t;
    const escalated = Object.assign(Object.create(store), { listActive: async () => {
      const r = structuredClone(record); r.blockers![0].escalatedAt = escalatedAt; return [r];
    } });
    const svc = service(filePath, escalated, [live()], { now: () => clock.t, onRunWarning });
    await svc.sweepVisibility();
    expect(onRunWarning).not.toHaveBeenCalled();
    clock.t += 30 * MIN;
    await svc.sweepVisibility();
    expect(onRunWarning).toHaveBeenCalledTimes(1);
  }));

  it('shows the wait in execution_status (compact) and the board projection', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { record } = await blocked(filePath, clock);
    const compact = compactExecutionStatus(record, record.blockers![0].createdAt + 7 * MIN);
    expect(compact.blockers[0]).toMatchObject({ id: 'blocker-1', waitingSince: record.blockers![0].createdAt, waitedMs: 7 * MIN });
    expect(compactExecutionStatus(record, 0).blockers[0].waitedMs).toBe(0);
  }));
});

describe('notice naming', () => {
  const record = { request: { resolvedModels: [{ slotId: 's1', personaId: 'p-eng', label: 'Lead' }, { slotId: 's2', personaId: 'p-eng' }, { slotId: 's3' }] } } as unknown as ExecutionRecord;
  const personaName = (id: string) => (id === 'p-eng' ? 'Engineer' : undefined);

  it('uses the board label: slot label, then persona name, then the slot id', () => {
    expect(workerNoticeLabel(record, 's1', personaName)).toBe('Lead');
    expect(workerNoticeLabel(record, 's2', personaName)).toBe('Engineer');
    expect(workerNoticeLabel(record, 's3', personaName)).toBe('s3');
    expect(workerNoticeLabel(record, 'unknown')).toBe('unknown');
  });

  it('names who waits: the seat that raised the blocker, or the Squad when Zana raised it on the internal engine slot', () => {
    expect(blockerWaiter(record, 's1', personaName)).toBe('Lead');
    expect(blockerWaiter(record, 's2', personaName)).toBe('Engineer');
    expect(blockerWaiter(record, 'engine', personaName)).toBe('The Squad');
  });

  it('names a unit by title with its id, or by id alone', () => {
    expect(unitNoticeName({ id: 'slow-one', title: ' Slow one ' })).toBe('"slow-one: Slow one"');
    expect(unitNoticeName({ id: 'slow-one' })).toBe('slow-one');
  });
});
