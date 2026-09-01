import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionDeliveryDrainService, type ExecutionDeliveryDrainDeps } from '../execution-delivery-drain.js';

describe('ExecutionDeliveryDrainService', () => {
  let queue: Record<string, Array<{ id: string; executionId: string }>>;
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
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1' }];
    restful.worker = true;
    service.observe('worker', 'working');
    service.observe('worker', 'idle');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0]).toEqual(['worker', expect.stringContaining('execution.delivery.pull')]);
    expect(reply.mock.calls[0][1]).toContain('execution.delivery.ack');
  });

  it('does not re-announce unchanged pending delivery after an idle flicker', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1' }];
    restful.worker = true;
    service.observe('worker', 'idle');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    service.observe('worker', 'working');
    service.observe('worker', 'idle');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('does not inject after agent leaves its prompt during queue lookup', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1' }];
    restful.worker = false;
    service.observe('worker', 'idle');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply).not.toHaveBeenCalled();
  });

  it('re-announces on the working→waiting edge (non-OSC harness rest state)', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1' }];
    restful.worker = true;
    service.observe('worker', 'working');
    service.observe('worker', 'waiting');
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0]).toEqual(['worker', expect.stringContaining('execution.delivery.pull')]);
    expect(reply.mock.calls[0][1]).toContain('execution.delivery.ack');
  });

  it('does not re-announce on the working→blocked edge', async () => {
    queue.worker = [{ id: 'delivery-1', executionId: 'execution-1' }];
    restful.worker = false;
    service.observe('worker', 'working');
    service.observe('worker', 'blocked');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reply).not.toHaveBeenCalled();
  });
});
