import { describe, it, expect, vi } from 'vitest';
import {
  AutonomousRunSupervisor,
  AUTONOMOUS_DEFAULTS,
  type AutonomousRunSupervisorDeps
} from './autonomous-run-supervisor.js';

/** Controllable fake clock over the injected setTimer/clearTimer (mirrors heartbeat.test). */
function makeClock() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimer: vi.fn((fn: () => void) => {
      const id = nextId++;
      pending.set(id, fn);
      return id as unknown as NodeJS.Timeout;
    }),
    clearTimer: vi.fn((h: NodeJS.Timeout) => pending.delete(h as unknown as number)),
    fireNext() {
      const ids = [...pending.keys()];
      if (ids.length === 0) throw new Error('no pending timer');
      const id = ids[ids.length - 1];
      const fn = pending.get(id)!;
      pending.delete(id);
      fn();
    },
    fireAll() {
      for (const [id, fn] of [...pending.entries()]) {
        pending.delete(id);
        fn();
      }
    },
    pendingCount: () => pending.size
  };
}

function makeDeps(over: Partial<AutonomousRunSupervisorDeps> = {}) {
  const clock = makeClock();
  const reply = vi.fn(() => true);
  const closeSession = vi.fn(() => true);
  const pushInbox = vi.fn();
  const now = vi.fn(() => 1_000);
  const deps: AutonomousRunSupervisorDeps = {
    reply,
    closeSession,
    pushInbox,
    nudgeDelaySeconds: () => AUTONOMOUS_DEFAULTS.nudgeDelaySeconds,
    now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...over
  };
  return { deps, clock, reply, closeSession, pushInbox, now };
}

const START = {
  runId: 'r1',
  teamId: 'squad',
  projectId: 'p1',
  goal: 'Ship feature X',
  orchestratorSessionId: 'orch',
  workerSessionIds: ['w1', 'w2'],
  limits: { maxRounds: 3, timeoutMs: 0 }
};

