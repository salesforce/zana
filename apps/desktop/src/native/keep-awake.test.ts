import { describe, it, expect, vi } from 'vitest';
import { KeepAwakeService, type KeepAwakeDeps } from './keep-awake.js';

/**
 * Controllable fake clock built on the injected setTimer/clearTimer. The
 * service only ever holds ONE grace timer at a time, so `fireNext()` runs the
 * single pending timer. Mirrors the makeClock helper in heartbeat.test.ts.
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

/**
 * Fake power-save blocker. Each `start` mints a fresh id and marks it active;
 * `stop` clears it. Lets a test assert the blocker was acquired exactly once
 * and released exactly once, and that ids are never double-stopped.
 */
function makeBlocker() {
  let nextId = 100;
  const active = new Set<number>();
  const startBlocker = vi.fn(() => {
    const id = nextId++;
    active.add(id);
    return id;
  });
  const stopBlocker = vi.fn((id: number) => {
    active.delete(id);
  });
  return { startBlocker, stopBlocker, isActive: (id: number) => active.has(id), activeCount: () => active.size };
}

function makeDeps(over: Partial<KeepAwakeDeps> = {}) {
  const clock = makeClock();
  const blocker = makeBlocker();
  const deps: KeepAwakeDeps = {
    isEnabled: () => true,
    startBlocker: blocker.startBlocker,
    stopBlocker: blocker.stopBlocker,
    graceMs: () => 60_000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...over
  };
  return { deps, clock, blocker };
}

