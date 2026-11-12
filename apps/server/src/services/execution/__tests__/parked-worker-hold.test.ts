// Parked-worker hold (R5/D2): an unresolved blocker keeps the slot's session out of the host idle sweep via a self-expiring timestamp.
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { PARKED_HOLD_MAX_MS, ParkedWorkerHolds, deriveParkedHolds, parkedHoldWaitMs } from '../parked-worker-hold.js';

const HOUR = 3_600_000;
const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }], policy: { deadlineMs: 45 * 60_000 }
};
const worker = { role: 'worker' as const, slotId: 'slot-1' };
const lead = { role: 'orchestrator' as const, slotId: 'lead' };
const bindingOf = (b: typeof worker | typeof lead) => ({ executionId: 'execution-1', projectId: 'project-1', ...b });

type Retain = (record: ExecutionRecord, sessionId: string, retainUntilMs: number | null) => Promise<void>;

async function harness(run: (h: Awaited<ReturnType<typeof build>>) => Promise<void>, opts: { policy?: Record<string, number>; preBlock?: boolean } = {}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-parked-hold-'));
  try { await run(await build(join(dir, 'executions.json'), opts)); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function build(filePath: string, opts: { policy?: Record<string, number>; preBlock?: boolean }) {
  const clock = { now: 1_000 };
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => clock.now });
  const retain = vi.fn<Retain>(async () => undefined);
  const logError = vi.fn();
  const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
  const service = new SquadExecutionService({
    store, artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }),
    cancelTeamLaunch, replyToSession: () => true, logError,
    inbox: { append: vi.fn(async () => ({ id: 'inbox-1' })), appendOnce: vi.fn(async () => ({ id: 'inbox-1' })) },
    resolveExactNativeRecoverySnapshots: (r: ExecutionRecord) => r.nativeRecoverySnapshots ?? [],
    retainParkedWorker: retain,
    now: () => clock.now, setTimer: (() => 0 as unknown as NodeJS.Timeout), clearTimer: () => undefined
  } as never);
  const started = await service.start('session-1', 'project-1', { ...request, policy: opts.policy ?? request.policy });
  if (!started.ok) throw new Error('start failed');
  const get = async () => (await store.get('execution-1'))!;
  let record = await get();
  record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
  record = await store.claimWork(record.id, record.stateVersion, worker, 'unit');
  if (opts.preBlock !== false) await store.blockWork(record.id, record.stateVersion, worker, 'unit', { id: 'blocker', question: 'Need decision' });
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return { clock, store, service, retain, logError, cancelTeamLaunch, get, settle };
}

