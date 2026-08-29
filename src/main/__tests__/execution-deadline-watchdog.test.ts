import { describe, expect, it, vi } from 'vitest';
import { ExecutionDeadlineWatchdog } from '../execution/deadline-watchdog.js';
import type { ExecutionRecord } from '../execution/store.js';

function record(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'execution-1', callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1',
    jobTitle: 'Job', requestDigest: 'digest', launchRequestId: 'request-1', teamLaunchRequestId: 'request-1',
    request: { version: 1, launchKind: 'team', slots: [{ initialTask: 'work' }], resolvedModels: [], policy: { deadlineMs: 100 } },
    attempt: 1, state: 'RUNNING', stateVersion: 1, resolvedModels: [], createdAt: 1_000, updatedAt: 1_000,
    ...over
  };
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

describe('ExecutionDeadlineWatchdog', () => {
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
