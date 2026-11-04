// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DIRECTORY_SLOW_MS, useDirectoryLoader } from './useDirectoryLoader.js';
import React from 'react';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const row = (name: string) => [{ path: `/repo/${name}`, name, kind: 'file' as const }];
function deferred() {
  let resolve!: (value: ReturnType<typeof row>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ReturnType<typeof row>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('coalesces pending reads and caches only completed mount-local listings', async () => {
  const pending = deferred();
  const read = vi.fn(() => pending.promise);
  const { result } = renderHook(() => useDirectoryLoader(read));
  let first!: Promise<unknown>, second!: Promise<unknown>;
  act(() => { first = result.current.loadDir('/repo'); second = result.current.loadDir('/repo'); });
  expect(second).toBe(first);
  await act(async () => { pending.resolve(row('file')); await first; });
  expect(read).toHaveBeenCalledTimes(1);
  expect(result.current.entries.get('/repo')).toEqual(row('file'));
  await act(async () => { await result.current.loadDir('/repo'); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(result.current.loading.size).toBe(0);
});

it('warns without ending the request and lets Retry supersede a late result', async () => {
  vi.useFakeTimers();
  const old = deferred(), fresh = deferred();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const { result } = renderHook(() => useDirectoryLoader(read));
  let first!: Promise<unknown>, retry!: Promise<unknown>;
  act(() => { first = result.current.loadDir('/repo'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(DIRECTORY_SLOW_MS); });
  expect(result.current.slow.has('/repo')).toBe(true);
  expect(result.current.loading.has('/repo')).toBe(true);
  act(() => { retry = result.current.loadDir('/repo', true); });
  expect(result.current.slow.size).toBe(0);
  await act(async () => { old.resolve(row('stale')); await first; });
  expect(result.current.entries.has('/repo')).toBe(false);
  expect(result.current.loading.has('/repo')).toBe(true);
  await act(async () => { fresh.resolve(row('fresh')); await retry; });
  expect(result.current.entries.get('/repo')).toEqual(row('fresh'));
  expect(result.current.loading.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not turn a failed directory into an empty cache and clears the error on retry', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([]);
  const { result } = renderHook(() => useDirectoryLoader(read));
  await act(async () => { await result.current.loadDir('/repo'); });
  expect(result.current.errors.get('/repo')).toBe('Offline');
  expect(result.current.entries.has('/repo')).toBe(false);
  await act(async () => { await result.current.loadDir('/repo'); });
  expect(result.current.entries.get('/repo')).toEqual([]);
  expect(result.current.errors.size).toBe(0);
});

it('invalidates requests across a refresh, even when returning to the same root', async () => {
  const old = deferred();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(row('new'));
  const { result } = renderHook(() => useDirectoryLoader(read));
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.loadDir('/repo'); });
  await act(async () => { await Promise.resolve(); });
  act(() => result.current.reset());
  await act(async () => { await result.current.loadDir('/repo'); old.resolve(row('old')); await pending; });
  expect(result.current.entries.get('/repo')).toEqual(row('new'));
});

it('cleans pending timers on scope changes and unmount, suppressing stale failures', async () => {
  vi.useFakeTimers();
  const pending = deferred();
  const oldRead = vi.fn(() => pending.promise), newRead = vi.fn(async () => row('new'));
  const { result, rerender, unmount } = renderHook(({ read }) => useDirectoryLoader(read), { initialProps: { read: oldRead as (path: string) => Promise<ReturnType<typeof row>> } });
  let first!: Promise<unknown>;
  act(() => { first = result.current.loadDir('/repo'); });
  await act(async () => { await Promise.resolve(); });
  rerender({ read: newRead });
  await act(async () => { pending.reject(new Error('stale')); await first; });
  expect(result.current.errors.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  act(() => { void result.current.loadDir('/repo'); });
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('an empty successful directory is cached, while a superseded timer never marks its replacement slow', async () => {
  vi.useFakeTimers();
  const old = deferred();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
  const { result } = renderHook(() => useDirectoryLoader(read));
  let first!: Promise<unknown>;
  act(() => { first = result.current.loadDir('/repo'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  await act(async () => { await result.current.loadDir('/repo', true); });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); old.resolve(row('old')); await first; });
  expect(result.current.slow.size).toBe(0);
  expect(result.current.entries.get('/repo')).toEqual([]);
  await act(async () => { await result.current.loadDir('/repo'); });
  expect(read).toHaveBeenCalledTimes(2);
});

it('handles synchronous and non-Error failures', async () => {
  const read = vi.fn(() => { throw 'failed'; });
  const { result } = renderHook(() => useDirectoryLoader(read));
  await act(async () => { await result.current.loadDir('/repo'); });
  expect(result.current.errors.get('/repo')).toBe('Failed to list directory');
  expect(result.current.loading.size).toBe(0);
});

it('survives StrictMode effect replay without accepting abandoned reads', async () => {
  const read = vi.fn(async () => row('current'));
  const { result } = renderHook(() => {
    const loader = useDirectoryLoader(read);
    React.useEffect(() => { loader.reset(); void loader.loadDir('/repo'); }, [loader.reset, loader.loadDir]);
    return loader;
  }, { wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode> });
  await act(async () => { await Promise.resolve(); });
  expect(result.current.entries.get('/repo')).toEqual(row('current'));
  expect(result.current.loading.size).toBe(0);
});
