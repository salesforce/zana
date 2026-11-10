import { describe, expect, it, vi } from 'vitest';
import {
  createSeatApprovals, createSeatRecycler, createSeatStarter, lifecycleRecycleOps, respawnApproval, seatApprovalId, seatBindExtras,
  seatLaunchMode, seatLaunchProblem, seatRecovery, seatRosterEntry, SEAT_EXIT_WAIT_MS, SEAT_REST_WAIT_MS, type SeatRecyclerDeps
} from '../on-demand-seat.js';

/** #579: the order a seat's session is replaced in, and the small decisions host.ts only wires. */
type Timer = { fn: () => void; ms: number; live: boolean };
function setup(over: Partial<SeatRecyclerDeps> = {}) {
  const order: string[] = [];
  const timers: Timer[] = [];
  const state = { current: 'working' as string | undefined, sessionId: 'old' as string | undefined };
  const deps: SeatRecyclerDeps = {
    stateOf: () => state.current,
    sessionOf: async () => state.sessionId,
    sampleUsage: async (_e, session, slot) => { order.push(`sample:${session}:${slot}`); },
    detach: async () => { order.push('detach'); return true; },
    clearRecovery: async () => { order.push('clear'); },
    close: async (id) => { order.push(`close:${id}`); },
    log: vi.fn(),
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (handle) => { (handle as Timer).live = false; },
    ...over
  };
  const respawn = vi.fn(async () => ({ ok: true as const, sessionId: 'new' }));
  const recycler = createSeatRecycler(deps);
  recycler.register('r1', ['s1'], { executionId: 'e1', respawn });
  return { recycler, deps, order, timers, state, respawn };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createSeatRecycler', () => {
  it('waits for rest, samples usage, detaches BEFORE it closes, clears the snapshot after the exit, then respawns', async () => {
    const { recycler, order, respawn, state } = setup();
    const done = recycler.recycle('r1', 's1');
    await tick();
    expect(order).toEqual([]);
    state.current = 'idle';
    recycler.onState('old', 'idle');
    await tick();
    expect(order).toEqual(['sample:old:s1', 'detach', 'close:old']);
    recycler.onExit('old');
    await expect(done).resolves.toEqual({ sessionId: 'new' });
    expect(order).toEqual(['sample:old:s1', 'detach', 'close:old', 'clear']);
    expect(respawn).toHaveBeenCalledWith('s1');
  });

  it('does not wait when the session is already at rest', async () => {
    const { recycler, state, order } = setup();
    state.current = 'idle';
    const done = recycler.recycle('r1', 's1');
    await tick();
    expect(order).toContain('detach');
    recycler.onExit('old');
    await done;
  });

  it('declines, leaving the session open, when the rest wait runs out and it is still working (Q2)', async () => {
    const { recycler, timers, order, respawn } = setup();
    const done = recycler.recycle('r1', 's1');
    await tick();
    expect(timers[0].ms).toBe(SEAT_REST_WAIT_MS);
    timers[0].fn();
    await expect(done).resolves.toEqual({ declined: true });
    expect(order).toEqual([]);
    expect(respawn).not.toHaveBeenCalled();
  });

  it('declines when messages are queued for the session after the wait (F-guard)', async () => {
    const { recycler, state, order } = setup({ queuedFor: () => 2 });
    state.current = 'idle';
    await expect(recycler.recycle('r1', 's1')).resolves.toEqual({ declined: true });
    expect(order).toEqual([]);
  });

  it('declines when the session picks up work during the usage sample', async () => {
    const { recycler, state, order } = setup({ sampleUsage: async () => { state.current = 'working'; } });
    state.current = 'idle';
    await expect(recycler.recycle('r1', 's1')).resolves.toEqual({ declined: true });
    expect(order).toEqual([]);
  });

  it('closes the old session without respawning when the run is released during the sample (Q4)', async () => {
    let release!: () => void;
    const { recycler, state, order, respawn } = setup({ sampleUsage: () => new Promise<void>((resolve) => { release = resolve; }) });
    state.current = 'idle';
    const done = recycler.recycle('r1', 's1');
    await tick();
    recycler.release('r1');
    release();
    await expect(done).resolves.toEqual({ final: true });
    expect(order).not.toContain('detach');
    expect(respawn).not.toHaveBeenCalled();
  });

  it('proceeds when the wait runs out but the session came to rest meanwhile', async () => {
    const { recycler, timers, order, state } = setup();
    const done = recycler.recycle('r1', 's1');
    await tick();
    expect(SEAT_REST_WAIT_MS).toBeLessThan(300_000);
    state.current = 'idle';
    timers[0].fn();
    await tick();
    expect(order).toContain('close:old');
    timers[1].fn();
    await expect(done).resolves.toEqual({ sessionId: 'new' });
    expect(timers[1].ms).toBe(SEAT_EXIT_WAIT_MS);
  });

  it('ignores a state that is not a rest state', async () => {
    const { recycler, order } = setup();
    void recycler.recycle('r1', 's1');
    await tick();
    recycler.onState('old', 'working');
    await tick();
    expect(order).toEqual([]);
  });

  it('carries on when a step fails: a failed usage sample, recovery clear or close is logged and the respawn still goes ahead', async () => {
    const log = vi.fn();
    const { recycler, state } = setup({
      log, sampleUsage: async () => { throw new Error('no stats'); }, clearRecovery: async () => { throw new Error('store'); },
      close: async () => { throw new Error('stuck'); }
    });
    state.current = 'done';
    const done = recycler.recycle('r1', 's1');
    await tick();
    recycler.onExit('old');
    await expect(done).resolves.toEqual({ sessionId: 'new' });
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.map((call) => call[0]).join(' ')).toContain('r1/s1');
  });

  it('starts the new session without closing anything when the seat has no session', async () => {
    const { recycler, state, order, respawn } = setup();
    state.sessionId = undefined;
    await expect(recycler.recycle('r1', 's1')).resolves.toEqual({ sessionId: 'new' });
    expect(order).toEqual([]);
    expect(respawn).toHaveBeenCalled();
  });

  it('leaves the old session alone when there is nothing to detach', async () => {
    const { recycler, state, order } = setup({ detach: async () => false });
    state.current = 'idle';
    await recycler.recycle('r1', 's1');
    expect(order).not.toContain('close:old');
  });

  it('skips usage and the snapshot for a launch that is not an execution', async () => {
    const { deps, state, order } = setup();
    const recycler = createSeatRecycler(deps);
    recycler.register('r2', ['s1'], { respawn: async () => ({ ok: true, sessionId: 'n2' }) });
    state.current = 'idle';
    const done = recycler.recycle('r2', 's1');
    await tick();
    recycler.onExit('old');
    await done;
    expect(order).toEqual(['detach', 'close:old']);
  });

  it('reports a refused respawn: final for a seat that cannot start, empty for one that may start later', async () => {
    const { recycler, state } = setup();
    state.sessionId = undefined;
    const final = createSeatRecycler({ ...setup().deps, sessionOf: async () => undefined });
    final.register('r', ['s1'], { respawn: async () => ({ ok: false, message: 'no' }) });
    await expect(final.recycle('r', 's1')).resolves.toEqual({ final: true });
    const later = createSeatRecycler({ ...setup().deps, sessionOf: async () => undefined });
    later.register('r', ['s1'], { respawn: async () => ({ ok: false, message: 'busy', retryable: true }) });
    await expect(later.recycle('r', 's1')).resolves.toEqual({});
  });

  it('declines when no run is registered (after a restart), leaving the unit with the current session', async () => {
    const { recycler } = setup();
    await expect(recycler.recycle('nobody', 's1')).resolves.toEqual({ declined: true });
    const other = createSeatRecycler(setup().deps);
    other.register('empty', [], { respawn: async () => ({ ok: true, sessionId: 'x' }) });
    expect(other.has('empty')).toBe(false);
  });

  it('release releases the waiters and timers of that run and a recycle that finishes after it closes the new session', async () => {
    const closed: string[] = [];
    const { recycler, timers, deps } = setup({ close: async (id) => { closed.push(id); } });
    void deps;
    const pending = recycler.recycle('r1', 's1');
    await tick();
    expect(recycler.has('r1')).toBe(true);
    recycler.release('r1');
    expect(recycler.has('r1')).toBe(false);
    expect(timers.every((t) => !t.live)).toBe(true);
    await expect(pending).resolves.toEqual({ final: true });
    expect(closed).toEqual([]);

    const late = setup({ close: async (id) => { closed.push(id); } });
    late.state.sessionId = undefined;
    let resolveStart!: (v: { ok: true; sessionId: string }) => void;
    late.recycler.register('r3', ['s1'], { respawn: () => new Promise((resolve) => { resolveStart = resolve; }) });
    const finishing = late.recycler.recycle('r3', 's1');
    await tick();
    late.recycler.release('r3');
    resolveStart({ ok: true, sessionId: 'late-session' });
    await expect(finishing).resolves.toEqual({ final: true });
    expect(closed).toEqual(['late-session']);
  });

  it('release leaves the waiters of another run alone', async () => {
    const { recycler, timers } = setup();
    recycler.register('r9', ['s1'], { respawn: async () => ({ ok: true, sessionId: 'n' }) });
    void recycler.recycle('r1', 's1');
    await tick();
    recycler.release('r9');
    expect(timers.some((t) => t.live)).toBe(true);
  });
});

