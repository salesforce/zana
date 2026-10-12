// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useShallow } from 'zustand/react/shallow';
const harness = vi.hoisted(() => ({ event: (_: unknown) => {}, updated: (_: unknown) => {}, reconnect: () => {}, list:vi.fn(async () => [] as unknown[]) }));
vi.mock('./lib/product-client.js', () => ({ product: { threads: {
  onEvent: (fn: typeof harness.event) => { harness.event = fn; }, onUpdated: (fn: typeof harness.updated) => { harness.updated = fn; }, list:harness.list
} } }));
vi.mock('./lib/product-ws.js', () => ({ subscribeProductReconnect: (fn: typeof harness.reconnect) => { harness.reconnect = fn; } }));
import { useThreads, onThreadArchived, pendingChildThreads, type ThreadListItem } from './thread-store.js';
const row = (id: string, projectId = 'p1') => ({ id, projectId, hostId: 'h', environmentId: null, providerId: 'codex', status: 'idle', title: id, createdAt: 1, cwd: null, branchName: null, isWorktree: false, maxSeq: 0 } as ThreadListItem);
beforeEach(() => { vi.useFakeTimers(); useThreads.setState({ threads: [] }); useThreads.getState().upsert(row('a')); useThreads.getState().upsert(row('b','p2')); });
afterEach(() => { act(() => vi.runOnlyPendingTimers()); cleanup(); vi.useRealTimers(); });

it('coalesces a200-event burst into one notification and applies it to the latest metadata', () => {
  const listener = vi.fn(); const off = useThreads.subscribe(listener);
  for (let sequence = 1; sequence <= 200; sequence++) harness.event({ threadId: 'a', sequence });
  expect(listener).not.toHaveBeenCalled();
  harness.updated({ ...useThreads.getState().threads.find(row => row.id === 'a')!, title: 'Newest title' });
  listener.mockClear();
  const unaffected = useThreads.getState().threads.find(row => row.id === 'b');
  act(() => vi.advanceTimersByTime(100));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(useThreads.getState().threads.find(row => row.id === 'a')).toMatchObject({ title: 'Newest title', maxSeq: 200 });
  expect(useThreads.getState().threads.find(row => row.id === 'b')).toBe(unaffected);
  off();
});
it('makes progress under sustained events and ignores invalid, unknown and stale sequences', () => {
  const listener = vi.fn(); const off = useThreads.subscribe(listener);
  act(() => {
    for (let sequence=1; sequence<=40;sequence++) { harness.event({ threadId: 'a', sequence }); vi.advanceTimersByTime(25); }
  });
  expect(listener).toHaveBeenCalledTimes(10);
  expect(useThreads.getState().threads.find(row => row.id === 'a')!.maxSeq).toBe(40);
  listener.mockClear();
  [null, {}, { threadId: 'a', sequence: NaN }, { threadId: 'a', sequence: 0 }, { threadId: 'a', sequence:1.1 }, { threadId: 'missing', sequence:100 }, { threadId: 'a', sequence:30 }].forEach(harness.event);
  act(() => vi.advanceTimersByTime(100));
  expect(listener).not.toHaveBeenCalled(); off();
});
it('keeps unrelated project rails and pending-child selectors from rerendering', () => {
  const renders = { project: 0, children: 0 };
  function Rail() { useThreads(useShallow(state => state.threads.filter(row => row.projectId === 'p2'))); renders.project++; return null; }
  function Children() { useThreads(useShallow(state => pendingChildThreads(state.threads,'b'))); renders.children++; return null; }
  render(<><Rail /><Children /></>);
  act(() => { harness.event({ threadId: 'a', sequence:1 }); vi.advanceTimersByTime(100); });
  expect(renders).toEqual({ project:1, children:1 });
  act(() => harness.updated({ ...row('child','p2'), parentThreadId:'b', hasPendingInteraction:true }));
  expect(renders).toEqual({ project:2, children:2 });
});

it('reloads authoritative metadata on reconnect and keeps it on a failed reload', async () => {
  harness.list.mockResolvedValueOnce([row('live'),{ ...row('archived'),archivedAt:1 }]);
  await act(async () => { harness.reconnect(); });
  expect(useThreads.getState().threads.map(row => row.id)).toEqual(['live']);
  harness.list.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { harness.updated(null); });
  expect(useThreads.getState().loading).toBe(false);
  expect(useThreads.getState().threads.map(row => row.id)).toEqual(['live']);
  useThreads.getState().remove('live'); expect(useThreads.getState().threads).toHaveLength(0);
});

it('signals a roster thread turning archived, but not an unknown or already-archived one', () => {
  const listener = vi.fn();
  const off = onThreadArchived(listener);
  harness.updated({ ...row('a'), title: 'renamed' });
  expect(listener).not.toHaveBeenCalled();
  harness.updated({ ...row('a'), archivedAt: 5 });
  expect(listener).toHaveBeenCalledExactlyOnceWith('a');
  expect(useThreads.getState().threads.some((thread) => thread.id === 'a')).toBe(false);
  harness.updated({ ...row('a'), archivedAt: 6 });
  harness.updated({ ...row('never-listed'), archivedAt: 6 });
  expect(listener).toHaveBeenCalledTimes(1);
  off();
  harness.updated({ ...row('b', 'p2'), archivedAt: 7 });
  expect(listener).toHaveBeenCalledTimes(1);
});
