import { afterEach, expect, it, vi } from 'vitest';
import { PRODUCT_EVENT_ARGS_MAX_CHARS, PRODUCT_EVENT_ARGS_MAX_COUNT } from '@zana-ai/zcc-contracts/runtime';
import { createProductEventForwarder, splitTerminalData } from './product-event-forwarder.js';
afterEach(() => vi.useRealTimers());
it('keeps one IPC request in flight and preserves notification order', async () => {
  let resolve!: () => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })).mockResolvedValue(true);
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('one', [1]); forwarder.publish('two', [2]); forwarder.publish('three', [3]);
  expect(send).toHaveBeenCalledOnce(); resolve();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(send.mock.calls).toEqual([['one', [1]], ['two', [2]], ['three', [3]]]); forwarder.dispose();
});
it.each([{ messages: 1, bytes: 1024 }, { messages: 100, bytes: 40 }])('replaces overflow with a bounded reset', async limits => {
  let resolve!: () => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })).mockResolvedValue(true);
  const forwarder = createProductEventForwarder(send, limits);
  forwarder.publish('first', []);
  for (let i = 0; i < 100; i++) forwarder.publish('burst', [i]);
  resolve(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send).toHaveBeenLastCalledWith('product:reset', []);
  forwarder.publish('after', []); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3)); forwarder.dispose();
});
it('recovers from failed IPC using only a reset and releases retries on shutdown', async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(true);
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('change', []); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1500);
  expect(send.mock.calls).toEqual([['change', []], ['product:reset', []]]);
  send.mockRejectedValue(new Error('down'));
  forwarder.publish('again', []); await Promise.resolve(); forwarder.dispose();
  forwarder.publish('late', []); await vi.advanceTimersByTimeAsync(3000);
  expect(send).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
});
it('handles unserializable payloads and disposal during a pending request', async () => {
  let resolve!: () => void;
  const send = vi.fn(() => new Promise<void>(r => { resolve = r; }));
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('bad', [1n]); expect(send).toHaveBeenCalledWith('product:reset', []);
  forwarder.publish('queued', []); forwarder.dispose(); resolve(); await Promise.resolve(); expect(send).toHaveBeenCalledOnce();
});
const blocked = () => {
  let resolve!: () => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })).mockResolvedValue(true);
  return { send, release: () => resolve() };
};
it('turns an oversized snapshot into one invalidation without a reset and keeps terminal order', async () => {
  const { send, release } = blocked();
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('first', []);
  const huge = [{ blob: 'x'.repeat(PRODUCT_EVENT_ARGS_MAX_CHARS) }];
  forwarder.publish('followups:onChanged', huge); forwarder.publish('followups:onChanged', huge);
  forwarder.publish('terminals:onData', ['a']); forwarder.publish('terminals:onData', ['b']);
  forwarder.publish('goals:onChanged', Array(PRODUCT_EVENT_ARGS_MAX_COUNT + 1).fill(1));
  release(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(5));
  expect(send.mock.calls).toEqual([['first', []], ['followups:onChanged', []], ['terminals:onData', ['a']], ['terminals:onData', ['b']], ['goals:onChanged', []]]);
  forwarder.dispose();
});
it('accepts a snapshot at exactly the cap and falls back to reset for an oversized unsplittable stream', async () => {
  const { send, release } = blocked();
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('first', []);
  const exact = ['x'.repeat(PRODUCT_EVENT_ARGS_MAX_CHARS - 4)];
  forwarder.publish('config:onChanged', exact);
  forwarder.publish('terminals:onCliPlan', ['y'.repeat(PRODUCT_EVENT_ARGS_MAX_CHARS)]);
  release(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]).toEqual(['product:reset', []]); forwarder.dispose();
});
it('splits an oversized PTY chunk into ordered slices instead of resetting', async () => {
  const { send, release } = blocked();
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('first', []);
  // Control-heavy output: every ESC becomes a six-character JSON escape.
  const data = '\x1b[31mred\x1b[0m'.repeat(40_000);
  forwarder.publish('terminals:onData', ['session-1', data]);
  forwarder.publish('terminals:onData', ['session-1', 'tail']);
  release();
  await vi.waitFor(() => expect(send.mock.calls.at(-1)).toEqual(['terminals:onData', ['session-1', 'tail']]));
  const slices = send.mock.calls.slice(1, -1);
  expect(slices.length).toBeGreaterThan(1);
  expect(send.mock.calls.some(([channel]) => channel === 'product:reset')).toBe(false);
  for (const [channel, args] of slices) {
    expect(channel).toBe('terminals:onData');
    expect(JSON.stringify(args).length).toBeLessThanOrEqual(PRODUCT_EVENT_ARGS_MAX_CHARS);
  }
  expect(slices.map(([, args]) => (args as string[])[1]).join('')).toBe(data);
  forwarder.dispose();
});
it('splitTerminalData never splits a surrogate pair and always makes progress', () => {
  const emoji = '😀'.repeat(50);
  const slices = splitTerminalData('s', emoji, 40);
  expect(slices!.join('')).toBe(emoji);
  for (const slice of slices!) expect(slice.length % 2).toBe(0);
  expect(splitTerminalData('s', '"'.repeat(10), 12)!.join('')).toBe('"'.repeat(10));
  expect(splitTerminalData('s', '')).toEqual([]);
  // Not even one character fits beside the id: unsplittable.
  expect(splitTerminalData('s', '"'.repeat(10), 8)).toBeNull();
});
it('resets instead of recursing when a PTY chunk cannot be split under the cap', async () => {
  const { send, release } = blocked();
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('first', []);
  forwarder.publish('terminals:onData', ['s'.repeat(PRODUCT_EVENT_ARGS_MAX_CHARS), 'data']);
  release(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]).toEqual(['product:reset', []]); forwarder.dispose();
});
it('coalesces queued snapshots in place and preserves the order of other channels', async () => {
  const { send, release } = blocked();
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('first', []);
  forwarder.publish('goals:onChanged', [1]); forwarder.publish('terminals:onData', ['a']);
  forwarder.publish('scheduler:onTemplatesChanged', [1]); forwarder.publish('goals:onChanged', [2]);
  forwarder.publish('terminals:onData', ['b']); forwarder.publish('scheduler:onTemplatesChanged', [2]);
  forwarder.publish('goals:onChanged', Array(PRODUCT_EVENT_ARGS_MAX_COUNT + 1).fill(1)); forwarder.publish('goals:onChanged', [3]);
  release(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(5));
  expect(send.mock.calls).toEqual([['first', []], ['goals:onChanged', [3]], ['terminals:onData', ['a']], ['scheduler:onTemplatesChanged', [2]], ['terminals:onData', ['b']]]);
  forwarder.dispose();
});
it('still resets when invalidations overflow the queue or a send fails', async () => {
  const { send, release } = blocked();
  const forwarder = createProductEventForwarder(send, { messages: 1, bytes: 1024 });
  forwarder.publish('first', []);
  forwarder.publish('a:onChanged', []); forwarder.publish('b:onChanged', []);
  release(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send).toHaveBeenLastCalledWith('product:reset', []); forwarder.dispose();
});
it('never coalesces or invalidates id-carrying channels, and resets when one is oversized', async () => {
  const { send, release } = blocked();
  const forwarder = createProductEventForwarder(send);
  forwarder.publish('first', []);
  forwarder.publish('feed:onChanged', ['a']); forwarder.publish('feed:onChanged', ['b']);
  forwarder.publish('projectSettings:onChanged', ['p1']); forwarder.publish('projectSettings:onChanged', ['p2']);
  release(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(5));
  expect(send.mock.calls.slice(1)).toEqual([['feed:onChanged', ['a']], ['feed:onChanged', ['b']], ['projectSettings:onChanged', ['p1']], ['projectSettings:onChanged', ['p2']]]);
  forwarder.publish('feed:onChanged', ['x'.repeat(PRODUCT_EVENT_ARGS_MAX_CHARS)]);
  await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith('product:reset', []));
  forwarder.dispose();
});