describe('small decisions', () => {
  it('seatLaunchMode, seatBindExtras, seatApprovalId', () => {
    expect(seatLaunchMode(false, undefined)).toBe('start');
    expect(seatLaunchMode(true, undefined)).toBe('lateSeat');
    expect(seatLaunchMode(true, 'a')).toBe('respawn');
    expect(seatBindExtras(false, false)).toEqual({});
    expect(seatBindExtras(true, true)).toEqual({ replace: true, deliveredUnitCount: 0 });
    expect(seatBindExtras(false, true)).toEqual({ deliveredUnitCount: 0 });
    expect(seatApprovalId('r', 'l')).toBe('r');
    expect(seatApprovalId(undefined, 'l')).toBe('l');
  });

  it('seatRecovery drops the old conversation only when asked', () => {
    const recovery = { configuredProfile: 'claude', profile: 'resumed', resumeSessionId: 'x', extraArgs: ['--resume'], recoveryResume: true };
    expect(seatRecovery(recovery, false)).toBe(recovery);
    expect(seatRecovery(recovery, true)).toEqual({ configuredProfile: 'claude', profile: 'claude', recoveryResume: false });
  });

  it('seatRosterEntry never lists a session id for a fresh-context seat', () => {
    const seat = { slotId: '0:w:0', label: 'W' };
    expect(seatRosterEntry(seat, { fresh: true, sessionId: 's1' })).toEqual({ ...seat, startsWhenNeeded: true, freshSessionPerUnit: true });
    expect(seatRosterEntry(seat, { fresh: false })).toEqual({ ...seat, startsWhenNeeded: true });
    expect(seatRosterEntry(seat, { fresh: false, sessionId: 's1' })).toEqual({ ...seat, sessionId: 's1' });
  });

  it('seatLaunchProblem refuses on-demand and fresh-context seats by the same rules', () => {
    const seat = { slotId: '0:a:0', personaId: 'a', label: 'Engineer', role: 'worker' as const };
    const team = { slots: [{ freshContextPerUnit: true }] };
    expect(seatLaunchProblem(team, [seat], { durable: true, structured: true }, true)).toBeUndefined();
    expect(seatLaunchProblem({ transport: 'MODERN', slots: team.slots }, [seat], { durable: true, structured: true }, true)).toContain('Fresh session per unit');
    expect(seatLaunchProblem(team, [seat], { durable: true, structured: true }, false)).toContain('turn it off for: Engineer');
    expect(seatLaunchProblem({ slots: [{ startOnDemand: true }] }, [seat], { durable: false, structured: false }, true)).toContain('Start on demand');
    expect(seatLaunchProblem({ slots: [{}] }, [seat], { durable: false, structured: false }, false)).toBeUndefined();
  });
});

