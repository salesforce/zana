import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { createBrowserPageEvaluator } from './desktop-browser-page.js';
import { parseDesktopBrowserEvaluateRequest } from '@zana-ai/zcc-desktop-contract';
const request = {
  tabId: 'tab',
  threadId: 'thread',
  expression: '({answer:42})',
};
function page() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    executeJavaScript: vi.fn(async () => '{"answer":42}'),
    executeJavaScriptInIsolatedWorld: vi.fn(async () => '{"answer":42}'),
  });
}
afterEach(() => vi.useRealTimers());
it('bounds requests and rejects malformed scope, code and world', () => {
  expect(parseDesktopBrowserEvaluateRequest(request)).toEqual({
    success: true,
    data: request,
  });
  for (const value of [
    null,
    [],
    { ...request, expression: '' },
    { ...request, expression: 'x'.repeat(131073) },
    { ...request, threadId: '' },
    { ...request, tabId: '' },
    { ...request, world: 'other' },
    { ...request, extra: 1 },
  ])
    expect(parseDesktopBrowserEvaluateRequest(value).success).toBe(false);
  expect(
    parseDesktopBrowserEvaluateRequest({ ...request, world: 'main' }).success,
  ).toBe(true);
});
it('isolates by default, supports main-world React probes and subscribes once with bounded messages', async () => {
  const native = page();
  const evaluate = createBrowserPageEvaluator();
  const send = vi.fn();
  expect(
    await evaluate(native as unknown as WebContents, request, send),
  ).toEqual({ answer: 42 });
  expect(native.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
  const script = native.executeJavaScriptInIsolatedWorld.mock
    .calls[0] as unknown as [number, { code: string }[]];
  const prefix = script[1][0]!.code.match(/zcc-page-[\w-]+:/)![0];
  native.emit('console-message', {}, 0, prefix + '{"type":"saved"}');
  expect(send).toHaveBeenCalledWith({ type: 'saved' });
  native.emit('console-message', {}, 0, prefix + '{bad');
  native.emit('console-message', {}, 0, 'unrelated');
  native.emit('console-message', {}, 0, prefix + 'x'.repeat(131073));
  expect(send).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 105; i++)
    native.emit('console-message', {}, 0, prefix + '{}');
  expect(send.mock.calls.length).toBeLessThanOrEqual(100);
  await evaluate(
    native as unknown as WebContents,
    { ...request, world: 'main' },
    send,
  );
  expect(native.executeJavaScript).toHaveBeenCalledOnce();
  expect(native.listenerCount('console-message')).toBe(1);
  native.emit('destroyed');
  expect(native.listenerCount('console-message')).toBe(0);
});
it('retains concurrency ownership after timeout and releases it on actual completion', async () => {
  vi.useFakeTimers();
  const native = page();
  let finish!: (value: string) => void;
  native.executeJavaScriptInIsolatedWorld.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const evaluate = createBrowserPageEvaluator();
  const first = evaluate(native as unknown as WebContents, request, () => {});
  const result = expect(first).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(5000);
  await result;
  await expect(
    evaluate(native as unknown as WebContents, request, () => {}),
  ).rejects.toThrow('busy');
  finish('null');
  await Promise.resolve();
  native.executeJavaScriptInIsolatedWorld.mockResolvedValue('null');
  await expect(
    evaluate(native as unknown as WebContents, request, () => {}),
  ).resolves.toBeNull();
});
it('rejects closed, oversized and invalid results and releases failed execution', async () => {
  const native = page();
  const evaluate = createBrowserPageEvaluator();
  native.isDestroyed.mockReturnValue(true);
  await expect(
    evaluate(native as unknown as WebContents, request, () => {}),
  ).rejects.toThrow('closed');
  native.isDestroyed.mockReturnValue(false);
  native.executeJavaScriptInIsolatedWorld.mockResolvedValue('x'.repeat(131073));
  await expect(
    evaluate(native as unknown as WebContents, request, () => {}),
  ).rejects.toThrow('Invalid page result');
  native.executeJavaScriptInIsolatedWorld.mockRejectedValue(
    new Error('navigation'),
  );
  await expect(
    evaluate(native as unknown as WebContents, request, () => {}),
  ).rejects.toThrow('navigation');
  native.executeJavaScriptInIsolatedWorld.mockResolvedValue('null');
  await expect(
    evaluate(native as unknown as WebContents, request, () => {}),
  ).resolves.toBeNull();
});