describe('deriveParkedHolds', () => {
  const base = (over: Partial<ExecutionRecord>) => ({ state: 'RUNNING', request: { policy: {} }, blockers: [], ...over }) as unknown as ExecutionRecord;
  const blocker = (id: string, slotId: string, createdAt: number, resolved = false) => ({ id, slotId, workUnitId: 'u', question: 'q', resolved, createdAt });

  it('anchors every hold at the oldest open human blocker (the deadline anchor) and ignores resolved ones', () => {
    const record = base({ blockers: [blocker('a', 's1', 100), blocker('b', 's1', 500), blocker('c', 's2', 100, true), blocker('d', 's3', 900)] });
    expect(deriveParkedHolds(record, 1_000)).toEqual(new Map([['s1', 100 + 4 * HOUR], ['s3', 100 + 4 * HOUR]]));
    // A later blocker never extends retention past the oldest blocker's bound.
    expect(deriveParkedHolds(record, 100 + 4 * HOUR).size).toBe(0);
  });

  it('does not hold for coordinator self-heal blockers', () => {
    const coordinator = { ...blocker('a', 's1', 100), audience: 'coordinator' };
    expect(deriveParkedHolds(base({ blockers: [coordinator, blocker('b', 's2', 200)] }), 1_000)).toEqual(new Map([['s2', 200 + 4 * HOUR]]));
    expect(deriveParkedHolds(base({ blockers: [coordinator] }), 1_000).size).toBe(0);
  });

  it('uses the policy bound, treats 0 as the 24 h ceiling and never exceeds it', () => {
    expect(parkedHoldWaitMs(base({ request: { policy: { blockedWaitMs: HOUR } } as never }))).toBe(HOUR);
    expect(parkedHoldWaitMs(base({ request: { policy: { blockedWaitMs: 0 } } as never }))).toBe(PARKED_HOLD_MAX_MS);
    expect(parkedHoldWaitMs(base({ request: { policy: { blockedWaitMs: 99 * HOUR } } as never }))).toBe(PARKED_HOLD_MAX_MS);
    expect(parkedHoldWaitMs(base({ request: { policy: { blockedWaitMs: -5 } } as never }))).toBe(4 * HOUR);
    const uncapped = base({ request: { policy: { blockedWaitMs: 0 } } as never, blockers: [blocker('a', 's1', 0)] });
    expect(deriveParkedHolds(uncapped, 1_000).get('s1')).toBe(PARKED_HOLD_MAX_MS);
  });

  it('holds nothing for a terminal run or a blocker already past its bound', () => {
    expect(deriveParkedHolds(base({ state: 'STOPPED', blockers: [blocker('a', 's1', 100)] }), 1_000).size).toBe(0);
    expect(deriveParkedHolds(base({ blockers: [blocker('a', 's1', 100)] }), 100 + 4 * HOUR).size).toBe(0);
  });
});

describe('ParkedWorkerHolds', () => {
  const rec = (blockers: unknown[], state = 'RUNNING') => ({ id: 'e', state, request: { policy: {} }, blockers }) as unknown as ExecutionRecord;
  const open = { id: 'a', slotId: 's1', resolved: false, createdAt: 100 };

  it('retries a failed clear on the next sync and logs failures without throwing', async () => {
    let current = rec([open]);
    const retain = vi.fn<(r: ExecutionRecord, s: string, u: number | null) => Promise<void>>(async () => undefined);
    const logError = vi.fn();
    const holds = new ParkedWorkerHolds({ now: () => 1_000, load: async () => current, retain, logError });
    await holds.sync('e');
    expect(holds.heldSlots('e')).toEqual(['s1']);
    current = rec([{ ...open, resolved: true }]);
    retain.mockRejectedValueOnce(new Error('host down'));
    await holds.sync('e');
    expect(logError).toHaveBeenCalledOnce();
    expect(holds.heldSlots('e')).toEqual(['s1']); // clear failed: still tracked
    await holds.sync('e');
    expect(retain).toHaveBeenLastCalledWith(current, 's1', null);
    expect(holds.heldSlots('e')).toEqual([]);
  });

  it('logs a failed hold, forgets a deleted record and serializes syncs per execution', async () => {
    let current: ExecutionRecord | undefined = rec([open]);
    const order: string[] = [];
    const retain = vi.fn<(r: ExecutionRecord, s: string, u: number | null) => Promise<void>>(async (_r, _s, until) => { order.push(String(until)); await new Promise((r) => setImmediate(r)); });
    const logError = vi.fn();
    const holds = new ParkedWorkerHolds({ now: () => 1_000, load: async () => current, retain, logError });
    retain.mockRejectedValueOnce(new Error('nope'));
    await holds.sync('e');
    expect(logError).toHaveBeenCalledOnce();
    current = rec([{ ...open, resolved: true }]);
    await Promise.all([holds.sync('e'), holds.sync('e', { restore: true })]);
    expect(order.filter((value) => value === 'null').length).toBeGreaterThanOrEqual(1);
    current = undefined;
    await holds.sync('e');
    expect(holds.heldSlots('e')).toEqual([]);
  });
});

