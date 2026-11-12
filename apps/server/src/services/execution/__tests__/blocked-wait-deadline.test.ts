// Idle deadline vs. open human blockers: blocker resolution is progress, the open-blocker wait is bounded, the decision is race-safe.
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { executionProgressAnchor } from '../deadline-watchdog.js';
import { LOOP_VERDICT_OUTPUT } from '../contracts.js';

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }], policy: { deadlineMs: 100 }
};
const HOUR = 3_600_000;
const worker = { role: 'worker' as const, slotId: 'slot-1' };
const lead = { role: 'orchestrator' as const, slotId: 'lead' };

async function harness(run: (h: Awaited<ReturnType<typeof build>>) => Promise<void>, policy: Record<string, number> = { deadlineMs: 100 }): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-p0-timeout-'));
  try { await run(await build(join(dir, 'executions.json'), policy)); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function build(filePath: string, policy: Record<string, number>) {
  const clock = { now: 1_000 };
  let nextTimer = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const timerDelays: number[] = [];
  const setTimer = vi.fn((fn: () => void, ms: number) => { const id = nextTimer++; pending.set(id, { fn, ms }); timerDelays.push(ms); return id as unknown as NodeJS.Timeout; });
  const clearTimer = vi.fn((t: NodeJS.Timeout) => { pending.delete(t as unknown as number); });
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => clock.now });
  const inbox = { append: vi.fn(async () => ({ id: 'inbox-1' })), appendOnce: vi.fn(async () => ({ id: 'inbox-1' })) };
  const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
  const service = new SquadExecutionService({
    store, artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', process: 'running' }] }),
    cancelTeamLaunch, replyToSession: () => true, inbox,
    resolveExactNativeRecoverySnapshots: (r: ExecutionRecord) => r.nativeRecoverySnapshots ?? [],
    now: () => clock.now, setTimer, clearTimer
  } as never);
  const started = await service.start('session-1', 'project-1', { ...request, policy });
  if (!started.ok) throw new Error('start failed');
  const get = async () => (await store.get('execution-1'))!;
  let record = await get();
  record = await store.registerPlan(record.id, record.stateVersion, [{ id: 'unit', title: 'Unit', task: 'Work', dependencies: [], readOnly: true }]);
  record = await store.claimWork(record.id, record.stateVersion, worker, 'unit');
  record = await store.blockWork(record.id, record.stateVersion, worker, 'unit', { id: 'blocker', question: 'Need decision' });
  /** Fire every currently-pending timer once (clock untouched) and let the async handler settle. */
  const fire = async () => {
    const batch = [...pending.entries()];
    for (const [id, t] of batch) { pending.delete(id); t.fn(); }
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  const summary = (r: ExecutionRecord) => ({ state: r.state, timeoutReason: r.timeoutReason, blockerGraceUntil: r.blockerGraceUntil, anchor: executionProgressAnchor(r), blockerResolved: r.blockers?.[0]?.resolved });
  /** Move the clock past the idle deadline (anchor 1000 + 100) and let the watchdog evaluate the blocked run. */
  const pastIdle = async () => { clock.now = 1_101; await fire(); return get(); };
  return { clock, pending, timerDelays, setTimer, store, service, cancelTeamLaunch, inbox, get, fire, summary, pastIdle };
}


type H = Awaited<ReturnType<typeof build>>;
const applyDecision = (h: H, r: ExecutionRecord) => (h.service as unknown as { applyDeadlineDecision(r: ExecutionRecord): Promise<ExecutionRecord> }).applyDeadlineDecision(r);

