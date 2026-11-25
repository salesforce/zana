import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armOnBusyEdge, armQuietCheck, armedCount, disarm, isArmed, dispatchApiErrorStop, forgetSession, touch,
  type ApiErrorProducer, type ApiErrorStopEvent, type DispatchCtx
} from '../api-error-dispatch.js';

const event: ApiErrorStopEvent = { kind: 'api-error-stop', error: 'overloaded', text: 'busy', retryable: true };

function makeCtx(live = true) {
  const calls: string[] = [];
  const ctx: DispatchCtx = {
    isLive: vi.fn(() => live),
    onTurnFailed: vi.fn((id) => { calls.push(`failed:${id}`); }),
    route: vi.fn((id) => { calls.push(`route:${id}`); }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    log: vi.fn()
  };
  return { ctx, calls };
}

function makeProducer(result: { kind: string } | null = event, quietMs = 1000) {
  const producer: ApiErrorProducer = {
    quietMs,
    markTurnStart: vi.fn(async () => 42),
    check: vi.fn(async () => result),
    release: vi.fn()
  };
  return producer;
}

const ref = (id: string) => ({ id, cwd: '/w' });
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

describe('api-error-dispatch', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('isArmed covers the marker window, the armed window, and clears on disarm', async () => {
    const { ctx } = makeCtx();
    const producer = makeProducer();
    expect(isArmed('s9')).toBe(false);
    armQuietCheck(ctx, 's9', producer, ref('s9'));
    expect(isArmed('s9')).toBe(true); // marker still in flight
    await flush();
    expect(isArmed('s9')).toBe(true); // timer pending
    disarm(ctx, 's9');
    expect(isArmed('s9')).toBe(false);
    forgetSession(ctx, 's9');
  });

  it('isArmed is false again after a failed markTurnStart', async () => {
    const { ctx } = makeCtx();
    const producer = makeProducer();
    (producer.markTurnStart as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'));
    armQuietCheck(ctx, 's8', producer, ref('s8'));
    await flush();
    expect(isArmed('s8')).toBe(false);
    forgetSession(ctx, 's8');
  });

  it('dispatch marks the turn failed before routing', () => {
    const { ctx, calls } = makeCtx();
    dispatchApiErrorStop(ctx, 's1', event);
    expect(calls).toEqual(['failed:s1', 'route:s1']);
  });

  it('arms, waits the quiet period, checks once with the recorded marker, then dispatches', async () => {
    const { ctx, calls } = makeCtx();
    const producer = makeProducer();
    armQuietCheck(ctx, 's1', producer, ref('s1'));
    await flush();
    expect(armedCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(producer.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(producer.check).toHaveBeenCalledTimes(1);
    expect(producer.check).toHaveBeenCalledWith({ id: 's1', cwd: '/w' }, 42);
    expect(calls).toEqual(['failed:s1', 'route:s1']);
    expect(armedCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(producer.check).toHaveBeenCalledTimes(1);
    forgetSession(ctx, 's1');
  });

  it('keeps checking while the turn is unfinished, so a failure after a long silence is still seen', async () => {
    const { ctx, calls } = makeCtx();
    const producer = makeProducer(null);
    armQuietCheck(ctx, 'sr', producer, ref('sr'));
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(producer.check).toHaveBeenCalledTimes(3);
    (producer.check as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['failed:sr', 'route:sr']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(producer.check).toHaveBeenCalledTimes(4);
    forgetSession(ctx, 'sr');
  });

  it('stops rechecking after a bounded number of quiet periods, and when disarmed', async () => {
    const { ctx } = makeCtx();
    const producer = makeProducer(null);
    armQuietCheck(ctx, 'sb', producer, ref('sb'));
    await flush();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(producer.check).toHaveBeenCalledTimes(13);
    const other = makeProducer(null);
    armQuietCheck(ctx, 'sd', other, ref('sd'));
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    disarm(ctx, 'sd');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(other.check).toHaveBeenCalledTimes(1);
    forgetSession(ctx, 'sb');
    forgetSession(ctx, 'sd');
  });

  it('does not dispatch when the producer finds no failure', async () => {
    const { ctx, calls } = makeCtx();
    armQuietCheck(ctx, 's2', makeProducer(null), ref('s2'));
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([]);
    forgetSession(ctx, 's2');
  });

  it('ignores a non api-error-stop result', async () => {
    const { ctx, calls } = makeCtx();
    armQuietCheck(ctx, 's3', makeProducer({ kind: 'interrupted' }), ref('s3'));
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([]);
    forgetSession(ctx, 's3');
  });

  it('re-arming replaces the earlier check (new turn)', async () => {
    const { ctx } = makeCtx();
    const producer = makeProducer();
    armQuietCheck(ctx, 's4', producer, ref('s4'));
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    armQuietCheck(ctx, 's4', producer, ref('s4'));
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    expect(producer.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(producer.check).toHaveBeenCalledTimes(1);
    forgetSession(ctx, 's4');
  });

  it('touch restarts the quiet period; touch with nothing armed is a no-op', async () => {
    const { ctx } = makeCtx();
    const producer = makeProducer();
    touch(ctx, 'nobody');
    armQuietCheck(ctx, 's5', producer, ref('s5'));
    await flush();
    await vi.advanceTimersByTimeAsync(800);
    touch(ctx, 's5');
    await vi.advanceTimersByTimeAsync(800);
    expect(producer.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(producer.check).toHaveBeenCalledTimes(1);
    forgetSession(ctx, 's5');
  });

  it.each(['Stop', 'Interrupt', 'new turn'])('disarm on %s prevents the check and releases state', async () => {
    const { ctx, calls } = makeCtx();
    const producer = makeProducer();
    armQuietCheck(ctx, 's6', producer, ref('s6'));
    await flush();
    disarm(ctx, 's6', producer);
    expect(armedCount()).toBe(0);
    expect(producer.release).toHaveBeenCalledWith('s6');
    await vi.advanceTimersByTimeAsync(5000);
    expect(producer.check).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    forgetSession(ctx, 's6');
  });

  it('disarm while markTurnStart is pending leaves nothing armed', async () => {
    const { ctx } = makeCtx();
    let resolve!: (v: unknown) => void;
    const producer = makeProducer();
    producer.markTurnStart = vi.fn(() => new Promise((r) => { resolve = r; }));
    armQuietCheck(ctx, 's7', producer, ref('s7'));
    disarm(ctx, 's7');
    resolve(1);
    await flush();
    expect(armedCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(producer.check).not.toHaveBeenCalled();
    forgetSession(ctx, 's7');
  });

  it('exit during a pending check drops the result and leaves no timer', async () => {
    const { ctx, calls } = makeCtx();
    let resolve!: (v: { kind: string }) => void;
    const producer = makeProducer();
    producer.check = vi.fn(() => new Promise((r) => { resolve = r; }));
    armQuietCheck(ctx, 's8', producer, ref('s8'));
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    forgetSession(ctx, 's8', producer);
    resolve(event);
    await flush();
    expect(calls).toEqual([]);
    expect(armedCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not dispatch for a session that is no longer live', async () => {
    const { ctx, calls } = makeCtx(false);
    armQuietCheck(ctx, 's9', makeProducer(), ref('s9'));
    await flush();
    expect(armedCount()).toBe(0);
    expect(calls).toEqual([]);
    forgetSession(ctx, 's9');
  });

  it('logs and survives a failing check or marker', async () => {
    const { ctx, calls } = makeCtx();
    const bad = makeProducer();
    bad.check = vi.fn(async () => { throw new Error('boom'); });
    armQuietCheck(ctx, 's10', bad, ref('s10'));
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.log).toHaveBeenCalled();
    const badMark = makeProducer();
    badMark.markTurnStart = vi.fn(async () => { throw new Error('nope'); });
    armQuietCheck(ctx, 's11', badMark, ref('s11'));
    await flush();
    expect(armedCount()).toBe(0);
    expect(calls).toEqual([]);
    forgetSession(ctx, 's10');
    forgetSession(ctx, 's11');
  });
});

describe('armOnBusyEdge', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('arms a producer-only adapter and not twice for the same session', async () => {
    const { ctx } = makeCtx();
    const producer = makeProducer();
    const ref = vi.fn(() => ({ id: 'busy-a', cwd: '/w' }));
    armOnBusyEdge(ctx, 'busy-a', { status: 'running' }, { apiErrorProducer: producer }, ref);
    await flush();
    expect(producer.markTurnStart).toHaveBeenCalledTimes(1);
    armOnBusyEdge(ctx, 'busy-a', { status: 'running' }, { apiErrorProducer: producer }, ref);
    await flush();
    expect(producer.markTurnStart).toHaveBeenCalledTimes(1);
    expect(ref).toHaveBeenCalledTimes(1);
    forgetSession(ctx, 'busy-a');
  });

  it.each([
    ['no session', undefined, { apiErrorProducer: makeProducer() }],
    ['exited session', { status: 'exited' }, { apiErrorProducer: makeProducer() }],
    ['no adapter status', { status: 'running' }, undefined],
    ['no producer', { status: 'running' }, {}],
    ['a turn-start hook', { status: 'running' }, { apiErrorProducer: makeProducer(), interactionHook: {} }]
  ])('does nothing for %s', async (_name, session, status) => {
    const { ctx } = makeCtx();
    const ref = vi.fn(() => ({ id: 'busy-b', cwd: '/w' }));
    armOnBusyEdge(ctx, 'busy-b', session, status, ref);
    await flush();
    expect(ref).not.toHaveBeenCalled();
    expect(isArmed('busy-b')).toBe(false);
  });
});
