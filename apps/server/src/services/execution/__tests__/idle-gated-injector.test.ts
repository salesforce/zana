import { describe, it, expect, vi } from 'vitest';
import { IdleGatedInjector } from '../idle-gated-injector.js';

function makeInjector(initialState = 'idle') {
  const states = new Map<string, string>();
  const reply = vi.fn((_sessionId: string, _text: string) => true);
  const injector = new IdleGatedInjector({
    getState: (sessionId) => states.get(sessionId) ?? initialState,
    reply
  });
  const setState = (sessionId: string, state: string) => states.set(sessionId, state);
  return { injector, reply, setState };
}

describe('IdleGatedInjector', () => {
  it('delivers immediately when the worker is already idle', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'idle');
    expect(injector.deliver('w1', 'task A')).toBe(true);
    expect(reply).toHaveBeenCalledWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('delivers immediately on an unknown state (freshly spawned worker)', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'unknown');
    injector.deliver('w1', 'task A');
    expect(reply).toHaveBeenCalledWith('w1', 'task A');
  });

  it('queues instead of injecting into a mid-turn (working) worker', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    expect(injector.deliver('w1', 'task A')).toBe(true); // accepted (queued)
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(1);
  });

  it('flushes the queued task on the transition into idle', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    // non-idle transitions never flush
    injector.onState('w1', 'working');
    expect(reply).not.toHaveBeenCalled();
    // idle edge flushes
    injector.onState('w1', 'idle');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('does not queue for other sessions and never cross-delivers', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    setState('w2', 'idle');
    injector.deliver('w1', 'for-w1');
    injector.deliver('w2', 'for-w2');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w2', 'for-w2');
    // an idle edge on the unrelated w2 must not flush w1's queue
    injector.onState('w2', 'idle');
    expect(injector.pendingCount('w1')).toBe(1);
  });

  it('delivers a pile-up one idle-edge at a time (no back-to-back paste)', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    injector.deliver('w1', 'task B');
    expect(injector.pendingCount('w1')).toBe(2);
    injector.onState('w1', 'idle');
    expect(reply).toHaveBeenCalledExactlyOnceWith('w1', 'task A');
    expect(injector.pendingCount('w1')).toBe(1);
    injector.onState('w1', 'idle');
    expect(reply).toHaveBeenLastCalledWith('w1', 'task B');
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('forget() drops a queued task so an exited worker never receives it', () => {
    const { injector, reply, setState } = makeInjector();
    setState('w1', 'working');
    injector.deliver('w1', 'task A');
    injector.forget('w1');
    injector.onState('w1', 'idle');
    expect(reply).not.toHaveBeenCalled();
    expect(injector.pendingCount('w1')).toBe(0);
  });

  it('an idle edge with nothing queued is a no-op', () => {
    const { injector, reply } = makeInjector();
    injector.onState('w1', 'idle');
    expect(reply).not.toHaveBeenCalled();
  });
});