describe('open human blocker pauses the idle deadline, bounded by the blocked wait', () => {
  it('does not stop a blocked run past the idle deadline and the old 5.5 min grace; stops at the default 4 h bound', () => harness(async (h) => {
    const paused = await h.pastIdle();
    expect(h.summary(paused)).toMatchObject({ state: 'BLOCKED', timeoutReason: undefined, blockerGraceUntil: undefined });
    h.clock.now = 1_000 + 331_101;
    await h.fire();
    expect((await h.get()).state).toBe('BLOCKED');
    expect(h.cancelTeamLaunch).not.toHaveBeenCalled();
    h.clock.now = 1_000 + 4 * HOUR - 16 * 60_000;
    await h.fire();
    expect((await h.get()).state).toBe('BLOCKED'); // warning phase, not a stop
    h.clock.now = 1_000 + 4 * HOUR;
    await h.fire();
    expect(h.summary(await h.get())).toMatchObject({ state: 'STOPPED', timeoutReason: 'unresolved-blocker' });
    expect(h.cancelTeamLaunch).toHaveBeenCalledTimes(1);
  }));

  it('warns exactly once before the bound, then stops at the bound', () => harness(async (h) => {
    await h.pastIdle();
    expect(h.timerDelays.at(-1)).toBe(8_500 - 1_101); // warn at (1_000 + 10_000) - min(15 min, 10_000 / 4)
    h.clock.now = 8_500;
    await h.fire();
    const warned = await h.get();
    expect(warned).toMatchObject({ state: 'BLOCKED', blockedWarnedAt: 8_500 });
    expect(h.inbox.appendOnce).toHaveBeenCalledTimes(1);
    expect(h.inbox.appendOnce).toHaveBeenCalledWith(expect.objectContaining({ executionId: 'execution-1', dedupeKey: 'execution-blocker-expiry:execution-1:blocker' }));
    await h.fire(); // spurious fire before the stop is due: no second warning
    expect(h.inbox.appendOnce).toHaveBeenCalledTimes(1);
    h.clock.now = 11_000;
    await h.fire();
    expect(h.summary(await h.get())).toMatchObject({ state: 'STOPPED', timeoutReason: 'unresolved-blocker' });
    expect(h.inbox.appendOnce).toHaveBeenCalledTimes(1);
  }, { deadlineMs: 100, blockedWaitMs: 10_000 }));

  it('falls back to append when the inbox has no appendOnce and survives an inbox failure', () => harness(async (h) => {
    await h.pastIdle();
    h.inbox.appendOnce.mockRejectedValueOnce(new Error('inbox down'));
    h.clock.now = 8_500;
    await h.fire();
    expect(await h.get()).toMatchObject({ state: 'BLOCKED', blockedWarnedAt: 8_500 }); // warned flag still persisted
    h.clock.now = 11_000;
    await h.fire();
    expect((await h.get()).state).toBe('STOPPED');
  }, { deadlineMs: 100, blockedWaitMs: 10_000 }));

  it('stops straight at the bound when the warning window was missed (e.g. restart after downtime)', () => harness(async (h) => {
    h.clock.now = 20_000;
    await h.fire();
    expect(h.summary(await h.get())).toMatchObject({ state: 'STOPPED', timeoutReason: 'unresolved-blocker' });
    expect(h.inbox.appendOnce).not.toHaveBeenCalled();
  }, { deadlineMs: 100, blockedWaitMs: 10_000 }));

  it('blockedWaitMs 0 means no cap: never stopped while blocked and no timer is armed', () => harness(async (h) => {
    h.clock.now = 1_000 + 48 * HOUR;
    await h.fire();
    expect((await h.get()).state).toBe('BLOCKED');
    expect(h.pending.size).toBe(0);
    expect(h.cancelTeamLaunch).not.toHaveBeenCalled();
  }, { deadlineMs: 100, blockedWaitMs: 0 }));

  it('a coordinator-audience blocker does not pause the idle deadline', () => harness(async (h) => {
    const r = await h.get();
    // Replace the human blocker with a coordinator one by resolving it through retry and re-blocking.
    h.clock.now = 1_050;
    let next = await h.store.retryWork(r.id, r.stateVersion, lead, 'unit');
    next = await h.store.claimWork(next.id, next.stateVersion, worker, 'unit');
    await h.store.blockWork(next.id, next.stateVersion, worker, 'unit', { id: 'coord', question: 'Plan?', audience: 'coordinator' });
    h.clock.now = 1_150 + 100;
    await h.service.restoreDeadlines();
    await h.fire();
    expect(h.summary(await h.get())).toMatchObject({ state: 'STOPPED', timeoutReason: 'idle' });
  }));

  it('deadlineMs 0 (no idle deadline) arms nothing even with an open blocker', () => harness(async (h) => {
    h.clock.now = 1_000 + 48 * HOUR;
    await h.fire();
    expect((await h.get()).state).toBe('BLOCKED');
  }, {}));
});

