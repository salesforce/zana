import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatService, type HeartbeatDeps, type HeartbeatSessionInfo } from './heartbeat.js';

/**
 * A controllable fake clock built on the injected setTimer/clearTimer. Each
 * armed timer gets an integer handle; `fireNext()` runs the most-recently
 * armed, still-pending timer (the service only ever has one armed per session
 * at a time, re-arming after each nudge). This keeps the tests deterministic
 * without vitest's global fake timers.
 */
function makeClock() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const setTimer = vi.fn((fn: () => void) => {
    const id = nextId++;
    pending.set(id, fn);
    return id as unknown as NodeJS.Timeout;
  });
  const clearTimer = vi.fn((handle: NodeJS.Timeout) => {
    pending.delete(handle as unknown as number);
  });
  return {
    setTimer,
    clearTimer,
    /** Run the latest pending timer (mirrors the single-armed-timer invariant). */
    fireNext() {
      const ids = [...pending.keys()];
      if (ids.length === 0) throw new Error('no pending timer to fire');
      const id = ids[ids.length - 1];
      const fn = pending.get(id)!;
      pending.delete(id);
      fn();
    },
    pendingCount: () => pending.size
  };
}

describe('HeartbeatService', () => {
  const baseSession: HeartbeatSessionInfo = {
    heartbeat: true,
    scheduled: false,
    headless: false,
    status: 'running',
    projectId: 'proj-1',
    title: 'My agent'
  };

  function makeDeps(over: Partial<HeartbeatDeps> = {}) {
    const clock = makeClock();
    const reply = vi.fn(() => true);
    const setHeartbeat = vi.fn();
    const pushInbox = vi.fn();
    const deps: HeartbeatDeps = {
      isEnabled: () => true,
      getSession: () => ({ ...baseSession }),
      delaySeconds: () => 30,
      maxNudges: () => 3,
      message: () => 'continue please',
      reply,
      setHeartbeat,
      pushInbox,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      ...over
    };
    return { deps, clock, reply, setHeartbeat, pushInbox };
  }

  let svc: HeartbeatService;

  it('arms a timer on entering idle and nudges when it fires', () => {
    const { deps, clock, reply } = makeDeps();
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');
    expect(clock.setTimer).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();

    clock.fireNext();
    expect(reply).toHaveBeenCalledWith('s1', 'continue please');
  });

  it('re-arms after a nudge so a still-idle agent is nudged again', () => {
    const { deps, clock, reply } = makeDeps();
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'idle');
    clock.fireNext(); // nudge 1
    expect(reply).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(1); // re-armed
    clock.fireNext(); // nudge 2
    expect(reply).toHaveBeenCalledTimes(2);
  });

  it('disarms on leaving idle (working) without nudging', () => {
    const { deps, clock, reply } = makeDeps();
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(1);
    svc.observe('s1', 'working');
    expect(clock.pendingCount()).toBe(0);
    expect(reply).not.toHaveBeenCalled();
  });

  it('armIfIdle arms an already-idle agent (toggle-on after idle, no fresh edge)', () => {
    const { deps, clock, reply } = makeDeps();
    svc = new HeartbeatService(deps);

    // Agent went idle while heartbeat was OFF (so the idle edge armed nothing —
    // simulate by observing idle with eligibility off, then enabling).
    let enabled = false;
    deps.getSession = () => ({ ...baseSession, heartbeat: enabled });
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(0); // not eligible yet → nothing armed

    // Operator flips Heartbeat ON for this already-idle agent.
    enabled = true;
    svc.armIfIdle('s1');
    expect(clock.pendingCount()).toBe(1); // armed without a new idle edge

    clock.fireNext();
    expect(reply).toHaveBeenCalledWith('s1', 'continue please');
  });

  it('armIfIdle is a no-op when the agent is not idle', () => {
    const { deps, clock } = makeDeps();
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'working');
    svc.armIfIdle('s1');
    expect(clock.pendingCount()).toBe(0);
  });

  it('armIfIdle is a no-op for an unknown session', () => {
    const { deps, clock } = makeDeps();
    svc = new HeartbeatService(deps);

    svc.armIfIdle('never-seen');
    expect(clock.pendingCount()).toBe(0);
  });

  it('armIfIdle does not double-arm an already-armed idle agent', () => {
    const { deps, clock } = makeDeps();
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'idle'); // arms once
    expect(clock.pendingCount()).toBe(1);
    svc.armIfIdle('s1'); // arm() guards on an existing timer
    expect(clock.pendingCount()).toBe(1);
  });

  it('never nudges a blocked agent (idle-only trigger)', () => {
    const { deps, clock, reply } = makeDeps();
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'blocked');
    expect(clock.setTimer).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('does not arm for a scheduled (background) agent', () => {
    const { deps, clock } = makeDeps({
      getSession: () => ({ ...baseSession, scheduled: true })
    });
    svc = new HeartbeatService(deps);
    svc.observe('s1', 'idle');
    expect(clock.setTimer).not.toHaveBeenCalled();
  });

  it('does not arm for a headless (background) agent', () => {
    const { deps, clock } = makeDeps({
      getSession: () => ({ ...baseSession, headless: true })
    });
    svc = new HeartbeatService(deps);
    svc.observe('s1', 'idle');
    expect(clock.setTimer).not.toHaveBeenCalled();
  });

  it('does not arm for an agent with live sub-agents (delegating, not at rest)', () => {
    const { deps, clock, reply } = makeDeps({
      getSession: () => ({ ...baseSession, liveSubagents: 2 })
    });
    svc = new HeartbeatService(deps);
    svc.observe('s1', 'idle');
    expect(clock.setTimer).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('does not arm when the per-agent flag is off', () => {
    const { deps, clock } = makeDeps({
      getSession: () => ({ ...baseSession, heartbeat: false })
    });
    svc = new HeartbeatService(deps);
    svc.observe('s1', 'idle');
    expect(clock.setTimer).not.toHaveBeenCalled();
  });

  it('does not arm when the master switch is off', () => {
    const { deps, clock } = makeDeps({ isEnabled: () => false });
    svc = new HeartbeatService(deps);
    svc.observe('s1', 'idle');
    expect(clock.setTimer).not.toHaveBeenCalled();
  });

  it('does not nudge if the agent resumed before the timer fires', () => {
    // Eligibility is re-checked at fire time. Simulate a session that reports
    // exited by the time the timer runs.
    let session: HeartbeatSessionInfo = { ...baseSession };
    const { deps, clock, reply } = makeDeps({ getSession: () => session });
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'idle');
    session = { ...baseSession, status: 'exited' };
    clock.fireNext();
    expect(reply).not.toHaveBeenCalled();
  });

  it('resets the streak when the agent resumes on its own, but keeps it across self-nudges', () => {
    const { deps, clock, reply, setHeartbeat } = makeDeps({ maxNudges: () => 2 });
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'idle');
    clock.fireNext(); // nudge 1, pendingResume = true
    // Our own nudge makes it go working then back to idle — streak must persist.
    svc.observe('s1', 'working'); // pendingResume consumed, streak kept at 1
    svc.observe('s1', 'idle');
    clock.fireNext(); // nudge 2
    expect(reply).toHaveBeenCalledTimes(2);
    // Now a GENUINE human resume (not following our nudge edge): after nudge 2
    // the agent stays idle; fire the runaway path next.
    clock.fireNext(); // streak (2) >= max (2) → pause, no 3rd reply
    expect(reply).toHaveBeenCalledTimes(2);
    expect(setHeartbeat).toHaveBeenCalledWith('s1', false);
  });

  it('auto-disables and pushes an inbox notice at the runaway cap', () => {
    const { deps, clock, reply, setHeartbeat, pushInbox } = makeDeps({ maxNudges: () => 2 });
    svc = new HeartbeatService(deps);

    svc.observe('s1', 'idle');
    clock.fireNext(); // nudge 1 (streak 1)
    clock.fireNext(); // nudge 2 (streak 2)
    expect(reply).toHaveBeenCalledTimes(2);
    clock.fireNext(); // streak >= max → pause
    expect(reply).toHaveBeenCalledTimes(2); // no further nudge
    expect(setHeartbeat).toHaveBeenCalledWith('s1', false);
    expect(pushInbox).toHaveBeenCalledTimes(1);
    expect(pushInbox.mock.calls[0][0].projectId).toBe('proj-1');
    expect(pushInbox.mock.calls[0][0].comments).toContain('Heartbeat paused');
  });

  it('clears the timer on remove()', () => {
    const { deps, clock } = makeDeps();
    svc = new HeartbeatService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(1);
    svc.remove('s1');
    expect(clock.pendingCount()).toBe(0);
  });

  it('cancel() disarms the live timer but keeps history for a later re-arm', () => {
    const { deps, clock } = makeDeps();
    svc = new HeartbeatService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(1);
    svc.cancel('s1');
    expect(clock.pendingCount()).toBe(0);
    // A later idle edge (after the agent cycled) re-arms cleanly.
    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(1);
  });

  it('gives up quietly when reply reports the session is gone', () => {
    const { deps, clock } = makeDeps({ reply: vi.fn(() => false) });
    svc = new HeartbeatService(deps);
    svc.observe('s1', 'idle');
    clock.fireNext();
    // No re-arm after a failed write.
    expect(clock.pendingCount()).toBe(0);
  });
});
