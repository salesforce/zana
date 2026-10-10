import { expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';
import { dispatchRuntimeMessage } from './runtime-request-boundary.js';
const request = { type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: '00000000-0000-4000-8000-000000000000', operation: 'plugins-install', source: '/tmp/plugin', deadlineAt: new Date(Date.now() + 1000).toISOString() };
it('correlates asynchronous and synchronous request errors instead of dropping them', async () => {
  const reply = vi.fn();
  await dispatchRuntimeMessage(request, reply, async () => { throw new Error('Invalid plugin manifest'); });
  expect(reply).toHaveBeenCalledWith({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: request.id, message: 'Invalid plugin manifest' });
  await dispatchRuntimeMessage(request, reply, () => { throw 'offline'; });
  expect(reply.mock.lastCall?.[0].message).toBe('offline');
});
it('rejects malformed messages, preserves successful replies, and bounds errors without request IDs', async () => {
  const reply = vi.fn(), handle = vi.fn();
  await dispatchRuntimeMessage({}, reply, handle); expect(handle).not.toHaveBeenCalled();
  expect(reply.mock.lastCall?.[0]).not.toHaveProperty('id'); reply.mockClear();
  await dispatchRuntimeMessage(request, reply, handle); expect(reply).not.toHaveBeenCalled();
  await dispatchRuntimeMessage({ type: 'stop', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION }, reply, async () => { throw new Error('x'.repeat(10000)); });
  expect(reply.mock.lastCall?.[0].message).toHaveLength(8192); expect(reply.mock.lastCall?.[0]).not.toHaveProperty('id');
});
it('echoes a bounded request id on schema failures so main rejects immediately', async () => {
  const reply = vi.fn(), handle = vi.fn();
  await dispatchRuntimeMessage({ ...request, operation: 'product-event', channel: 'arbitrary:x', args: [] }, reply, handle);
  expect(handle).not.toHaveBeenCalled();
  expect(reply.mock.lastCall?.[0]).toMatchObject({ type: 'error', id: request.id });
  expect(reply.mock.lastCall?.[0].message).toMatch(/^invalid server runtime message: /);
  expect(reply.mock.lastCall?.[0].message.length).toBeLessThanOrEqual(200);
  for (const id of ['', 'x'.repeat(201), 7]) {
    await dispatchRuntimeMessage({ id, bogus: true }, reply, handle);
    expect(reply.mock.lastCall?.[0]).not.toHaveProperty('id');
  }
  await dispatchRuntimeMessage('junk', reply, handle);
  expect(reply.mock.lastCall?.[0]).not.toHaveProperty('id');
});