describe('blocker resolution is progress', () => {
  it('(a1) retryWork resolution advances the anchor, clears the stale grace and re-arms from the resolution', () => harness(async (h) => {
    await h.pastIdle();
    h.clock.now = 5_000;
    const r = await h.get();
    const after = await h.service.retryWorkFromBoard('session-1', 'project-1', r.id, r.stateVersion, 'unit');
    expect(after.ok).toBe(true);
    const rec = await h.get();
    expect(rec.blockers![0]).toMatchObject({ resolved: true, resolvedAt: 5_000 });
    expect(executionProgressAnchor(rec)).toBe(5_000);
    expect(rec.blockerGraceUntil).toBeUndefined();
    expect(rec.blockedWarnedAt).toBeUndefined();
    expect(h.timerDelays.at(-1)).toBe(100); // watchdog re-armed at anchor + deadlineMs
  }));

  it('(a2) delivery-ack resolution re-issues the claim and lease so worker output advances the anchor', () => harness(async (h) => {
    await h.pastIdle();
    h.clock.now = 5_000;
    const r = await h.get();
    const heldClaim = { claimId: r.workUnits![0].claimId, claimGeneration: r.workUnits![0].claimGeneration };
    const queued = await h.store.enqueueBlockerDelivery(r.id, r.stateVersion, { clientRequestId: 'c1', blockerId: 'blocker', text: 'answer' });
    const binding = { executionId: r.id, projectId: 'project-1', ...worker };
    const leased = await h.store.pullBlockerDelivery(binding);
    expect(queued.record.blockers![0].resolved).toBe(false);
    const acked = await h.store.ackBlockerDelivery(binding, leased!.id, leased!.leaseId!, { delivered: true });
    const unit = acked.record.workUnits![0];
    expect(unit).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'slot-1', progressAt: 5_000, claimedAt: 5_000, leaseExpiresAt: 5_000 + 300_000, turnCount: 0 });
    // The worker's claim fence survives the block/answer so its own outcome calls stay valid.
    expect(unit.claimId).toEqual(expect.any(String));
    expect({ claimId: unit.claimId, claimGeneration: unit.claimGeneration }).toEqual(heldClaim);
    expect(executionProgressAnchor(acked.record)).toBe(5_000);
    expect(acked.record.blockerGraceUntil).toBeUndefined();
    // worker output now renews and advances progress
    h.clock.now = 5_000 + 280_000;
    const renewed = await h.store.renewWorkerLease(r.id, 'slot-1', { advanceProgress: true });
    expect(executionProgressAnchor(renewed!)).toBe(285_000);
  }));

  it('service ack path re-schedules the watchdog; respond/resume deliver through the same ack', () => harness(async (h) => {
    await h.pastIdle();
    h.clock.now = 5_000;
    const r = await h.get();
    const accepted = await h.service.resume('session-1', 'project-1', r.id, r.stateVersion, 'slot-1', 'answer');
    expect(accepted.ok).toBe(true);
    const binding = { executionId: r.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-1', authorizationId: 'auth-current' };
    const pulled = await h.service.pullDelivery(binding);
    if (!pulled.ok || !pulled.value) throw new Error('missing delivery');
    const delays = h.timerDelays.length;
    const ack = await h.service.ackDelivery(binding, pulled.value.id, pulled.value.leaseId!, { delivered: true });
    expect(ack).toMatchObject({ ok: true, value: { resolved: true } });
    expect(h.timerDelays.slice(delays)).toEqual([100]);
    // a failed delivery does not resolve or re-arm
    expect(executionProgressAnchor(await h.get())).toBe(5_000);
  }));

  it('a failed ack leaves the blocker open and the deadline paused', () => harness(async (h) => {
    await h.pastIdle();
    h.clock.now = 5_000;
    const r = await h.get();
    await h.service.respondToBlocker('session-1', 'project-1', r.id, r.stateVersion, 'blocker', 'client-1', 'answer');
    const binding = { executionId: r.id, projectId: 'project-1', slotId: 'slot-1', role: 'worker' as const, principalId: 'worker-1', authorizationId: 'auth-current' };
    const pulled = await h.service.pullDelivery(binding);
    if (!pulled.ok || !pulled.value) throw new Error('missing delivery');
    await h.service.ackDelivery(binding, pulled.value.id, pulled.value.leaseId!, { delivered: false, error: 'no' });
    const rec = await h.get();
    expect(rec.blockers![0].resolved).toBe(false);
    expect(executionProgressAnchor(rec)).toBe(1_000);
  }));

  it('(b2) resolved without further progress: the idle stop comes a full window after resolution, not at the old grace time', () => harness(async (h) => {
    await h.pastIdle();
    h.clock.now = 5_000;
    const r = await h.get();
    await h.service.retryWorkFromBoard('session-1', 'project-1', r.id, r.stateVersion, 'unit');
    h.clock.now = 5_050;
    await h.fire();
    expect((await h.get()).state).toBe('RUNNING');
    h.clock.now = 5_100;
    await h.fire();
    expect(h.summary(await h.get())).toMatchObject({ state: 'STOPPED', timeoutReason: 'idle' });
  }));

  it('(b3) a stale-past grace on a persisted record cannot spin the watchdog at delay 0', () => harness(async (h) => {
    await h.pastIdle();
    h.clock.now = 5_000;
    const r = await h.get();
    let rec = await h.store.retryWork(r.id, r.stateVersion, lead, 'unit');
    rec = await h.store.claimWork(rec.id, rec.stateVersion, worker, 'unit');
    h.clock.now = 5_080;
    await h.service.restoreDeadlines();
    const delays = h.timerDelays.length;
    h.clock.now = 5_099; // timer for 5_100 is not due; frozen clock
    for (let i = 0; i < 5; i++) await h.fire();
    expect(h.timerDelays.slice(delays).every((d) => d > 0)).toBe(true);
    expect((await h.get()).state).toBe('RUNNING');
  }));

  it('(b3b) progress committed early still keeps the run alive past the old grace time', () => harness(async (h) => {
    await h.pastIdle();
    h.clock.now = 5_000;
    const r = await h.get();
    let rec = await h.store.retryWork(r.id, r.stateVersion, lead, 'unit');
    h.clock.now = 6_000;
    rec = await h.store.claimWork(rec.id, rec.stateVersion, worker, 'unit');
    expect(executionProgressAnchor(rec)).toBe(6_000);
    h.clock.now = 6_050;
    await h.fire();
    expect((await h.get()).state).toBe('RUNNING');
  }));

  it('resolution on a terminal run is a no-op', () => harness(async (h) => {
    h.clock.now = 1_000 + 4 * HOUR;
    await h.fire();
    const stopped = await h.get();
    expect(stopped.state).toBe('STOPPED');
    await expect(h.store.retryWork(stopped.id, stopped.stateVersion, lead, 'unit')).rejects.toThrow();
    expect((await h.get()).state).toBe('STOPPED');
  }));
});

