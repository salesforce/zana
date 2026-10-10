// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import type { InboxThread } from '../lib/inbox-thread.js';

const resolve = vi.hoisted(() => vi.fn());
vi.mock('../lib/inbox-thread.js', () => ({ resolveInboxThread: resolve }));
import { createResultCache, inboxThreadCache, useInboxThread } from './useInboxThread.js';
const entry = (id: string): InboxEntry => ({ id, projectId: 'p', ts: 1, sessionId: id });
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it.each(['resolve', 'reject'])('ignores a stale lookup after changing reports (%s)', async (settlement) => {
  let finish!: (thread: InboxThread) => void;
  let fail!: (error: Error) => void;
  resolve.mockReturnValueOnce(new Promise((yes, no) => { finish = yes; fail = no; }));
  resolve.mockResolvedValueOnce({ id: 'second', title: 'Second', archived: false });
  const { result, rerender } = renderHook(({ id }) => useInboxThread(entry(id), false), { initialProps: { id: 'first' } });
  rerender({ id: 'second' });
  await waitFor(() => expect(result.current.thread?.id).toBe('second'));
  await act(async () => {
    if (settlement === 'resolve') finish({ id: 'first', title: 'First', archived: false });
    else fail(new Error('Stale error'));
  });
  expect(result.current.thread?.id).toBe('second');
  expect(result.current.error).toBeNull();
});

it('shows a useful message for non-Error failures', async () => {
  resolve.mockRejectedValue('offline');
  const { result } = renderHook(() => useInboxThread(entry('thread'), false));
  await waitFor(() => expect(result.current.error).toBe('Could not load the original conversation.'));
});

it('paints a cached thread immediately, revalidates, and keeps it when revalidation fails', async () => {
  inboxThreadCache.clear();
  resolve.mockResolvedValueOnce({ id: 'c', title: 'One', archived: false });
  const first = renderHook(() => useInboxThread(entry('c'), false));
  expect(first.result.current.loading).toBe(true);
  await waitFor(() => expect(first.result.current.thread?.title).toBe('One'));
  first.unmount();
  let finish!: (thread: InboxThread) => void;
  resolve.mockReturnValueOnce(new Promise((yes) => { finish = yes; }));
  const second = renderHook(() => useInboxThread(entry('c'), false));
  expect(second.result.current).toMatchObject({ loading: false, thread: { title: 'One' } });
  await act(async () => finish({ id: 'c', title: 'Two', archived: false }));
  expect(second.result.current.thread?.title).toBe('Two');
  second.unmount();
  resolve.mockRejectedValueOnce(new Error('offline'));
  const third = renderHook(() => useInboxThread(entry('c'), false));
  await act(async () => { await Promise.resolve(); });
  expect(third.result.current).toMatchObject({ loading: false, error: null, thread: { title: 'Two' } });
});

it('never caches a failed lookup and evicts the least recently used entry beyond 20', async () => {
  inboxThreadCache.clear();
  resolve.mockRejectedValueOnce(new Error('offline'));
  const failed = renderHook(() => useInboxThread(entry('f'), false));
  await waitFor(() => expect(failed.result.current.error).toBe('offline'));
  expect(inboxThreadCache.get('f:f')).toBeUndefined();
  const cache = createResultCache<number>(20);
  for (let i = 0; i < 20; i++) cache.set(`k${i}`, i);
  cache.get('k0'); cache.set('k20', 20);
  expect(cache.get('k1')).toBeUndefined(); expect(cache.get('k0')).toBe(0); expect(cache.get('k20')).toBe(20);
});

it('evicts a cached thread once it no longer resolves', async () => {
  inboxThreadCache.clear();
  resolve.mockResolvedValueOnce({ id: 'gone', title: 'Old', archived: false });
  const first = renderHook(() => useInboxThread(entry('gone'), false));
  await waitFor(() => expect(first.result.current.thread?.title).toBe('Old'));
  first.unmount();
  resolve.mockResolvedValueOnce(null);
  const second = renderHook(() => useInboxThread(entry('gone'), false));
  await waitFor(() => expect(second.result.current.thread).toBeNull());
  second.unmount();
  resolve.mockReturnValueOnce(new Promise(() => {}));
  const third = renderHook(() => useInboxThread(entry('gone'), false));
  expect(third.result.current).toMatchObject({ loading: true, thread: null });
});

it('bounds a weighted cache by total weight and skips oversized values', () => {
  const cache = createResultCache<string>(20, { weigh: (value) => value.length, maxWeight: 10, maxEntryWeight: 6 });
  cache.set('a', 'xxxx'); cache.set('b', 'yyyy');
  cache.set('huge', 'z'.repeat(7));
  expect(cache.get('huge')).toBeUndefined();
  cache.set('c', 'wwww');
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('b')).toBe('yyyy');
  expect(cache.get('c')).toBe('wwww');
  cache.set('b', 'v'); cache.set('d', 'uuuuu');
  expect([cache.get('b'), cache.get('c'), cache.get('d')]).toEqual(['v', 'wwww', 'uuuuu']);
  cache.delete('c'); expect(cache.get('c')).toBeUndefined();
});
