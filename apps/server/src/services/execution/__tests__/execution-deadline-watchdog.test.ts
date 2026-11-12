import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLOCKED_WAIT_MS, MAX_BLOCKED_WAIT_MS, effectiveBlockedWaitMs, ExecutionDeadlineWatchdog, deadlineTimings, executionProgressAnchor, nextDeadlineAt, planDeadline } from '../deadline-watchdog.js';
import type { ExecutionRecord } from '../store.js';

const units = (progressAts: Array<number | undefined>): ExecutionRecord['workUnits'] =>
  progressAts.map((progressAt) => (progressAt === undefined ? {} : { progressAt })) as unknown as ExecutionRecord['workUnits'];

function record(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'execution-1', callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1',
    jobTitle: 'Job', requestDigest: 'digest', launchRequestId: 'request-1', teamLaunchRequestId: 'request-1',
    request: { version: 1, launchKind: 'team', slots: [{ initialTask: 'work' }], resolvedModels: [], policy: { deadlineMs: 100 } },
    attempt: 1, attemptStartedAt: 1_000, state: 'RUNNING', stateVersion: 1, resolvedModels: [], createdAt: 1_000, updatedAt: 1_000,
    ...over
  } as ExecutionRecord;
}

function fixture(now = 1_000) {
  let clock = now;
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const setTimer = vi.fn((fn: () => void, ms: number) => {
    const id = nextId++;
    pending.set(id, { fn, ms });
    return id as unknown as NodeJS.Timeout;
  });
  const clearTimer = vi.fn((timer: NodeJS.Timeout) => pending.delete(timer as unknown as number));
  const onDeadline = vi.fn(async () => {});
  const watchdog = new ExecutionDeadlineWatchdog({ now: () => clock, setTimer, clearTimer, onDeadline });
  return {
    watchdog, setTimer, clearTimer, onDeadline, pending,
    setNow(value: number) { clock = value; },
    fireNext() {
      const [id, timer] = pending.entries().next().value!;
      pending.delete(id);
      timer.fn();
    }
  };
}

describe('executionProgressAnchor', () => {
  it('falls back to attemptStartedAt when the run has no work units (freeform / pre-plan)', () => {
    expect(executionProgressAnchor(record())).toBe(1_000);
    expect(executionProgressAnchor(record({ workUnits: [] }))).toBe(1_000);
  });

  it('anchors on the most recent unit progressAt — a progressing run resets the idle clock', () => {
    // The idle deadline is measured from here, so the latest genuine progress wins.
    expect(executionProgressAnchor(record({ workUnits: units([1_500, 2_400, 900]) }))).toBe(2_400);
  });

  it('ignores units with no progressAt and never drops below attemptStartedAt', () => {
    // An unclaimed unit (no progressAt) and a stale progressAt below createdAt must
    // not pull the anchor backwards — the floor is always the current attempt start.
    expect(executionProgressAnchor(record({ createdAt: 1_000, attemptStartedAt: 5_000, workUnits: units([undefined, 1_200]) }))).toBe(5_000);
  });
});

describe('ExecutionDeadlineWatchdog', () => {
  it('arms from the last progress anchor, not createdAt (idle deadline)', () => {
    // createdAt 1_000, a unit last progressed at 1_050, deadlineMs 100 → fire at
    // 1_150 (delay 150), NOT at 1_100. This is what keeps a healthy, progressing
    // run alive past a fixed total-runtime cap.
    const f = fixture();
    f.watchdog.schedule(record({ workUnits: units([1_050]) }));
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 150);
  });

  it('keeps one timer per execution and replaces it when rescheduled', () => {
    const f = fixture();
    f.watchdog.schedule(record());
    f.watchdog.schedule(record({ stateVersion: 2 }));
    expect(f.setTimer).toHaveBeenCalledTimes(2);
    expect(f.clearTimer).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(1);
  });

  it('fires promptly for a restored overdue active execution', async () => {
    const f = fixture(1_101);
    f.watchdog.restore([record()]);
    expect(f.setTimer).toHaveBeenCalledWith(expect.any(Function), 0);
    f.fireNext();
    await Promise.resolve();
    expect(f.onDeadline).toHaveBeenCalledWith('execution-1');
  });

  it('clears timers when execution becomes terminal or service disposes', () => {
    const f = fixture();
    f.watchdog.schedule(record());
    f.watchdog.schedule(record({ state: 'COMPLETED' }));
    expect(f.pending.size).toBe(0);
    f.watchdog.schedule(record({ id: 'execution-2' }));
    f.watchdog.dispose();
    expect(f.pending.size).toBe(0);
    expect(f.clearTimer).toHaveBeenCalledTimes(2);
  });

  it('re-arms long deadlines until absolute createdAt deadline arrives', () => {
    const f = fixture();
    const long = 2_147_483_647 + 10;
    f.watchdog.schedule(record({ request: { ...record().request, policy: { deadlineMs: long } } }));
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 2_147_483_647);
    f.setNow(1_000 + 2_147_483_647);
    f.fireNext();
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 10);
    expect(f.onDeadline).not.toHaveBeenCalled();
  });

  it('retries failed deadline cleanup with one bounded timer', async () => {
    const f = fixture(1_101);
    f.onDeadline
      .mockRejectedValueOnce(new Error('cancel transport failed'))
      .mockResolvedValueOnce(undefined);
    f.watchdog.schedule(record());

    f.fireNext();
    await vi.waitFor(() => expect(f.onDeadline).toHaveBeenCalledTimes(1));
    expect(f.pending.size).toBe(1);

    f.fireNext();
    await vi.waitFor(() => expect(f.onDeadline).toHaveBeenCalledTimes(2));
    expect(f.pending.size).toBe(0);
  });
});