describe('claim re-issue after an answer', () => {
  it('a slow answer does not reclaim a still-parked worker before the new lease expires; a worker that never resumes is reclaimed after it', () => harness(async (h) => {
    h.clock.now = 5_000;
    const r = await h.get();
    await h.store.enqueueBlockerDelivery(r.id, r.stateVersion, { clientRequestId: 'c1', blockerId: 'blocker', text: 'answer' });
    const binding = { executionId: r.id, projectId: 'project-1', ...worker };
    const leased = await h.store.pullBlockerDelivery(binding);
    const acked = await h.store.ackBlockerDelivery(binding, leased!.id, leased!.leaseId!, { delivered: true });
    const unit = acked.record.workUnits![0];
    expect(unit.leaseExpiresAt).toBe(305_000);
    const claim = { workUnitId: 'unit', claimId: unit.claimId!, claimGeneration: unit.claimGeneration! };
    h.clock.now = 304_999;
    expect((await h.get()).workUnits![0].leaseExpiresAt).toBeGreaterThan(h.clock.now); // still leased: nothing to reclaim
    h.clock.now = 305_001;
    const reclaimed = await h.store.reclaimExpiredClaims(r.id, [{ ...claim, reason: 'test expired lease' } as never]);
    expect(reclaimed.workUnits![0].state).not.toBe('CLAIMED');
  }));

  it('a resumed worker re-claiming after the ack does not double-claim', () => harness(async (h) => {
    h.clock.now = 5_000;
    const r = await h.get();
    await h.store.enqueueBlockerDelivery(r.id, r.stateVersion, { clientRequestId: 'c1', blockerId: 'blocker', text: 'answer' });
    const binding = { executionId: r.id, projectId: 'project-1', ...worker };
    const leased = await h.store.pullBlockerDelivery(binding);
    const acked = await h.store.ackBlockerDelivery(binding, leased!.id, leased!.leaseId!, { delivered: true });
    const first = acked.record.workUnits![0];
    const again = await h.store.claimWork(r.id, (await h.get()).stateVersion, worker, 'unit');
    expect(again.workUnits![0]).toMatchObject({ claimId: first.claimId, claimGeneration: first.claimGeneration, state: 'CLAIMED' });
  }));

  it('an unassigned unit goes READY on ack and is claimable through claimWork', () => harness(async (h) => {
    // Retry without assignment returns the unit READY/unassigned; resolution still counts as progress.
    h.clock.now = 5_000;
    const r = await h.get();
    const rec = await h.store.retryWork(r.id, r.stateVersion, lead, 'unit');
    expect(rec.workUnits![0]).toMatchObject({ state: 'READY', progressAt: 5_000 });
    const claimed = await h.store.claimWork(rec.id, rec.stateVersion, worker, 'unit');
    expect(claimed.workUnits![0].state).toBe('CLAIMED');
  }));
});

