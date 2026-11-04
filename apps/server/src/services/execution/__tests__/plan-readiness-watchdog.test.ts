import { describe, expect, it, vi } from 'vitest';
import { PlanReadinessWatchdog } from '../plan-readiness-watchdog.js';
import type { ExecutionRecord } from '../store.js';

function record(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'execution-1', callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1',
    jobTitle: 'Job', requestDigest: 'digest', launchRequestId: 'request-1', teamLaunchRequestId: 'request-1',
    request: { version: 1, launchKind: 'team', slots: [{ initialTask: 'work' }], resolvedModels: [], policy: {} },
    attempt: 1, attemptStartedAt: 1_000, state: 'RUNNING', stateVersion: 1, resolvedModels: [], createdAt: 1_000, updatedAt: 1_000,
    coordinationMode: 'structured',
    ...over
  } as ExecutionRecord;
}

function fixture(now = 1_000, grace = 5_000, suspension?: {
  isSuspended: (executionId: string) => boolean | Promise<boolean>;
  suspendPollMs?: number;
  suspensionCapMs?: number;
}) {
  let clock = now;
  let graceValue = grace;
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const setTimer = vi.fn((fn: () => void, ms: number) => {
    const id = nextId++;
    pending.set(id, { fn, ms });
    return id as unknown as NodeJS.Timeout;
  });
  const clearTimer = vi.fn((timer: NodeJS.Timeout) => pending.delete(timer as unknown as number));
  const onGraceExpired = vi.fn(async () => {});
  const watchdog = new PlanReadinessWatchdog({
    now: () => clock,
    setTimer,
    clearTimer,
    graceMs: () => graceValue,
    onGraceExpired,
    ...(suspension ?? {})
  });
  return {
    watchdog, setTimer, clearTimer, onGraceExpired, pending,
    setNow(value: number) { clock = value; },
    setGrace(value: number) { graceValue = value; },
    fireNext() {
      const [id, timer] = pending.entries().next().value!;
      pending.delete(id);
      timer.fn();
    }
  };
}