describe('KeepAwakeService', () => {
  it('acquires a blocker when a session enters working', () => {
    const { deps, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');

    expect(blocker.startBlocker).toHaveBeenCalledTimes(1);
    expect(svc.isActive()).toBe(true);
  });

  it('does not acquire for non-working states', () => {
    const { deps, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'idle');
    svc.observe('s2', 'blocked');
    svc.observe('s3', 'done');
    svc.observe('s4', 'unknown');

    expect(blocker.startBlocker).not.toHaveBeenCalled();
    expect(svc.isActive()).toBe(false);
  });

  it('only acquires one blocker even with many working sessions', () => {
    const { deps, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.observe('s2', 'working');
    svc.observe('s1', 'working'); // repeat edge — must not re-acquire

    expect(blocker.startBlocker).toHaveBeenCalledTimes(1);
    expect(blocker.activeCount()).toBe(1);
  });

  it('schedules a grace release when the last working session goes idle, and releases when it elapses', () => {
    const { deps, clock, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');

    // Not released yet — grace timer is armed.
    expect(blocker.stopBlocker).not.toHaveBeenCalled();
    expect(svc.isActive()).toBe(true);
    expect(clock.pendingCount()).toBe(1);

    clock.fireNext();

    expect(blocker.stopBlocker).toHaveBeenCalledTimes(1);
    expect(svc.isActive()).toBe(false);
  });

  it('cancels the pending grace release if a session resumes working within the window', () => {
    const { deps, clock, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.observe('s1', 'idle'); // arms grace timer
    expect(clock.pendingCount()).toBe(1);

    svc.observe('s1', 'working'); // resumes before grace elapses
    expect(clock.pendingCount()).toBe(0); // grace timer cleared
    expect(blocker.stopBlocker).not.toHaveBeenCalled();
    expect(svc.isActive()).toBe(true);
  });

  it('holds the blocker until ALL working sessions stop, then releases after grace', () => {
    const { deps, clock, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.observe('s2', 'working');

    svc.observe('s1', 'idle');
    // s2 still working → no grace timer, blocker held.
    expect(clock.pendingCount()).toBe(0);
    expect(svc.isActive()).toBe(true);

    svc.observe('s2', 'idle');
    expect(clock.pendingCount()).toBe(1);
    clock.fireNext();
    expect(blocker.stopBlocker).toHaveBeenCalledTimes(1);
    expect(svc.isActive()).toBe(false);
  });

  it('does not release if another session is working when the grace timer fires', () => {
    const { deps, clock, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.observe('s1', 'idle'); // arms grace timer
    svc.observe('s2', 'working'); // cancels it
    // s1 idle, s2 working. Force-fire any stray timer would be a no-op; assert
    // there is none pending and the blocker is still held.
    expect(clock.pendingCount()).toBe(0);
    expect(svc.isActive()).toBe(true);
    expect(blocker.stopBlocker).not.toHaveBeenCalled();
  });

  it('drops a working session on remove() and releases after grace if it was the last', () => {
    const { deps, clock, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.remove('s1'); // pty exit while working

    expect(clock.pendingCount()).toBe(1);
    clock.fireNext();
    expect(blocker.stopBlocker).toHaveBeenCalledTimes(1);
    expect(svc.isActive()).toBe(false);
  });

  it('re-acquires after a full release cycle when work resumes', () => {
    const { deps, clock, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');
    clock.fireNext(); // release
    expect(svc.isActive()).toBe(false);

    svc.observe('s1', 'working'); // new work
    expect(blocker.startBlocker).toHaveBeenCalledTimes(2);
    expect(svc.isActive()).toBe(true);
  });

  it('shutdown() releases the blocker immediately and clears the grace timer', () => {
    const { deps, clock, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.observe('s1', 'idle'); // arms grace timer
    svc.shutdown();

    expect(blocker.stopBlocker).toHaveBeenCalledTimes(1);
    expect(svc.isActive()).toBe(false);
    expect(clock.pendingCount()).toBe(0);
  });

  it('shutdown() is a no-op when no blocker is held', () => {
    const { deps, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.shutdown();

    expect(blocker.stopBlocker).not.toHaveBeenCalled();
  });

  it('fires onChange(true) on acquire and onChange(false) on release', () => {
    const onChange = vi.fn();
    const { deps, clock } = makeDeps({ onChange });
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    svc.observe('s1', 'idle');
    clock.fireNext(); // grace elapses → release
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not fire onChange on a no-op acquire (already held)', () => {
    const onChange = vi.fn();
    const { deps } = makeDeps({ onChange });
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.observe('s2', 'working'); // blocker already held — no second onChange(true)

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('never acquires while disabled', () => {
    const { deps, blocker } = makeDeps({ isEnabled: () => false });
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');

    expect(blocker.startBlocker).not.toHaveBeenCalled();
    expect(svc.isActive()).toBe(false);
  });

  it('refresh() releases a held block immediately when the setting is turned off', () => {
    let enabled = true;
    const { deps, clock, blocker } = makeDeps({ isEnabled: () => enabled });
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    expect(svc.isActive()).toBe(true);

    enabled = false;
    svc.refresh(); // setting toggled off

    expect(blocker.stopBlocker).toHaveBeenCalledTimes(1);
    expect(svc.isActive()).toBe(false);
    expect(clock.pendingCount()).toBe(0); // no lingering grace timer
  });

  it('refresh() re-acquires when re-enabled while a session is still working', () => {
    let enabled = false;
    const { deps, blocker } = makeDeps({ isEnabled: () => enabled });
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working'); // disabled → no block
    expect(svc.isActive()).toBe(false);

    enabled = true;
    svc.refresh(); // setting toggled on while work is in flight

    expect(blocker.startBlocker).toHaveBeenCalledTimes(1);
    expect(svc.isActive()).toBe(true);
  });

  it('refresh() is a no-op when enabled with work in flight (stays held, no churn)', () => {
    const { deps, blocker } = makeDeps();
    const svc = new KeepAwakeService(deps);

    svc.observe('s1', 'working');
    svc.refresh();

    expect(blocker.startBlocker).toHaveBeenCalledTimes(1);
    expect(blocker.stopBlocker).not.toHaveBeenCalled();
    expect(svc.isActive()).toBe(true);
  });

  it('survives a startBlocker that throws without crashing the caller', () => {
    const { deps } = makeDeps({
      startBlocker: () => {
        throw new Error('powerSaveBlocker unavailable');
      }
    });
    const svc = new KeepAwakeService(deps);

    expect(() => svc.observe('s1', 'working')).not.toThrow();
    expect(svc.isActive()).toBe(false);
  });
});