describe('AutonomousRunSupervisor', () => {
  it('nudges an idle worker with goal-aware text after the delay', () => {
    const { deps, clock, reply } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    svc.observe('w1', 'idle');
    expect(clock.setTimer).toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();

    clock.fireNext();
    expect(reply).toHaveBeenCalledTimes(1);
    const [sid, text] = reply.mock.calls[0] as unknown as [string, string];
    expect(sid).toBe('w1');
    expect(text).toContain('Ship feature X');
  });

  it('never nudges a blocked agent', () => {
    const { deps, clock, reply } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);
    svc.observe('orch', 'blocked');
    expect(clock.pendingCount()).toBe(0);
    expect(reply).not.toHaveBeenCalled();
  });

  it('stops the run with max-rounds after the nudge cap and closes workers', () => {
    const { deps, clock, reply, closeSession } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    svc.observe('w1', 'idle');
    clock.fireNext(); // nudge 1
    clock.fireNext(); // nudge 2
    clock.fireNext(); // nudge 3
    expect(reply).toHaveBeenCalledTimes(3);
    clock.fireNext(); // cap tripped → stop

    const run = svc.list()[0];
    expect(run.state).toBe('stopped');
    expect(run.stopReason).toBe('max-rounds');
    expect(closeSession).toHaveBeenCalledWith('w1');
    expect(closeSession).toHaveBeenCalledWith('w2');
    expect(closeSession).toHaveBeenCalledWith('orch');
  });

  it('complete() records the summary, closes workers, keeps the orchestrator tab open', () => {
    const { deps, closeSession, pushInbox } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    const run = svc.complete('orch', 'Shipped X: did A, B, C. Tests green.');
    expect(run?.state).toBe('completed');
    expect(run?.stopReason).toBe('goal-reached');
    expect(run?.summary).toBe('Shipped X: did A, B, C. Tests green.');
    // Workers torn down; orchestrator deliberately LEFT OPEN.
    expect(closeSession).toHaveBeenCalledWith('w1');
    expect(closeSession).toHaveBeenCalledWith('w2');
    expect(closeSession).not.toHaveBeenCalledWith('orch');
    // One consolidated inbox overview, carrying the summary.
    expect(pushInbox).toHaveBeenCalledTimes(1);
    expect(pushInbox.mock.calls[0][0].comments).toContain('Shipped X');
    expect(pushInbox.mock.calls[0][0].comments).toContain('goal reached');
  });

  it('complete() returns null for a non-orchestrator or unknown session', () => {
    const { deps } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);
    expect(svc.complete('w1', 'nope')).toBeNull(); // a worker can't complete the run
    expect(svc.complete('ghost', 'nope')).toBeNull();
  });

  it('treats an orchestrator pty exit (without complete) as orchestrator-gone failure', () => {
    const { deps, closeSession } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    svc.onSessionExit('orch');
    const run = svc.list()[0];
    expect(run.state).toBe('failed');
    expect(run.stopReason).toBe('orchestrator-gone');
    // Workers still torn down; orchestrator already gone so not re-closed.
    expect(closeSession).toHaveBeenCalledWith('w1');
    expect(closeSession).toHaveBeenCalledWith('w2');
    expect(closeSession).not.toHaveBeenCalledWith('orch');
  });

  it('manual stop tears down all sessions and notifies', () => {
    const { deps, closeSession, pushInbox } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    const run = svc.stop('r1', 'manual');
    expect(run?.state).toBe('stopped');
    expect(run?.stopReason).toBe('manual');
    expect(closeSession).toHaveBeenCalledWith('orch');
    expect(pushInbox).toHaveBeenCalledTimes(1);
  });

  it('stops with timeout when the wall-clock budget elapses', () => {
    const { deps, clock, closeSession } = makeDeps({ now: () => 1_000 });
    const svc = new AutonomousRunSupervisor(deps);
    svc.start({ ...START, limits: { maxRounds: 0, timeoutMs: 60_000 } });
    clock.fireAll();
    const run = svc.list()[0];
    expect(run.state).toBe('stopped');
    expect(run.stopReason).toBe('timeout');
    expect(closeSession).toHaveBeenCalledWith('orch');
  });

  it('getByOrchestrator finds a running run and ignores ended ones', () => {
    const { deps } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);
    expect(svc.getByOrchestrator('orch')?.runId).toBe('r1');
    svc.stop('r1', 'manual');
    expect(svc.getByOrchestrator('orch')).toBeNull();
  });

  it('REGRESSION: timeout should NOT kill an active run showing progress', () => {
    // Bug: the UMI research run was killed at 30min even though agents were
    // actively working. The timeout is a fixed wall-clock timer that doesn't
    // distinguish between idle/stalled and actively progressing runs.
    //
    // Expected: if agents show activity (state transitions working→idle, or
    // blocked→idle, or any non-idle state), the run is making progress and
    // should NOT be killed by timeout. Only a truly stalled run (no state
    // changes, agents stuck) should time out.
    const { deps, clock } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);

    // Start with a 60s timeout
    svc.start({ ...START, limits: { maxRounds: 0, timeoutMs: 60_000 } });
    const initialTimerCount = clock.setTimer.mock.calls.length; // 1 (the timeout)

    // Agent shows activity (working state)
    svc.observe('w1', 'working');
    // The timeout should have been cleared and re-armed
    expect(clock.clearTimer).toHaveBeenCalledTimes(1);
    expect(clock.setTimer.mock.calls.length).toBe(initialTimerCount + 1);

    // Fire the ORIGINAL timeout (the one set at start, which was cleared)
    // This should do nothing since it was cleared
    const firstTimeoutHandle = clock.setTimer.mock.calls[0][0] as unknown as NodeJS.Timeout;
    // The cleared timer shouldn't be in pending anymore
    expect(clock.pendingCount()).toBe(1); // only the NEW timeout

    // The run is still alive
    const run = svc.list()[0];
    expect(run.state).toBe('running');
    expect(run.stopReason).toBeUndefined();
  });

  it('timeout DOES kill a truly idle run with no activity', () => {
    // Complementary test: ensure the watchdog isn't neutered. A run that
    // starts but shows NO state transitions (agents stuck, no progress) should
    // still be killed at timeout.
    let time = 1_000;
    const { deps, clock, closeSession } = makeDeps({ now: () => time });
    const svc = new AutonomousRunSupervisor(deps);

    svc.start({ ...START, limits: { maxRounds: 0, timeoutMs: 60_000 } });

    // NO observe() calls — agents never report state, no activity signal.
    time += 70_000;
    clock.fireAll();

    const run = svc.list()[0];
    expect(run.state).toBe('stopped');
    expect(run.stopReason).toBe('timeout');
    expect(closeSession).toHaveBeenCalledWith('orch');
  });

  it('timeoutMs = 0 disables timeout entirely (runs indefinitely)', () => {
    // USER FIX: setting timeoutMs to 0 should prevent ANY timeout.
    const { deps, clock } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);

    // Start with timeout disabled
    svc.start({ ...START, limits: { maxRounds: 0, timeoutMs: 0 } });

    // No timeout timer should be armed (only set at start, none for timeout)
    expect(clock.setTimer).not.toHaveBeenCalled();

    // The run stays alive forever (no timeout will fire)
    const run = svc.list()[0];
    expect(run.state).toBe('running');
    expect(run.limits.timeoutMs).toBe(0);
  });

  it('multiple activity bursts keep resetting the timeout (watchdog pattern)', () => {
    // Real-world scenario: a long research run with periodic activity should
    // NEVER time out as long as agents keep making progress.
    const { deps, clock, closeSession } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);

    svc.start({ ...START, limits: { maxRounds: 0, timeoutMs: 100_000 } });
    const initialClearCount = clock.clearTimer.mock.calls.length;

    // Burst 1: agent goes working → timeout reset
    svc.observe('w1', 'working');
    expect(clock.clearTimer.mock.calls.length).toBeGreaterThan(initialClearCount);

    // Burst 2: agent goes blocked → timeout reset again
    svc.observe('w2', 'blocked');
    expect(clock.clearTimer.mock.calls.length).toBeGreaterThan(initialClearCount + 1);

    // Burst 3: agent goes idle then back to working
    // idle arms a nudge timer, working clears it AND resets timeout
    svc.observe('w1', 'idle');
    svc.observe('w1', 'working');
    // Each non-idle state should have triggered a timeout reset
    expect(clock.clearTimer.mock.calls.length).toBeGreaterThan(initialClearCount + 2);

    // Only 1 timer pending now (the last reset timeout)
    expect(clock.pendingCount()).toBe(1);

    // Fire it — this is the legitimate timeout from the last reset
    // Since we're not showing more activity, this one will kill the run
    clock.fireAll();

    const run = svc.list()[0];
    // Actually, with no more activity the timeout SHOULD fire
    expect(run.state).toBe('stopped');
    expect(run.stopReason).toBe('timeout');
    expect(closeSession).toHaveBeenCalled();
  });

  it('successful nudge is not inactivity progress (does not reset the timeout)', () => {
    const { deps, clock, reply } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);

    svc.start({ ...START, limits: { maxRounds: 5, timeoutMs: 100_000 } });
    const initialSetCount = clock.setTimer.mock.calls.length; // 1 (initial timeout)

    // Agent goes idle → nudge timer armed
    svc.observe('w1', 'idle');
    clock.fireNext(); // fire the nudge timer

    // Nudge delivered → timeout should NOT have been reset
    expect(reply).toHaveBeenCalledTimes(1);
    expect(clock.clearTimer).not.toHaveBeenCalled(); // timeout was NOT cleared
    expect(clock.setTimer.mock.calls.length).toBe(initialSetCount + 2);

    const run = svc.list()[0];
    expect(run.state).toBe('running');
    expect(run.rounds).toBe(1);
  });

  it('REGRESSION GUARD: fixed 30min/45min timeout cannot silently return', () => {
    // This test exists to catch if someone accidentally reverts the watchdog
    // behavior back to a fixed timer. The timeout MUST reset on activity.
    const { deps, clock } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);

    // Start with a very short timeout for test speed
    svc.start({ ...START, limits: { maxRounds: 0, timeoutMs: 10_000 } });
    const initialClearCount = clock.clearTimer.mock.calls.length;

    // Simulate a long-running research task with periodic progress.
    // Key: alternate states to trigger resets (same→same is a no-op).
    for (let i = 0; i < 5; i++) {
      svc.observe('w1', 'working');
      svc.observe('w1', 'idle');
      // Each state TRANSITION resets the timeout (working is non-idle).
      // idle→working and working→idle both count as transitions.
    }

    // After 5 working transitions, we should have 5 timeout resets.
    // (idle doesn't reset, but the prior working→idle transition does)
    expect(clock.clearTimer.mock.calls.length).toBeGreaterThanOrEqual(initialClearCount + 5);

    // Only 1-2 timers pending now (last timeout + maybe a nudge from final idle)
    expect(clock.pendingCount()).toBeGreaterThanOrEqual(1);

    // The key assertion: the timeout WAS reset on each activity burst.
    // If the bug returned (fixed wall-clock timer), clearTimer would not have
    // been called multiple times — the original timer would just fire.
    expect(clock.clearTimer.mock.calls.length).toBeGreaterThan(initialClearCount);

    // Fire all pending timers (timeout + any nudge)
    clock.fireAll();

    const run = svc.list()[0];
    // The run times out now since there's no more activity, but the test
    // proved the watchdog works: it was reset multiple times during the loop.
    expect(run.state).toBe('stopped');
    expect(run.stopReason).toBe('timeout');
  });

  it('timeout is respected even when timeoutMs is very large', () => {
    // Edge case: ensure huge timeoutMs values work (e.g., 24 hours).
    const { deps, clock, closeSession } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);

    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    svc.start({ ...START, limits: { maxRounds: 0, timeoutMs: TWENTY_FOUR_HOURS } });

    // No activity → timeout should eventually fire
    clock.fireAll();

    const run = svc.list()[0];
    expect(run.state).toBe('stopped');
    expect(run.stopReason).toBe('timeout');
    expect(closeSession).toHaveBeenCalled();
  });
});
