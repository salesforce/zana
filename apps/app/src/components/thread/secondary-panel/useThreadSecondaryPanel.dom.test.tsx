/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSecondaryPanel, useThreadSecondaryPanel } from './useThreadSecondaryPanel.js';
import { closableTabsToContract } from './threadTabsContract.js';
import { persistSecondaryPanel, emptySecondaryPanelState } from './threadSecondaryPanelState.js';

const { tabs, updateTabs, onTabs, useCompactLayout } = vi.hoisted(() => ({
  tabs: vi.fn(), updateTabs: vi.fn(), onTabs: vi.fn(), useCompactLayout: vi.fn(),
}));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: { tabs, updateTabs, onTabs } } }));
vi.mock('../../../hooks/useCompactLayout.js', () => ({ useCompactLayout }));
beforeEach(() => {
  localStorage.clear();
  useCompactLayout.mockReset().mockReturnValue(false);
  vi.useFakeTimers();
  tabs.mockReset().mockResolvedValue({ revision: 0, tabs: [] });
  updateTabs.mockReset().mockResolvedValue({ revision: 1, tabs: [] });
  onTabs.mockReset().mockReturnValue(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([false, true])('restores saved tabs but only restores open/maximized on desktop (compact=%s)', async (compact) => {
  useCompactLayout.mockReturnValue(compact);
  persistSecondaryPanel('thread-a', {
    ...emptySecondaryPanelState(), isOpen: true, isMaximized: true,
    activeId: 'saved', tabs: [{ id: 'saved', kind: 'new-tab', title: 'New Tab' }],
  });
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  expect(view.result.current.state).toMatchObject({
    isOpen: !compact, isMaximized: !compact, activeId: 'saved', tabs: [{ id: 'saved' }],
  });
});

it('lets the user open and hide the mobile panel, but closes it when revisiting a thread', async () => {
  useCompactLayout.mockReturnValue(true);
  const view = renderHook(({ owner }) => useThreadSecondaryPanel(owner), { initialProps: { owner: 'thread-a' } });
  await act(async () => {});
  act(() => view.result.current.openNewTab());
  const tabId = view.result.current.state.tabs[0].id;
  expect(view.result.current.state.isOpen).toBe(true);
  act(() => view.result.current.close());
  expect(view.result.current.state.isOpen).toBe(false);
  act(() => view.result.current.open());
  expect(view.result.current.state.isOpen).toBe(true);
  view.rerender({ owner: 'thread-b' });
  await act(async () => {});
  expect(view.result.current.state.isOpen).toBe(false);
  view.rerender({ owner: 'thread-a' });
  await act(async () => {});
  expect(view.result.current.state).toMatchObject({ isOpen: false, tabs: [{ id: tabId }] });
  act(() => view.result.current.open());
  view.unmount();
  const revisited = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  expect(revisited.result.current.state).toMatchObject({ isOpen: false, tabs: [{ id: tabId }] });
});

it.each([false, true])('keeps mobile closed during server hydration and SSE updates (compact=%s)', async (compact) => {
  useCompactLayout.mockReturnValue(compact);
  tabs.mockResolvedValue({ revision: 1, tabs: [{ id: 'hydrated', kind: 'new-tab' }] });
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  expect(view.result.current.state).toMatchObject({ isOpen: !compact, tabs: [{ id: 'hydrated' }] });
  act(() => onTabs.mock.calls[0][0]({ threadId: 'thread-a', revision: 2, tabs: [{ id: 'remote', kind: 'new-tab' }] }));
  expect(view.result.current.state).toMatchObject({ isOpen: !compact, tabs: [{ id: 'remote' }] });
  act(() => view.result.current.open());
  await act(async () => vi.advanceTimersByTime(300));
  act(() => onTabs.mock.calls[0][0]({ threadId: 'thread-a', revision: 3, tabs: [{ id: 'open-update', kind: 'new-tab' }] }));
  expect(view.result.current.state).toMatchObject({ isOpen: true, tabs: [{ id: 'open-update' }] });
  act(() => view.result.current.close());
  await act(async () => vi.advanceTimersByTime(300));
  act(() => onTabs.mock.calls[0][0]({ threadId: 'thread-a', revision: 4, tabs: [{ id: 'closed-update', kind: 'new-tab' }] }));
  expect(view.result.current.state).toMatchObject({ isOpen: !compact, tabs: [{ id: 'closed-update' }] });
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).not.toHaveBeenCalled();
});

it('closes on entry to compact layout without rehydrating or losing tabs', async () => {
  const pending = Promise.withResolvers<unknown>();
  tabs.mockReturnValueOnce(pending.promise);
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  useCompactLayout.mockReturnValue(true);
  view.rerender();
  await act(async () => pending.resolve({ revision: 1, tabs: [{ id: 'delayed', kind: 'new-tab' }] }));
  expect(view.result.current.state).toMatchObject({ isOpen: false, tabs: [{ id: 'delayed' }] });
  useCompactLayout.mockReturnValue(false);
  view.rerender();
  act(() => view.result.current.toggleMaximized());
  expect(view.result.current.state.isOpen).toBe(true);
  useCompactLayout.mockReturnValue(true);
  view.rerender();
  expect(view.result.current.state).toMatchObject({ isOpen: false, isMaximized: false, tabs: [{ id: 'delayed' }] });
  act(() => view.result.current.open());
  view.rerender();
  expect(view.result.current.state.isOpen).toBe(true);
  expect(tabs).toHaveBeenCalledOnce();
});

it('keeps default-open agent panels closed on mobile', () => {
  useCompactLayout.mockReturnValue(true);
  const view = renderHook(() => useSecondaryPanel('agent-a', { defaultOpen: true }));
  expect(view.result.current.state.isOpen).toBe(false);
  act(() => view.result.current.open());
  expect(view.result.current.state.isOpen).toBe(true);
});

it('hydrates the revision for cached tabs without overwriting local navigation', async () => {
  persistSecondaryPanel('thread-a', { ...emptySecondaryPanelState(), tabs: [{ id: 'local', kind: 'new-tab', title: 'New Tab' }] });
  const initial = Promise.withResolvers<unknown>();
  tabs.mockReturnValueOnce(initial.promise);
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(updateTabs).not.toHaveBeenCalled();
  await act(async () => initial.resolve({ revision: 208, tabs: [] }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(view.result.current.state.tabs[0].id).toBe('local');
  expect(updateTabs).toHaveBeenCalledWith('thread-a', { expectedRevision: 208, tabs: [{ id: 'local', kind: 'new-tab' }] });
});

it('refreshes and retries a stale revision once without losing the local edit', async () => {
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  tabs.mockResolvedValue({ revision: 9, tabs: [] });
  updateTabs.mockRejectedValueOnce(Object.assign(Error('conflict'), { status: 409 }));
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).toHaveBeenCalledTimes(2);
  expect(updateTabs.mock.calls[1][1]).toMatchObject({ expectedRevision: 9, tabs: [{ kind: 'new-tab' }] });
  expect(view.result.current.state.tabs).toHaveLength(1);
});

it('bounds repeated conflicts and does not echo server updates back to the server', async () => {
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  act(() => onTabs.mock.calls[0][0]({ threadId: 'thread-a', revision: 4, tabs: [{ kind: 'new-tab', id: 'remote' }] }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).not.toHaveBeenCalled();
  updateTabs.mockRejectedValue(Object.assign(Error('conflict'), { status: 409 }));
  tabs.mockResolvedValue({ revision: 5, tabs: [] });
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Record', moduleId: 'crm', actionId: 'record' }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTime(10000));
  expect(updateTabs).toHaveBeenCalledTimes(2);
});

it('waits for the new owner revision before writing cached tabs', async () => {
  const view = renderHook(({ owner }) => useThreadSecondaryPanel(owner), { initialProps: { owner: 'thread-a' } });
  await act(async () => {});
  const initial = Promise.withResolvers<unknown>();
  tabs.mockReturnValueOnce(initial.promise);
  view.rerender({ owner: 'thread-b' });
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(updateTabs).not.toHaveBeenCalled();
  await act(async () => initial.resolve({ revision: 6, tabs: [] }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).toHaveBeenCalledWith('thread-b', expect.objectContaining({ expectedRevision: 6 }));
});

it('keeps a newer SSE revision when a delayed hydration response arrives', async () => {
  const initial = Promise.withResolvers<unknown>();
  tabs.mockReturnValueOnce(initial.promise);
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  act(() => onTabs.mock.calls[0][0]({ threadId: 'thread-a', revision: 8, tabs: [{ id: 'latest', kind: 'new-tab' }] }));
  await act(async () => initial.resolve({ revision: 3, tabs: [] }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(view.result.current.state.tabs[0].id).toBe('latest');
  expect(updateTabs).not.toHaveBeenCalled();
});

it('rehydrates when returning to a thread before the next thread finished loading', async () => {
  const view = renderHook(({ owner }) => useThreadSecondaryPanel(owner), { initialProps: { owner: 'thread-a' } });
  await act(async () => {});
  const pendingB = Promise.withResolvers<unknown>();
  const pendingA = Promise.withResolvers<unknown>();
  tabs.mockReturnValueOnce(pendingB.promise).mockReturnValueOnce(pendingA.promise);
  view.rerender({ owner: 'thread-b' });
  view.rerender({ owner: 'thread-a' });
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(updateTabs).not.toHaveBeenCalled();
  await act(async () => pendingB.resolve({ revision: 99, tabs: [] }));
  await act(async () => pendingA.resolve({ revision: 7, tabs: [] }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).toHaveBeenCalledWith('thread-a', expect.objectContaining({ expectedRevision: 7 }));
});

it('does not retry a conflict when the server already has the desired tabs', async () => {
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  act(() => view.result.current.openNewTab());
  tabs.mockResolvedValue({ revision: 3, tabs: closableTabsToContract(view.result.current.state.tabs) });
  updateTabs.mockRejectedValueOnce(Object.assign(Error('conflict'), { status: 409 }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(updateTabs).toHaveBeenCalledOnce();
});

it('saves only the latest pending edit after refreshing a conflicting revision', async () => {
  const view = renderHook(() => useThreadSecondaryPanel('thread-a'));
  await act(async () => {});
  const refresh = Promise.withResolvers<unknown>();
  tabs.mockReturnValueOnce(refresh.promise);
  updateTabs.mockRejectedValueOnce(Object.assign(Error('conflict'), { status: 409 }));
  act(() => view.result.current.openNewTab());
  await act(async () => vi.advanceTimersByTime(300));
  act(() => view.result.current.addTab({ kind: 'plugin', title: 'Newer', moduleId: 'crm', actionId: 'record' }));
  await act(async () => vi.advanceTimersByTime(300));
  await act(async () => refresh.resolve({ revision: 5, tabs: [] }));
  expect(updateTabs).toHaveBeenCalledTimes(2);
  expect(updateTabs.mock.calls[1][1]).toMatchObject({ expectedRevision: 5, tabs: [{ title: 'Newer' }] });
});

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