describe('ExecutionService parked-worker hold feed', () => {
  it('feeds a self-expiring hold when a worker blocks and does not feed other slots', () => harness(async (h) => {
    const unit = (await h.get()).workUnits![0];
    expect(unit.state).toBe('CLAIMED');
    const blocked = await h.service.blockWork(bindingOf(worker), 'unit', { id: 'blocker', question: 'Need decision' }, undefined, false);
    expect(blocked.ok).toBe(true);
    await h.settle();
    expect(h.retain).toHaveBeenCalledWith(expect.objectContaining({ id: 'execution-1' }), 'worker-1', 1_000 + 4 * HOUR);
    expect(h.retain.mock.calls.every(([, sessionId]) => sessionId === 'worker-1')).toBe(true);
  }, { preBlock: false }));

  it('re-derives the hold from the open blocker on restore()', () => harness(async (h) => {
    await h.service.restoreDeadlines();
    await h.settle();
    expect(h.retain).toHaveBeenCalledWith(expect.anything(), 'worker-1', 1_000 + 4 * HOUR);
  }));

  it('honours the policy bound and 0 = 24 h on restore()', async () => {
    await harness(async (h) => { await h.service.restoreDeadlines(); await h.settle(); expect(h.retain).toHaveBeenCalledWith(expect.anything(), 'worker-1', 1_000 + HOUR); }, { policy: { deadlineMs: 100, blockedWaitMs: HOUR } });
    await harness(async (h) => { await h.service.restoreDeadlines(); await h.settle(); expect(h.retain).toHaveBeenCalledWith(expect.anything(), 'worker-1', 1_000 + PARKED_HOLD_MAX_MS); }, { policy: { deadlineMs: 100, blockedWaitMs: 0 } });
  });

  it('does not hold a blocker already past its bound (stale hold simply expires; nothing is fed)', () => harness(async (h) => {
    h.clock.now = 1_000 + 4 * HOUR + 1;
    await h.service.restoreDeadlines();
    await h.settle();
    expect(h.retain.mock.calls.filter(([, , until]) => until !== null)).toEqual([]);
  }));

  it('clears the hold when the blocker resolves (retry resolution path)', () => harness(async (h) => {
    await h.service.restoreDeadlines();
    await h.settle();
    h.retain.mockClear();
    const retried = await h.service.retryWork(bindingOf(lead), 'unit');
    expect(retried.ok).toBe(true);
    await h.settle();
    expect(h.retain).toHaveBeenCalledWith(expect.anything(), 'worker-1', null);
    expect(h.retain.mock.calls.filter(([, , until]) => until !== null)).toEqual([]);
  }));

  it('clears the hold when the run reaches a terminal state', () => harness(async (h) => {
    await h.service.restoreDeadlines();
    await h.settle();
    h.retain.mockClear();
    const record = await h.get();
    const stopped = await h.service.stop('session-1', 'project-1', record.id, record.stateVersion);
    expect(stopped.ok).toBe(true);
    await h.settle();
    expect(h.retain).toHaveBeenCalledWith(expect.anything(), 'worker-1', null);
    expect(h.retain.mock.calls.filter(([, , until]) => until !== null)).toEqual([]);
  }));

  it('re-clears a resolved slot on restore() after a server restart (nothing tracked in memory)', () => harness(async (h) => {
    const record = await h.get();
    await h.store.retryWork(record.id, record.stateVersion, lead, 'unit');
    await h.service.restoreDeadlines();
    await h.settle();
    expect(h.retain).toHaveBeenCalledWith(expect.anything(), 'worker-1', null);
  }));

  it('never throws into the engine when the host hold fails', () => harness(async (h) => {
    h.retain.mockRejectedValue(new Error('host offline'));
    await h.service.restoreDeadlines();
    await h.settle();
    expect(h.logError).toHaveBeenCalledWith(expect.stringContaining('parked-worker hold failed'), expect.any(Error));
  }));
});
