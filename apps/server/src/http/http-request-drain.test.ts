import { expect, it, vi } from 'vitest';
import { createHttpRequestDrain } from './http-request-drain.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

it('fences admission and waits for admitted handlers, including failure cleanup', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const handler = vi.fn(async () => { await held; throw new Error('failed handler'); });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const drain = createHttpRequestDrain(handler);
  const response = { destroy: vi.fn(), writeHead: vi.fn().mockReturnThis(), end: vi.fn() } as unknown as ServerResponse;
  drain.handle({} as IncomingMessage, response);
  drain.dispose();
  drain.handle({} as IncomingMessage, response);
  expect(handler).toHaveBeenCalledOnce();
  expect(response.writeHead).toHaveBeenCalledWith(503);
  let idle = false;
  const closing = drain.whenIdle().then(() => { idle = true; });
  await Promise.resolve(); expect(idle).toBe(false);
  release(); await closing;
  expect(response.destroy).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed handler'));
  warn.mockRestore();
  await drain.whenIdle();
});

it('drains successful handlers and starts idle', async () => {
  const drain = createHttpRequestDrain(async () => {});
  await drain.whenIdle();
  drain.handle({} as IncomingMessage, {} as ServerResponse);
  await drain.whenIdle();
});
