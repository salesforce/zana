import { describe, expect, it, vi } from 'vitest';
import { ExecutionDeadlineWatchdog, executionProgressAnchor } from '../deadline-watchdog.js';
import type { ExecutionRecord } from '../store.js';

const units = (progressAts: Array<number | undefined>): ExecutionRecord['workUnits'] =>
  progressAts.map((progressAt) => (progressAt === undefined ? {} : { progressAt })) as unknown as ExecutionRecord['workUnits'];

function record(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'execution-1', callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1',
    jobTitle: 'Job', requestDigest: 'digest', launchRequestId: 'request-1', teamLaunchRequestId: 'request-1',
    request: { version: 1, launchKind: 'team', slots: [{ initialTask: 'work' }], resolvedModels: [], policy: { deadlineMs: 100 } },
    attempt: 1, state: 'RUNNING', stateVersion: 1, resolvedModels: [], createdAt: 1_000, updatedAt: 1_000,
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
  it('falls back to createdAt when the run has no work units (freeform / pre-plan)', () => {
    expect(executionProgressAnchor(record())).toBe(1_000);
    expect(executionProgressAnchor(record({ workUnits: [] }))).toBe(1_000);
  });

  it('anchors on the most recent unit progressAt — a progressing run resets the idle clock', () => {
    // The idle deadline is measured from here, so the latest genuine progress wins.
    expect(executionProgressAnchor(record({ workUnits: units([1_500, 2_400, 900]) }))).toBe(2_400);
  });

  it('ignores units with no progressAt and never drops below createdAt', () => {
    // An unclaimed unit (no progressAt) and a stale progressAt below createdAt must
    // not pull the anchor backwards — the floor is always the launch time.
    expect(executionProgressAnchor(record({ createdAt: 5_000, workUnits: units([undefined, 1_200]) }))).toBe(5_000);
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
