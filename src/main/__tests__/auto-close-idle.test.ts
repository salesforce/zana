import { describe, it, expect, vi } from 'vitest';
import {
  AutoCloseIdleService,
  type AutoCloseIdleDeps,
  type AutoCloseSessionInfo
} from '../auto-close-idle.js';

/**
 * Controllable fake clock over the injected setTimer/clearTimer (mirrors
 * heartbeat.test.ts). `fireNext()` runs the most-recently-armed pending timer —
 * the service only ever holds one armed timer per session at a time.
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

const baseSession: AutoCloseSessionInfo = {
  status: 'running',
  projectId: 'proj-1',
  title: 'My agent',
  profile: 'claude',
  scheduled: false,
  headless: false,
  liveSubagents: 0,
  lastInputAt: 0
};

function makeDeps(over: Partial<AutoCloseIdleDeps> = {}) {
  const clock = makeClock();
  const closeSession = vi.fn(() => true);
  const preserveParkedQuestion = vi.fn(() => false);
  const pushInbox = vi.fn();
  let nowMs = 1_000_000;
  const deps: AutoCloseIdleDeps = {
    isEnabled: () => true,
    delayMinutes: () => 15,
    getSession: () => ({ ...baseSession }),
    activeSessionId: () => null,
    isFavorite: () => false,
    now: () => nowMs,
    closeSession,
    preserveParkedQuestion,
    pushInbox,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...over
  };
  return {
    deps,
    clock,
    closeSession,
    preserveParkedQuestion,
    pushInbox,
    setNow: (ms: number) => {
      nowMs = ms;
    },
    getNow: () => nowMs
  };
}

describe('AutoCloseIdleService', () => {
  it('arms on entering idle and closes when the timer fires', () => {
    const { deps, clock, closeSession } = makeDeps();
    const svc = new AutoCloseIdleService(deps);

    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');
    expect(clock.setTimer).toHaveBeenCalledTimes(1);
    expect(closeSession).not.toHaveBeenCalled();

    clock.fireNext();
    expect(closeSession).toHaveBeenCalledWith('s1');
  });

  it('uses delayMinutes() * 60_000 as the timer delay (15 min default)', () => {
    const { deps, clock } = makeDeps();
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.setTimer).toHaveBeenCalledWith(expect.any(Function), 15 * 60_000);
  });

  it('disarms on leaving idle and never closes', () => {
    const { deps, clock, closeSession } = makeDeps();
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(1);
    svc.observe('s1', 'working');
    expect(clock.clearTimer).toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('does not close a delegating parent (live sub-agents) at arm time', () => {
    const { deps, clock, closeSession } = makeDeps({
      getSession: () => ({ ...baseSession, liveSubagents: 2 })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    // ineligible ⇒ nothing armed
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('does not close if sub-agents appear between arm and fire', () => {
    let subs = 0;
    const { deps, clock, closeSession } = makeDeps({
      getSession: () => ({ ...baseSession, liveSubagents: subs })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(1);
    subs = 1; // started delegating during the dwell
    clock.fireNext();
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('does not close a session that resumed (working) before fire', () => {
    let state: AutoCloseSessionInfo['status'] = 'running';
    const { deps, clock, closeSession } = makeDeps({
      getSession: () => ({ ...baseSession, status: state })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    svc.observe('s1', 'working'); // leaves idle → disarms
    expect(closeSession).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it('never arms on the blocked state', () => {
    const { deps, clock, closeSession } = makeDeps();
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'blocked');
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('never closes scheduled background agents', () => {
    const { deps, clock, closeSession } = makeDeps({
      getSession: () => ({ ...baseSession, scheduled: true })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('never closes headless background agents', () => {
    const { deps, clock, closeSession } = makeDeps({
      getSession: () => ({ ...baseSession, headless: true })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('never closes a shell tab', () => {
    const { deps, clock, closeSession } = makeDeps({
      getSession: () => ({ ...baseSession, profile: 'shell' })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  // T5.2: the "is this an agent?" gate is capability-driven, not a `=== 'shell'`
  // literal. A codex agent is an agent → eligible; an unknown/future non-agent
  // profile degrades to the shell posture (never auto-closed) rather than being
  // wrongly reclaimed.
  it('arms for a codex agent (isAgent capability, not a claude-only literal)', () => {
    const { deps, clock } = makeDeps({
      getSession: () => ({ ...baseSession, profile: 'codex' })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(1);
  });

  it('never closes an unknown non-agent profile (forward-compat degrade)', () => {
    const { deps, clock, closeSession } = makeDeps({
      getSession: () => ({ ...baseSession, profile: 'gemini-cli' })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('does not arm when the master switch is off', () => {
    const { deps, clock, closeSession } = makeDeps({ isEnabled: () => false });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('bails at fire time if the switch was turned off during the dwell', () => {
    let on = true;
    const { deps, clock, closeSession } = makeDeps({ isEnabled: () => on });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    on = false;
    clock.fireNext();
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('spares the foreground tab at fire time', () => {
    const { deps, clock, closeSession } = makeDeps({ activeSessionId: () => 's1' });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    // foreground ⇒ ineligible ⇒ nothing armed
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('never arms for a favorite (starred) agent', () => {
    const { deps, clock, closeSession } = makeDeps({ isFavorite: () => true });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    // starred ⇒ ineligible ⇒ nothing armed
    expect(clock.pendingCount()).toBe(0);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('spares a favorite at fire time even if it was starred during the dwell', () => {
    let starred = false;
    const { deps, clock, closeSession } = makeDeps({ isFavorite: () => starred });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(1); // armed while un-starred
    starred = true; // user starred it during the dwell
    clock.fireNext();
    expect(closeSession).not.toHaveBeenCalled(); // eligible() re-check spares it
  });

  it('closes an un-starred agent after a favorite was re-armed by armAllIdle', () => {
    let starred = true;
    const { deps, clock, closeSession } = makeDeps({ isFavorite: () => starred });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(clock.pendingCount()).toBe(0); // starred ⇒ never armed
    starred = false; // user un-stars it
    svc.armAllIdle(); // the setFavorites handler re-arms now-eligible idle agents
    expect(clock.pendingCount()).toBe(1);
    clock.fireNext();
    expect(closeSession).toHaveBeenCalledWith('s1');
  });

  it('two-clock: spares a tab a human typed into within the dwell window', () => {
    const ctx = makeDeps();
    // human typed 5 minutes ago (< 15 min dwell)
    ctx.deps.getSession = () => ({ ...baseSession, lastInputAt: ctx.getNow() - 5 * 60_000 });
    const svc = new AutoCloseIdleService(ctx.deps);
    svc.observe('s1', 'idle');
    ctx.clock.fireNext();
    expect(ctx.closeSession).not.toHaveBeenCalled();
  });

  it('two-clock: closes a tab whose last human input is older than the dwell', () => {
    const ctx = makeDeps();
    ctx.deps.getSession = () => ({ ...baseSession, lastInputAt: ctx.getNow() - 20 * 60_000 });
    const svc = new AutoCloseIdleService(ctx.deps);
    svc.observe('s1', 'idle');
    ctx.clock.fireNext();
    expect(ctx.closeSession).toHaveBeenCalledWith('s1');
  });

  it('preserves a parked question before closing and notes it in the breadcrumb', () => {
    const preserveParkedQuestion = vi.fn(() => true);
    const { deps, clock, closeSession, pushInbox } = makeDeps({ preserveParkedQuestion });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    clock.fireNext();
    expect(preserveParkedQuestion).toHaveBeenCalledWith('s1');
    expect(closeSession).toHaveBeenCalledWith('s1');
    expect(pushInbox).toHaveBeenCalledTimes(1);
    const arg = pushInbox.mock.calls[0][0];
    expect(arg.dedupeKey).toBe('auto-close:s1');
    expect(arg.comments).toMatch(/follow-up was created/i);
  });

  it('closes without an inbox breadcrumb by default (no parked question, notify off)', () => {
    const { deps, clock, closeSession, pushInbox } = makeDeps(); // preserve false, notify unset
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    clock.fireNext();
    expect(closeSession).toHaveBeenCalledWith('s1');
    // An idle auto-close is routine — no inbox noise unless opted in.
    expect(pushInbox).not.toHaveBeenCalled();
  });

  it('pushes a breadcrumb when shouldNotifyInbox is opted in', () => {
    const { deps, clock, closeSession, pushInbox } = makeDeps({ shouldNotifyInbox: () => true });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    clock.fireNext();
    expect(closeSession).toHaveBeenCalledWith('s1');
    expect(pushInbox).toHaveBeenCalledTimes(1);
    const arg = pushInbox.mock.calls[0][0];
    expect(arg.dedupeKey).toBe('auto-close:s1');
    expect(arg.comments).not.toMatch(/follow-up/i);
  });

  it('swallows a failed close (session already gone) without throwing', () => {
    const { deps, clock, pushInbox } = makeDeps({ closeSession: vi.fn(() => false) });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(() => clock.fireNext()).not.toThrow();
    expect(pushInbox).not.toHaveBeenCalled(); // no breadcrumb for a no-op close
  });

  it('does not throw if preserveParkedQuestion throws; still closes', () => {
    const { deps, clock, closeSession } = makeDeps({
      preserveParkedQuestion: vi.fn(() => {
        throw new Error('boom');
      })
    });
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    expect(() => clock.fireNext()).not.toThrow();
    expect(closeSession).toHaveBeenCalledWith('s1');
  });

  it('remove() clears a pending timer and prevents a later close', () => {
    const { deps, clock, closeSession } = makeDeps();
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    svc.remove('s1');
    expect(clock.pendingCount()).toBe(0);
    expect(() => clock.fireNext()).toThrow(); // nothing left to fire
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('cancel() disarms but keeps history so a re-enable can re-arm', () => {
    const { deps, clock, closeSession } = makeDeps();
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'idle');
    svc.cancel('s1');
    expect(clock.pendingCount()).toBe(0);
    svc.armIfIdle('s1'); // last state still idle
    expect(clock.pendingCount()).toBe(1);
    clock.fireNext();
    expect(closeSession).toHaveBeenCalledWith('s1');
  });

  it('armIfIdle no-ops when the session is not idle', () => {
    const { deps, clock } = makeDeps();
    const svc = new AutoCloseIdleService(deps);
    svc.observe('s1', 'working');
    svc.armIfIdle('s1');
    expect(clock.pendingCount()).toBe(0);
  });

  it('emits "closed" with the preserved flag', () => {
    const { deps, clock } = makeDeps({ preserveParkedQuestion: vi.fn(() => true) });
    const svc = new AutoCloseIdleService(deps);
    const onClosed = vi.fn();
    svc.on('closed', onClosed);
    svc.observe('s1', 'idle');
    clock.fireNext();
    expect(onClosed).toHaveBeenCalledWith('s1', { preserved: true });
  });
});
