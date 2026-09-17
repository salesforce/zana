/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useThreadSecondaryPanel } from './useThreadSecondaryPanel.js';
import { closableTabsToContract } from './threadTabsContract.js';

const { tabs, updateTabs, onTabs } = vi.hoisted(() => ({
  tabs: vi.fn(), updateTabs: vi.fn(), onTabs: vi.fn(),
}));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: { tabs, updateTabs, onTabs } } }));
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  tabs.mockReset().mockResolvedValue({ revision: 0, tabs: [] });
  updateTabs.mockReset().mockResolvedValue({ revision: 1, tabs: [] });
  onTabs.mockReset().mockReturnValue(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('preserves a newly opened plugin panel when an earlier tab write is echoed', async () => {
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  act(() => view.result.current.openNewTab());
  const earlierTabs = closableTabsToContract(view.result.current.state.tabs);
  const sent = Promise.withResolvers<{ revision: number; tabs: typeof earlierTabs }>();
  updateTabs.mockReturnValueOnce(sent.promise);
  await act(async () => vi.advanceTimersByTime(300));
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Record', moduleId: 'crm', actionId: 'record' }));
  const onChanged = onTabs.mock.calls[0][0];
  await act(async () => {
    onChanged({ threadId: 'thread-a', revision: 1, tabs: earlierTabs });
    sent.resolve({ revision: 1, tabs: earlierTabs });
  });
  expect(view.result.current.state.tabs).toMatchObject([{ kind: 'plugin', actionId: 'record' }]);
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).toHaveBeenLastCalledWith('thread-a', expect.objectContaining({
    expectedRevision: 1,
    tabs: [expect.objectContaining({ kind: 'plugin-panel', actionId: 'record' })],
  }));
});

it('serializes concurrent saves and advances the expected server revision', async () => {
  const sent = Promise.withResolvers<{ revision: number; tabs: [] }>();
  updateTabs.mockReturnValueOnce(sent.promise);
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(300));
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Record', moduleId: 'crm', actionId: 'record' }));
  await act(async () => vi.advanceTimersByTime(300));
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Query', moduleId: 'crm', actionId: 'query' }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).toHaveBeenCalledTimes(1);
  await act(async () => sent.resolve({ revision: 3, tabs: [] }));
  expect(updateTabs).toHaveBeenCalledTimes(2);
  expect(updateTabs.mock.calls[1][1].expectedRevision).toBe(3);
  expect(updateTabs.mock.calls[1][1].tabs).toHaveLength(2);
});

it('preserves local navigation during delayed initial hydration', async () => {
  const initial = Promise.withResolvers<unknown>();
  tabs.mockReturnValueOnce(initial.promise);
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Record', moduleId: 'crm', actionId: 'record' }));
  await act(async () => initial.resolve({ revision: 4, tabs: [{ kind: 'new-tab', id: 'old' }] }));
  expect(view.result.current.state.tabs[0].kind).toBe('plugin');
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs.mock.calls[0][1].expectedRevision).toBe(4);
});

it('applies newer remote tabs once local edits are saved, including after a no-op selection', async () => {
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  act(() => view.result.current.selectPin('info'));
  await act(async () => vi.advanceTimersByTime(300));
  act(() => view.result.current.selectPin('info'));
  const receive = onTabs.mock.calls[0][0];
  act(() => {
    receive(null);
    receive({ threadId: 'other', revision: 100, tabs: [] });
    receive({ threadId: 'thread-a', revision: 1, tabs: [] });
    receive({ threadId: 'thread-a', revision: 2, tabs: [{ id: 'remote', kind: 'new-tab' }] });
  });
  expect(view.result.current.state.tabs).toMatchObject([{ id: 'remote', kind: 'new-tab' }]);
});

it('recovers from a failed write on the next local change', async () => {
  updateTabs.mockRejectedValueOnce(Error('Offline'));
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(300));
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Record', moduleId: 'crm', actionId: 'record' }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).toHaveBeenCalledTimes(2);
  expect(updateTabs.mock.calls[1][1].tabs[0].kind).toBe('plugin-panel');
});

it('ignores old owner save completions and queued writes after switching threads', async () => {
  const sent = Promise.withResolvers<{ revision: number; tabs: [] }>();
  updateTabs.mockReturnValueOnce(sent.promise);
  const view = renderHook(({ owner }) => useThreadSecondaryPanel(owner), { initialProps: { owner: 'thread-a' } });
  await act(async () => {});
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(300));
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Record', moduleId: 'crm', actionId: 'record' }));
  await act(async () => vi.advanceTimersByTime(300));
  view.rerender({ owner: 'thread-b' });
  await act(async () => {});
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(300));
  await act(async () => sent.resolve({ revision: 10, tabs: [] }));
  expect(updateTabs.mock.calls.map(([id]) => id)).toEqual(['thread-a', 'thread-b']);
  expect(updateTabs.mock.calls[1][1].expectedRevision).toBe(0);
});

it('drops pending writes and removes the event subscription on unmount', async () => {
  const sent = Promise.withResolvers<{ revision: number; tabs: [] }>();
  const unsubscribe = vi.fn();
  onTabs.mockReturnValue(unsubscribe);
  updateTabs.mockReturnValueOnce(sent.promise);
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(300));
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Record', moduleId: 'crm', actionId: 'record' }));
  await act(async () => vi.advanceTimersByTime(300));
  view.unmount();
  await act(async () => sent.resolve({ revision: 1, tabs: [] }));
  expect(updateTabs).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledOnce();
});