describe('decision is race-safe', () => {
  it('(c) a stale pre-queue record cannot stop a run whose blocker was resolved and progressed', () => harness(async (h) => {
    h.clock.now = 1_101;
    const stale = await h.get();
    let r = await h.store.retryWork(stale.id, stale.stateVersion, lead, 'unit');
    r = await h.store.claimWork(r.id, r.stateVersion, worker, 'unit');
    expect(executionProgressAnchor(r)).toBe(1_101);
    expect(await applyDecision(h, stale)).toMatchObject({ state: 'RUNNING' });
    expect(h.cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('(c2) a fresh record gives the same decision', () => harness(async (h) => {
    h.clock.now = 1_101;
    const stale = await h.get();
    let r = await h.store.retryWork(stale.id, stale.stateVersion, lead, 'unit');
    r = await h.store.claimWork(r.id, r.stateVersion, worker, 'unit');
    expect((await applyDecision(h, r)).state).toBe('RUNNING');
  }));

  it('(c3) retry queued right behind enforceDeadline commits first and the follow-up claim succeeds', () => harness(async (h) => {
    h.clock.now = 1_101;
    const stale = await h.get();
    const enforce = (h.service as unknown as { enforceDeadline(id: string): Promise<void> }).enforceDeadline(stale.id);
    const resolved = await h.store.retryWork(stale.id, stale.stateVersion, lead, 'unit');
    const claim = await h.store.claimWork(resolved.id, resolved.stateVersion, worker, 'unit').then(() => 'claimed', (e: Error) => e.message);
    await enforce;
    const r = await h.get();
    expect(r.state).toBe('RUNNING');
    expect(claim).toBe('claimed');
    expect(h.cancelTeamLaunch).not.toHaveBeenCalled();
  }));

  it('terminal side effects run only for a stopped decision; a continue decision never cancels the launch', () => harness(async (h) => {
    h.clock.now = 1_101;
    await applyDecision(h, await h.get());
    expect(h.cancelTeamLaunch).not.toHaveBeenCalled();
  }));
});

describe('review-loop limit blocker', () => {
  it('is a human blocker that pauses the deadline and grantLoopRound resolves it as progress', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-loop-deadline-'));
    try {
      const clock = { now: 1_000 };
      const store = createExecutionStore({ filePath: join(dir, 'e.json'), id: () => 'execution-1', now: () => clock.now });
      let rec = (await store.claim({
        callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Loop', requestDigest: 'd', launchRequestId: 'l', resolvedModels: [],
        request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [], policy: { deadlineMs: 100 } }
      })).record;
      rec = await store.transition(rec.id, rec.stateVersion, 'STARTING', 'info', 'start');
      rec = await store.transition(rec.id, rec.stateVersion, 'RUNNING', 'info', 'run');
      rec = await store.registerPlan(rec.id, rec.stateVersion, [
        { id: 'r', title: 'Review', task: 'Review', dependencies: [], readOnly: true, loop: { version: 1, fixUnitId: 'f', until: 'PASS', max: 1 }, output: LOOP_VERDICT_OUTPUT },
        { id: 'f', title: 'Fix', task: 'Fix', dependencies: ['r'], readOnly: true }
      ]);
      rec = await store.claimWork(rec.id, rec.stateVersion, worker, 'r');
      const unit = rec.workUnits!.find((u) => u.id === 'r')!;
      rec = await store.completeWork(rec.id, rec.stateVersion, worker, 'r', 'result', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! }, true, { verdict: 'CHANGES' });
      expect(rec.state).toBe('BLOCKED');
      clock.now = 1_000 + 10 * 60_000;
      const timings = { deadlineMs: 100, blockedWaitMs: 4 * HOUR };
      expect((await store.decideDeadline(rec.id, timings)).kind).toBe('continue'); // idle window long past, still paused
      expect((await store.get(rec.id))!.state).toBe('BLOCKED');
      rec = (await store.get(rec.id))!;
      clock.now = 1_000 + 20 * 60_000;
      rec = await store.retryWork(rec.id, rec.stateVersion, lead, 'r');
      expect(rec.workUnits!.find((u) => u.id === 'r')).toMatchObject({ loopExtraRounds: 1, progressAt: clock.now });
      expect(executionProgressAnchor(rec)).toBe(clock.now);
      expect(rec.blockerGraceUntil).toBeUndefined();
      expect(rec.blockedWarnedAt).toBeUndefined();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
