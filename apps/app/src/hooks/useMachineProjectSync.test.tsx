// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMachineProjectSync } from './useMachineProjectSync.js';
const h = vi.hoisted(() => ({ read: vi.fn(), event: vi.fn(), reconnect: vi.fn(), off: vi.fn() }));
vi.mock('../lib/fetch-with-app-surface.js', () => ({ apiJson: h.read }));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductEvent: h.event, subscribeProductReconnect: h.reconnect }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('loads cached sync status, accepts only this machine and releases subscriptions', async () => {
  const initial = { hostId: 'remote', status: 'synced', lastSyncedAt: 10 };
  h.read.mockResolvedValue(initial); h.event.mockReturnValue(h.off); h.reconnect.mockReturnValue(h.off);
  const view = renderHook(() => useMachineProjectSync('remote', true));
  await waitFor(() => expect(view.result.current).toEqual(initial));
  expect(h.read).toHaveBeenCalledWith('/projects/sync-status?hostId=remote');
  await act(async () => h.event.mock.calls[0][1]({ hostId: 'other', status: 'offline' }));
  expect(view.result.current).toEqual(initial);
  await act(async () => h.event.mock.calls[0][1]({ ...initial, status: 'syncing' }));
  expect(view.result.current?.status).toBe('syncing');
  h.read.mockResolvedValue({ ...initial, lastSyncedAt: 20 });
  await act(async () => h.reconnect.mock.calls[0][0]()); expect(view.result.current?.lastSyncedAt).toBe(20);
  view.unmount(); expect(h.off).toHaveBeenCalledTimes(2);
});
it('ignores stale reads after live events or machine changes and preserves the last snapshot on read failure', async () => {
  let finish!: (value: unknown) => void;
  h.event.mockReturnValue(h.off); h.reconnect.mockReturnValue(h.off);
  h.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockRejectedValue(new Error('offline'));
  const view = renderHook(({ id }) => useMachineProjectSync(id), { initialProps: { id: 'first' } });
  await act(async () => h.event.mock.calls[0][1]({ hostId: 'first', status: 'synced', lastSyncedAt: 5 }));
  await act(async () => finish({ hostId: 'first', status: 'syncing', lastSyncedAt: null }));
  expect(view.result.current?.lastSyncedAt).toBe(5);
  await act(async () => h.reconnect.mock.calls[0][0]()); expect(view.result.current?.lastSyncedAt).toBe(5);
  view.rerender({ id: '' }); expect(view.result.current).toBeNull();
  view.rerender({ id: 'second' }); await act(async () => {}); expect(view.result.current).toBeNull();
});
