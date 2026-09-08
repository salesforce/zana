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
    expect(reply.mock.calls[0]).toEqual(['worker', expect.stringContaining('execution.delivery.pull')]);
    expect(reply.mock.calls[0][1]).toContain('execution.delivery.ack');
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
    expect(reply.mock.calls[0]).toEqual(['worker', expect.stringContaining('execution.delivery.pull')]);
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