describe('seat approvals and the starter', () => {
  const binding = { consumerKind: 'team-slot' as const, slotId: 's1', initialTaskDigest: 'd', scope: 'local' as const, storeRevision: 'r', projectIdentityDigest: 'p', autonomous: true, expiresAt: 1 };
  const approval = { principal: { kind: 'team', id: 't' }, projectId: 'p1', binding };

  it('remembers only wanted team-slot approvals', () => {
    const approvals = createSeatApprovals(new Set(['s1']));
    approvals.remember('s1', approval);
    approvals.remember('s2', approval);
    approvals.remember('s1', undefined);
    expect(approvals.expectedFor('s1')).toEqual({ principal: { kind: 'team', id: 't' }, projectId: 'p1', binding });
    expect(approvals.expectedFor('s2')).toBeUndefined();
    const other = createSeatApprovals(new Set(['s1']));
    other.remember('s1', { ...approval, binding: { ...binding, consumerKind: 'terminal' as never } });
    other.remember('s1', { ...approval, principal: { kind: 'user', id: 'u' } });
    expect(other.expectedFor('s1')).toBeUndefined();
  });

  it('respawnApproval says why when it cannot mint', () => {
    const service = { authorizeRespawn: vi.fn(() => ({ ok: true as const, authorization: { id: 'new' } })) };
    const expected = { principal: { kind: 'team' as const, id: 't' }, projectId: 'p1', binding };
    expect(respawnApproval(service, 'prior', expected)).toEqual({ ok: true, id: 'new' });
    expect(service.authorizeRespawn).toHaveBeenCalledWith('prior', expected);
    expect(respawnApproval(service, undefined, expected)).toMatchObject({ ok: false });
    expect(respawnApproval(service, 'prior', undefined)).toMatchObject({ ok: false });
    expect(respawnApproval({ authorizeRespawn: () => ({ ok: false, reason: 'cap' }) }, 'prior', expected)).toEqual({ ok: false, message: 'cap' });
  });

  it('starts a first session as a late seat and a later one under a minted respawn approval', async () => {
    const start = vi.fn(async (_slot: string, _approval?: string) => ({ ok: true as const, value: { id: 's' } }));
    let started = false;
    const starter = createSeatStarter({ hasStarted: async () => started, mintApproval: async () => ({ ok: true, id: 'resp-1' }), start });
    await starter('s1');
    expect(start).toHaveBeenLastCalledWith('s1');
    started = true;
    await starter('s1');
    expect(start).toHaveBeenLastCalledWith('s1', 'resp-1');
  });

  it('refuses a start whose respawn approval cannot be minted, without spawning', async () => {
    const start = vi.fn();
    const starter = createSeatStarter({ hasStarted: async () => true, mintApproval: async () => ({ ok: false, message: 'binding mismatch' }), start });
    await expect(starter('s1')).resolves.toEqual({ ok: false, code: 'DENIED', message: 'binding mismatch' });
    expect(start).not.toHaveBeenCalled();
  });

  it('lifecycleRecycleOps reads the seat and keeps the record tracked after a detach or a delivery', async () => {
    const record = { workers: [{ slotId: 's1', sessionId: 'old', authorizationId: 'a', deliveredUnitCount: 1 }, { slotId: 's2', authorizationId: 'b' }] };
    const track = vi.fn();
    const lifecycle = {
      get: async () => record,
      detachWorkerForRecycle: vi.fn(async (_r: string, slot: string) => (slot === 's1' ? { record } : undefined)),
      recordUnitDelivered: vi.fn(async (_r: string, slot: string) => (slot === 's1' ? record : undefined))
    };
    const ops = lifecycleRecycleOps(lifecycle, track);
    expect(await ops.sessionOf('r', 's1')).toBe('old');
    expect(await ops.priorApprovalOf('r', 's1')).toBe('a');
    expect(await ops.hadSession('r', 's1')).toBe(true);
    expect(await ops.hadSession('r', 's2')).toBe(false);
    expect(await ops.detach('r', 's1')).toBe(true);
    expect(await ops.detach('r', 's2')).toBe(false);
    await ops.recordDelivered('r', 's1');
    await ops.recordDelivered('r', 's2');
    expect(track).toHaveBeenCalledTimes(2);
  });
});
