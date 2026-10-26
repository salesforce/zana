// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project } from '@zana-ai/zcc-domain/product';
import { useProjectAvailability } from './useProjectAvailability.js';
const h = vi.hoisted(() => ({ read: vi.fn(), reconnect: vi.fn(), event: vi.fn((_type: string, _callback: (event: { status: string }) => void) => () => {}), off: vi.fn() }));
vi.mock('../lib/machine-project-client.js', () => ({ readProjectAvailability: h.read }));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductReconnect: h.reconnect, subscribeProductEvent: h.event }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const projects = [{ id: 'p', path: '/repo' }, { id: 'default', quickAgent: true }] as Project[];
it('refreshes on host state and explicit checks, excludes defaults, and unsubscribes', async () => {
  h.read.mockResolvedValue({ p: 'missing' }); h.reconnect.mockReturnValue(h.off);
  const view = renderHook(({ status, token }) => useProjectAvailability(projects, [{ id: 'host', status } as Host], token), { initialProps: { status: 'connected', token: 0 } });
  await waitFor(() => expect(view.result.current).toEqual({ p: 'missing' }));
  expect(h.read).toHaveBeenCalledWith(['p']);
  h.read.mockResolvedValue({ p: 'offline' }); view.rerender({ status: 'disconnected', token: 0 });
  await waitFor(() => expect(view.result.current).toEqual({ p: 'offline' }));
  h.read.mockResolvedValue({ p: 'ready' }); view.rerender({ status: 'connected', token: 1 });
  await waitFor(() => expect(view.result.current).toEqual({ p: 'ready' }));
  await act(async () => h.reconnect.mock.calls.at(-1)![0]());
  const callback = h.event.mock.calls.at(-1)![1] as (event: unknown) => void;
  const reads = h.read.mock.calls.length;
  await act(async () => callback({ status: 'syncing' }));
  expect(h.read).toHaveBeenCalledTimes(reads);
  await act(async () => callback({ status: 'synced' }));
  expect(h.read).toHaveBeenCalledTimes(reads + 1);
  view.unmount(); expect(h.off).toHaveBeenCalled();
});
it('ignores stale results and handles failed reads without inventing missing folders', async () => {
  let resolve!: (value: unknown) => void;
  h.read.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockRejectedValueOnce(new Error('offline'));
  h.reconnect.mockReturnValue(h.off);
  const view = renderHook(({ token }) => useProjectAvailability(projects, [], token), { initialProps: { token: 0 } });
  view.rerender({ token: 1 });
  await act(async () => resolve({ p: 'missing' }));
  expect(view.result.current).toEqual({});
});