describe('PlanReadinessWatchdog', () => {
  it('arms a timer for a durable, planless, non-terminal execution and fires onGraceExpired after grace', async () => {
    const f = fixture(1_000, 5_000);
    f.watchdog.schedule(record());
    expect(f.setTimer).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(1);
    f.setNow(6_000);
    f.fireNext();
    await Promise.resolve();
    expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1');
  });

  it('does not arm when work units are already present (plan-provided fast path)', () => {
    const f = fixture();
    f.watchdog.schedule(record({ workUnits: [{ id: 'wu-1' } as never] }));
    expect(f.setTimer).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(0);
  });

  it('does not arm when graceMs is 0 (disabled)', () => {
    const f = fixture(1_000, 0);
    f.watchdog.schedule(record());
    expect(f.setTimer).not.toHaveBeenCalled();
  });

  it('does not arm for a non-durable coordinationMode', () => {
    const f = fixture();
    f.watchdog.schedule(record({ coordinationMode: 'interactive-team' }));
    expect(f.setTimer).not.toHaveBeenCalled();
  });

  it('does not arm for a terminal state', () => {
    const f = fixture();
    for (const state of ['COMPLETED', 'FAILED', 'STOPPED'] as const) {
      f.watchdog.schedule(record({ id: `execution-${state}`, state }));
    }
    expect(f.setTimer).not.toHaveBeenCalled();
  });

  it('remove() cancels the pending timer so onGraceExpired never fires', async () => {
    const f = fixture(1_000, 5_000);
    f.watchdog.schedule(record());
    expect(f.pending.size).toBe(1);
    f.watchdog.remove('execution-1');
    expect(f.clearTimer).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(0);
    await Promise.resolve();
    expect(f.onGraceExpired).not.toHaveBeenCalled();
  });

  it('scheduling the same id twice replaces the timer (fires only once)', async () => {
    const f = fixture(1_000, 5_000);
    f.watchdog.schedule(record());
    f.watchdog.schedule(record({ stateVersion: 2 }));
    expect(f.setTimer).toHaveBeenCalledTimes(2);
    expect(f.clearTimer).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(1);
    f.setNow(6_000);
    f.fireNext();
    await Promise.resolve();
    expect(f.onGraceExpired).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(0);
  });

  it('restore() arms each planless durable record', () => {
    const f = fixture(1_000, 5_000);
    f.watchdog.restore([
      record({ id: 'execution-a' }),
      record({ id: 'execution-b', workUnits: [{ id: 'wu-1' } as never] }),
      record({ id: 'execution-c', state: 'COMPLETED' })
    ]);
    expect(f.setTimer).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(1);
  });

  it('dispose() clears all timers and schedule() becomes a no-op afterward', async () => {
    const f = fixture(1_000, 5_000);
    f.watchdog.schedule(record({ id: 'execution-a' }));
    f.watchdog.schedule(record({ id: 'execution-b' }));
    expect(f.pending.size).toBe(2);
    f.watchdog.dispose();
    expect(f.pending.size).toBe(0);
    expect(f.clearTimer).toHaveBeenCalledTimes(2);

    f.watchdog.schedule(record({ id: 'execution-c' }));
    expect(f.pending.size).toBe(0);
    expect(f.setTimer).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(f.onGraceExpired).not.toHaveBeenCalled();
  });

  it('deadline is anchored to attemptStartedAt + grace, not to now() at schedule time', async () => {
    const f = fixture(50_000, 5_000);
    f.watchdog.schedule(record({ createdAt: 1_000, attemptStartedAt: 45_000 }));
    // deadline = 45_000 + 5_000 = 50_000, exactly now → fires immediately (delay 0)
    expect(f.setTimer).toHaveBeenCalledWith(expect.any(Function), 0);
    f.fireNext();
    await Promise.resolve();
    expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1');
  });

  it('gives a resumed attempt its own grace after the original grace elapsed', () => {
    const f = fixture(50_000, 5_000);
    f.watchdog.schedule(record({ createdAt: 1_000, attemptStartedAt: 50_000, attempt: 2 }));
    // The execution is old, but this launch attempt is fresh.
    expect(f.setTimer).toHaveBeenCalledWith(expect.any(Function), 5_000);
  });

  it('re-arms a still-pending timer instead of firing early when now() has not reached the deadline yet', async () => {
    const f = fixture(1_000, 5_000);
    f.watchdog.schedule(record());
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 5_000);
    // fire the timer early (simulating a shorter re-arm cycle) while now() is still before the deadline
    f.setNow(3_000);
    f.fireNext();
    expect(f.onGraceExpired).not.toHaveBeenCalled();
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 3_000);
    expect(f.pending.size).toBe(1);

    f.setNow(6_000);
    f.fireNext();
    await Promise.resolve();
    expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1');
  });

  it('retries failed grace-expiry cleanup with one bounded timer, then succeeds', async () => {
    const f = fixture(1_000, 5_000);
    f.onGraceExpired
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValueOnce(undefined);
    f.watchdog.schedule(record());

    f.setNow(6_000);
    f.fireNext();
    await vi.waitFor(() => expect(f.onGraceExpired).toHaveBeenCalledTimes(1));
    expect(f.pending.size).toBe(1);

    f.fireNext();
    await vi.waitFor(() => expect(f.onGraceExpired).toHaveBeenCalledTimes(2));
    expect(f.pending.size).toBe(0);
  });

  it('gives up after MAX_ATTEMPTS retries and logs, without an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fixture(1_000, 5_000);
    f.onGraceExpired.mockRejectedValue(new Error('always fails'));
    f.watchdog.schedule(record());

    f.setNow(6_000);
    f.fireNext();
    await vi.waitFor(() => expect(f.onGraceExpired).toHaveBeenCalledTimes(1));
    f.fireNext();
    await vi.waitFor(() => expect(f.onGraceExpired).toHaveBeenCalledTimes(2));
    f.fireNext();
    await vi.waitFor(() => expect(f.onGraceExpired).toHaveBeenCalledTimes(3));

    expect(f.pending.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('planless cleanup failed for execution-1'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

describe('PlanReadinessWatchdog suspension (pending plan-correction decision)', () => {
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('suspends instead of failing while the decision is open, polling at the poll interval', async () => {
    const isSuspended = vi.fn(async () => true);
    const f = fixture(1_000, 5_000, { isSuspended, suspendPollMs: 1_000, suspensionCapMs: 100_000 });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    await settle();
    expect(isSuspended).toHaveBeenCalledWith('execution-1');
    expect(f.onGraceExpired).not.toHaveBeenCalled();
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 1_000);
    expect(f.pending.size).toBe(1);

    // Still open on the next poll: keeps suspending.
    f.setNow(7_000);
    f.fireNext();
    await settle();
    expect(f.onGraceExpired).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(1);
  });

  it('gives a fresh full grace from resolution time once the decision closes, then fails', async () => {
    let open = true;
    const f = fixture(1_000, 5_000, { isSuspended: () => open, suspendPollMs: 1_000, suspensionCapMs: 100_000 });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    await settle();
    expect(f.pending.size).toBe(1);

    // Human resolved 20s later (well past the original deadline).
    open = false;
    f.setNow(26_000);
    f.fireNext();
    await settle();
    expect(f.onGraceExpired).not.toHaveBeenCalled();
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 5_000);

    f.setNow(31_000);
    f.fireNext();
    await settle();
    expect(f.onGraceExpired).toHaveBeenCalledTimes(1);
    expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1');
  });

  it('stops after resolution when grace was disabled meanwhile', async () => {
    let open = true;
    const f = fixture(1_000, 5_000, { isSuspended: () => open, suspendPollMs: 1_000, suspensionCapMs: 100_000 });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    await settle();
    open = false;
    f.setGrace(0);
    f.fireNext();
    await settle();
    expect(f.pending.size).toBe(0);
    expect(f.onGraceExpired).not.toHaveBeenCalled();
  });

  it('fails with the suspension-cap reason once the absolute cap elapses while still open', async () => {
    const f = fixture(1_000, 5_000, { isSuspended: async () => true, suspendPollMs: 10_000, suspensionCapMs: 20_000 });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    await settle();
    // Poll delay is clipped to the remaining cap (cap at 21_000).
    f.setNow(16_000);
    f.fireNext();
    await settle();
    expect(f.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 5_000);
    f.setNow(21_000);
    f.fireNext();
    await settle();
    expect(f.onGraceExpired).toHaveBeenCalledTimes(1);
    expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1', 'suspension-cap');
  });

  it('fires the cap immediately at grace expiry when the cap already elapsed (e.g. after restart)', async () => {
    const f = fixture(1_000, 5_000, { isSuspended: () => true, suspensionCapMs: 3_000 });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    await settle();
    expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1', 'suspension-cap');
  });

  it('retries a failed cap cleanup keeping the cap reason', async () => {
    const f = fixture(1_000, 5_000, { isSuspended: () => true, suspensionCapMs: 3_000 });
    f.onGraceExpired.mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValueOnce(undefined);
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    await vi.waitFor(() => expect(f.onGraceExpired).toHaveBeenCalledTimes(1));
    f.fireNext();
    await vi.waitFor(() => expect(f.onGraceExpired).toHaveBeenCalledTimes(2));
    expect(f.onGraceExpired).toHaveBeenLastCalledWith('execution-1', 'suspension-cap');
  });

  it('treats a throwing or rejecting predicate as not open (original deadline applies)', async () => {
    for (const isSuspended of [
      () => { throw new Error('store corrupt'); },
      async () => { throw new Error('store corrupt'); }
    ]) {
      const f = fixture(1_000, 5_000, { isSuspended });
      f.watchdog.schedule(record());
      f.setNow(6_000);
      f.fireNext();
      await settle();
      expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1');
    }
  });

  it('treats a non-true predicate answer as not open', async () => {
    const f = fixture(1_000, 5_000, { isSuspended: () => 'yes' as unknown as boolean });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    await settle();
    expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1');
  });

  it('fails at the original deadline when no decision is open', async () => {
    const f = fixture(1_000, 5_000, { isSuspended: () => false });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    await settle();
    expect(f.onGraceExpired).toHaveBeenCalledWith('execution-1');
  });

  it('drops a stale suspension check when the run was removed or rescheduled meanwhile', async () => {
    let release!: (open: boolean) => void;
    const f = fixture(1_000, 5_000, { isSuspended: () => new Promise<boolean>((resolve) => { release = resolve; }) });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    f.watchdog.remove('execution-1');
    release(false);
    await settle();
    expect(f.onGraceExpired).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(0);
  });

  it('drops a pending suspension check after dispose and on a disposed poll', async () => {
    let release!: (open: boolean) => void;
    const f = fixture(1_000, 5_000, { isSuspended: () => new Promise<boolean>((resolve) => { release = resolve; }), suspendPollMs: 1_000 });
    f.watchdog.schedule(record());
    f.setNow(6_000);
    f.fireNext();
    release(true);
    await settle();
    expect(f.pending.size).toBe(1);
    const [, poll] = f.pending.entries().next().value!;
    f.watchdog.dispose();
    poll.fn();
    await settle();
    expect(f.onGraceExpired).not.toHaveBeenCalled();
  });
});