describe('planDeadline and nextDeadlineAt', () => {
  const blocker = (over: Partial<NonNullable<ExecutionRecord['blockers']>[number]> = {}) =>
    ({ id: 'b', workUnitId: 'u', slotId: 's', question: 'q', resolved: false, createdAt: 2_000, ...over });
  const timings = { deadlineMs: 100, blockedWaitMs: 1_000 };

  it('plans the idle deadline from the progress anchor when no human blocker is open', () => {
    expect(planDeadline(record(), timings, 1_000)).toEqual({ phase: 'idle', at: 1_100 });
    expect(planDeadline(record({ blockers: [blocker({ resolved: true })] }), timings, 1_000)).toEqual({ phase: 'idle', at: 1_100 });
    expect(planDeadline(record({ blockers: [blocker({ audience: 'coordinator' })] }), timings, 1_000)).toEqual({ phase: 'idle', at: 1_100 });
  });

  it('anchors the blocked wait at the oldest open human blocker and plans warn then stop', () => {
    const r = record({ blockers: [blocker({ createdAt: 2_500 }), blocker({ id: 'older', createdAt: 2_000 })] });
    expect(planDeadline(r, timings, 2_100)).toEqual({ phase: 'blocked-warn', at: 2_750 }); // lead = min(15 min, 1_000 / 4)
    expect(planDeadline({ ...r, blockedWarnedAt: 2_750 }, timings, 2_800)).toEqual({ phase: 'blocked-stop', at: 3_000 });
    expect(planDeadline(r, timings, 3_000)).toEqual({ phase: 'blocked-stop', at: 3_000 }); // warning window missed
  });

  it('effectiveBlockedWaitMs maps 0 and over-ceiling values to 24 h and invalid values to the default', () => {
    expect(effectiveBlockedWaitMs(0)).toBe(MAX_BLOCKED_WAIT_MS);
    expect(effectiveBlockedWaitMs(99 * 3_600_000)).toBe(MAX_BLOCKED_WAIT_MS);
    expect(effectiveBlockedWaitMs(60_000)).toBe(60_000);
    for (const bad of [undefined, null, -1, Number.NaN, Infinity, '5']) expect(effectiveBlockedWaitMs(bad)).toBe(DEFAULT_BLOCKED_WAIT_MS);
  });

  it('derives timings from policy with the 4 h default and tolerates invalid values', () => {
    expect(deadlineTimings(record())).toEqual({ deadlineMs: 100, blockedWaitMs: DEFAULT_BLOCKED_WAIT_MS });
    const withPolicy = (policy: object) => record({ request: { ...record().request, policy } as never });
    expect(deadlineTimings(withPolicy({ deadlineMs: 100, blockedWaitMs: 0 }))).toEqual({ deadlineMs: 100, blockedWaitMs: MAX_BLOCKED_WAIT_MS });
    expect(deadlineTimings(withPolicy({ deadlineMs: 100, blockedWaitMs: 99 * 3_600_000 }))?.blockedWaitMs).toBe(MAX_BLOCKED_WAIT_MS);
    expect(deadlineTimings(withPolicy({ deadlineMs: 100, blockedWaitMs: -5 }))?.blockedWaitMs).toBe(DEFAULT_BLOCKED_WAIT_MS);
    expect(deadlineTimings(withPolicy({ deadlineMs: 0 }))).toBeUndefined();
    expect(deadlineTimings(withPolicy({}))).toBeUndefined();
  });

  it('nextDeadlineAt is undefined for terminal runs, and runs without a deadline', () => {
    expect(nextDeadlineAt(record({ state: 'STOPPED' }), 0)).toBeUndefined();
    expect(nextDeadlineAt(record({ request: { ...record().request, policy: {} } as never }), 0)).toBeUndefined();
    expect(nextDeadlineAt(record(), 0)).toBe(1_100);
  });
});

describe('ExecutionDeadlineWatchdog scheduling with blockers', () => {
  const stale = { id: 'b', workUnitId: 'u', slotId: 's', question: 'q', resolved: true, createdAt: 1_100 };

  it('ignores a stale-past blockerGraceUntil on a persisted record and arms from the anchor', () => {
    const f = fixture(1_050);
    f.watchdog.schedule(record({ blockerGraceUntil: 900, blockers: [stale] }));
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 50);
  });

  it('restore re-derives the arm target from blockers and arms a blockedWaitMs 0 run at the 24 h ceiling warning', () => {
    const f = fixture(1_050);
    f.watchdog.restore([
      record({ id: 'a', blockerGraceUntil: 900 }),
      record({ id: 'b', request: { ...record().request, policy: { deadlineMs: 100, blockedWaitMs: 0 } } as never, blockers: [{ ...stale, resolved: false }] })
    ]);
    expect(f.setTimer).toHaveBeenCalledTimes(2);
    // blocker created at 1_100, bound 24 h, warning 15 min earlier, now 1_050.
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 1_100 + 24 * 3_600_000 - 15 * 60_000 - 1_050);
  });

  it('floors the arm target with notBefore so a past target cannot re-arm at delay 0', () => {
    const f = fixture(5_000);
    f.watchdog.schedule(record({ blockerGraceUntil: 900 }));
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 0); // genuinely overdue: fire now
    f.watchdog.schedule(record(), 6_000);
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 1_000);
  });
});
