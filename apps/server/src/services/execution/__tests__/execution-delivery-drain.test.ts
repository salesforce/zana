import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionDeliveryDrainService, type ExecutionDeliveryDrainDeps } from '../execution-delivery-drain.js';

describe('ExecutionDeliveryDrainService', () => {
  let queue: Record<string, Array<{ id: string; executionId: string; attempt: number }>>;
  let restful: Record<string, boolean>;
  let reply: ReturnType<typeof vi.fn>;
  let service: ExecutionDeliveryDrainService;

  beforeEach(() => {
    queue = {};
    restful = {};
    reply = vi.fn((_sessionId: string, _text: string): boolean => true);
    const deps: ExecutionDeliveryDrainDeps = {
      pending: async (sessionId) => queue[sessionId] ?? [],
      isRestful: (sessionId) => restful[sessionId] === true,
      reply: reply as ExecutionDeliveryDrainDeps['reply']
    };
    service = new ExecutionDeliveryDrainService(deps);
  });

  it('nudges a worker at its next idle edge without claiming delivery', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    restful.worker = true;
    service.observe('worker', 'working');
    service.observe('worker', 'idle');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0]).toEqual(['worker', expect.stringContaining('execution.delivery.pull'), {
      assignmentId: expect.stringMatching(/^execution-nudge:/), idempotencyKey: expect.stringMatching(/:0$/)
    }]);
    expect(reply.mock.calls[0][1]).toContain('execution.delivery.ack');
  });

  it('steers the worker to ack delivered:true and away from owner-only resume', async () => {
    // The observed deadlock: a worker pulled the answer, then called the
    // owner-only execution.resume, got denied, and reported that denial as a
    // delivery error — looping the response forever. The nudge must name the
    // correct terminal (ack delivered:true) and forbid resume/respond.
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    restful.worker = true;
    service.observe('worker', 'idle');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    const nudge = reply.mock.calls[0][1];
    expect(nudge).toContain('delivered:true');
    expect(nudge).toContain('execution.resume');
    expect(nudge).toContain('owner-only');
  });

  it('announces all pending blockers for one worker in one bounded production nudge', async () => {
    queue.worker = [
      { id: 'delivery-1', executionId: 'execution-1', attempt: 0 },
      { id: 'delivery-2', executionId: 'execution-1', attempt: 0 }
    ];
    restful.worker = true;
    service.observe('worker', 'idle');

    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0][1]).toContain('2 pending blocker responses');
    expect(reply.mock.calls[0][1]).toContain('execution-1');
  });

  it('does not re-announce unchanged pending delivery after an idle flicker', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    restful.worker = true;
    service.observe('worker', 'idle');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    service.observe('worker', 'working');
    service.observe('worker', 'idle');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('re-announces a re-PENDING delivery after a failed ack (attempt bumped)', async () => {
    // Worker pulled, acked delivered:false, delivery reverted to PENDING with its
    // attempt bumped by the failed pull. A prompt-obeying worker (never polls)
    // must be RE-nudged on its next restful edge or the answer is stranded.
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    restful.worker = true;
    service.observe('worker', 'idle');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    // Failed pull bumped attempt 0 -> 1; same delivery id, still PENDING.
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 1 }];
    service.observe('worker', 'working');
    service.observe('worker', 'idle');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
    expect(reply.mock.calls[1][1]).toContain('execution.delivery.pull');
  });

  it('does not inject after agent leaves its prompt during queue lookup', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    restful.worker = false;
    service.observe('worker', 'idle');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply).not.toHaveBeenCalled();
  });

  it('re-announces on the working→waiting edge (non-OSC harness rest state)', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    restful.worker = true;
    service.observe('worker', 'working');
    service.observe('worker', 'waiting');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0]).toEqual(['worker', expect.stringContaining('execution.delivery.pull'), expect.any(Object)]);
    expect(reply.mock.calls[0][1]).toContain('execution.delivery.ack');
  });

  it('does not re-announce on the working→blocked edge', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    restful.worker = false;
    service.observe('worker', 'working');
    service.observe('worker', 'blocked');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply).not.toHaveBeenCalled();
  });

  it('serializes concurrent triggers into a single announce', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    restful.worker = true;
    // A burst of overlapping edges must coalesce: without serialization these
    // would each run pending()->reply() and double-nudge the same worker.
    service.observe('worker', 'idle');
    service.forceCheck('worker');
    service.forceCheck('worker');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('wakes an unchanged idle worker for a manual retry with a fresh correlation', async () => {
    const pending: Array<{ id: string; executionId: string; attempt: number; manualRetryCount?: number }> = [
      { id: 'delivery-1', executionId: 'execution-1', attempt: 0 }
    ];
    const svc = new ExecutionDeliveryDrainService({ pending: async () => pending, isRestful: () => true, reply });
    svc.observe('worker', 'idle');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    pending[0].manualRetryCount = 1;
    svc.forceCheck('worker');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
    expect(reply.mock.calls[1][2].idempotencyKey).not.toBe(reply.mock.calls[0][2].idempotencyKey);
    svc.observe('worker', 'idle');
    svc.forceCheck('worker');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reply).toHaveBeenCalledTimes(2);
  });

  it('force-checks an idle session before its first observed edge but not a busy session', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    service.forceCheck('worker');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reply).not.toHaveBeenCalled();
    restful.worker = true;
    service.forceCheck('worker');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledOnce());
  });

  it.each(['false', 'throw'] as const)('bounds %s send retries while the worker stays idle', async failure => {
    const timers: Array<() => void> = [];
    const logError = vi.fn();
    const send = vi.fn(async () => {
      if (failure === 'throw') throw new Error('receipt unavailable');
      return false;
    });
    const svc = new ExecutionDeliveryDrainService({
      pending: async () => [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }],
      isRestful: () => true, reply: send, isReplyIdempotent: () => true, logError,
      setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {}
    });
    svc.observe('worker', 'idle');
    for (let i = 0; i < 3; i += 1) {
      await vi.waitFor(() => expect(timers).toHaveLength(i + 1));
      timers[i]();
    }
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(4));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(timers).toHaveLength(3);
    if (failure === 'throw') expect(logError).toHaveBeenCalledTimes(4);
  });

  it.each(['false', 'throw'] as const)('recovers from %s without an idle edge and uses safe retry correlation', async failure => {
    const timers: Array<() => void> = [];
    const correlations: Array<{ assignmentId: string; idempotencyKey: string }> = [];
    const send = vi.fn(async (_sessionId, _text, correlation) => {
      correlations.push(correlation);
      if (correlations.length === 1) {
        if (failure === 'throw') throw new Error('receipt unavailable');
        return false;
      }
      return true;
    });
    const svc = new ExecutionDeliveryDrainService({
      pending: async () => [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }],
      isRestful: () => true, reply: send, isReplyIdempotent: () => true, logError: () => {},
      setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {}
    });
    svc.observe('worker', 'idle');
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    timers[0]();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(correlations[1].assignmentId).toBe(correlations[0].assignmentId);
    if (failure === 'throw') expect(correlations[1]).toEqual(correlations[0]);
    else expect(correlations[1].idempotencyKey).not.toBe(correlations[0].idempotencyKey);
    svc.forceCheck('worker');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('freezes uncertain payload and correlation when a second delivery arrives before retry', async () => {
    const pending = [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
    const calls: Array<[string, unknown]> = [];
    const timers: Array<() => void> = [];
    const svc = new ExecutionDeliveryDrainService({
      pending: async () => pending, isRestful: () => true, isReplyIdempotent: () => true,
      reply: async (_sessionId, text, correlation) => {
        calls.push([text, correlation]);
        if (calls.length === 1) throw new Error('uncertain send');
        return true;
      },
      logError: () => {}, setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {}
    });
    svc.observe('worker', 'idle');
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    pending.push({ id: 'delivery-2', executionId: 'execution-2', attempt: 0 });
    timers[0]();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2][0]).toContain('execution-2');
    expect(calls[2][1]).not.toEqual(calls[0][1]);
  });

  it('does not blindly retry a possibly successful non-idempotent CLI write', async () => {
    const setTimer = vi.fn();
    const send = vi.fn(async () => { throw new Error('write outcome uncertain'); });
    const logError = vi.fn();
    const svc = new ExecutionDeliveryDrainService({
      pending: async () => [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }],
      isRestful: () => true, reply: send, logError, setTimer
    });
    svc.observe('worker', 'idle');
    await vi.waitFor(() => expect(logError).toHaveBeenCalledOnce());
    svc.forceCheck('worker');
    svc.observe('worker', 'working');
    svc.observe('worker', 'idle');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledOnce();
    expect(setTimer).not.toHaveBeenCalled();
  });

  it('stops send retries when the session becomes busy or is removed', async () => {
    const timers: Array<() => void> = [];
    const clearTimer = vi.fn();
    const send = vi.fn(async () => false);
    let idle = true;
    const svc = new ExecutionDeliveryDrainService({
      pending: async () => [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }],
      isRestful: () => idle, reply: send,
      setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer
    });
    svc.observe('worker', 'idle');
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    idle = false;
    timers[0]();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledOnce();
    idle = true;
    svc.forceCheck('worker');
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    svc.remove('worker');
    expect(clearTimer).toHaveBeenCalledWith(2);
    timers[1]();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses default bounded timer and cancels it when a force-check succeeds', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn(async () => false).mockResolvedValueOnce(false).mockResolvedValue(true);
      const svc = new ExecutionDeliveryDrainService({
        pending: async () => [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }],
        isRestful: () => true, reply: send
      });
      svc.observe('worker', 'idle');
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(1);
      svc.forceCheck('worker');
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(send).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it.each(['true', 'false', 'throw'] as const)('does not resurrect a removed session after pending reply returns %s', async result => {
    let finish!: (value: boolean) => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<boolean>((resolve, reject) => { finish = resolve; fail = reject; });
    const send = vi.fn(() => pending);
    const setTimer = vi.fn();
    const svc = new ExecutionDeliveryDrainService({
      pending: async () => [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }],
      isRestful: () => true, reply: send, isReplyIdempotent: () => true, logError: () => {}, setTimer
    });
    svc.observe('worker', 'idle');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    svc.remove('worker');
    if (result === 'throw') fail(new Error('disconnected'));
    else finish(result === 'true');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setTimer).not.toHaveBeenCalled();
  });

  it('logs and schedules a bounded retry when the pending lookup fails', async () => {
    const timers: Array<() => void> = [];
    const logError = vi.fn();
    const localReply = vi.fn((): boolean => true);
    let failNext = true;
    const deps: ExecutionDeliveryDrainDeps = {
      pending: async () => {
        if (failNext) { failNext = false; throw new Error('store unavailable'); }
        return [{ id: 'delivery-1', executionId: 'execution-1', attempt: 0 }];
      },
      isRestful: () => true,
      reply: localReply as ExecutionDeliveryDrainDeps['reply'],
      logError,
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer: () => {}
    };
    const svc = new ExecutionDeliveryDrainService(deps);
    svc.observe('worker', 'idle');
    await vi.waitFor(() => expect(logError).toHaveBeenCalledTimes(1));
    expect(logError.mock.calls[0][0]).toContain('worker');
    expect(localReply).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    // Fire the scheduled retry; the lookup now succeeds and the nudge lands.
    timers[0]();
    await vi.waitFor(() => expect(localReply).toHaveBeenCalledTimes(1));
  });

  it('stops retrying after MAX_PENDING_RETRIES consecutive failures', async () => {
    const timers: Array<() => void> = [];
    const deps: ExecutionDeliveryDrainDeps = {
      pending: async () => { throw new Error('store unavailable'); },
      isRestful: () => true,
      reply: (() => true) as ExecutionDeliveryDrainDeps['reply'],
      logError: () => {},
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer: () => {}
    };
    const svc = new ExecutionDeliveryDrainService(deps);
    svc.observe('worker', 'idle');
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    timers[0]();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    timers[1]();
    await vi.waitFor(() => expect(timers).toHaveLength(3));
    timers[2]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Retry budget exhausted (3) — no fourth timer is scheduled.
    expect(timers).toHaveLength(3);
  });
});
