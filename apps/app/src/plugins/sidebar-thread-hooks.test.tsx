// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSidebarThreads, useSidebarThreadActions, useSidebarThreadSplit } from './sidebar-thread-hooks.js';
import { useThreads } from '../thread-store.js';
import { useData } from '../store.js';
import { product } from '../lib/product-client.js';

const navigate = vi.hoisted(() => vi.fn());
const runMenu = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ isProjectFocused: true, focusedProjectId: 'p' }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ pathname: '/projects/p/threads/t' }) }));
vi.mock('../hooks/useRouteState.js', () => ({ useRouteState: () => route }));
vi.mock('../hooks/useIsCompactViewport.js', () => ({ useIsCompactViewport: () => false }));
vi.mock('../components/sidebar/useThreadRowSplitDrag.js', () => ({ useThreadRowSplitDrag: () => ({ openInSplit: vi.fn(), consumeClick: () => false, onPointerDown: vi.fn() }) }));
vi.mock('../components/threadCardActions.js', () => ({ runThreadMenuAction: (...args: unknown[]) => runMenu(...args) }));
vi.mock('../store.js', async () => {
  const { create } = await import('zustand');
  return { useData: create(() => ({ projects: [{ id: 'p', name: 'Project', path: '/not-exposed' }] })) };
});
vi.mock('../lib/product-client.js', () => ({ product: { threads: {
  pin: vi.fn(), unpin: vi.fn(), read: vi.fn(), unread: vi.fn(), rename: vi.fn(),
  stop: vi.fn(), fork: vi.fn(), archive: vi.fn(), closeFollowup: vi.fn(),
  list: vi.fn(async () => []), onUpdated: vi.fn(), onEvent: vi.fn()
} } }));
const row = { id: 't', projectId: 'p', title: 'Before', providerId: 'codex', status: 'idle', createdAt: 1, hostId: 'h', environmentId: 'e', cwd: '/private', branchName: 'main', isWorktree: false };
beforeEach(() => {
  vi.clearAllMocks();
  route.isProjectFocused = true;
  useThreads.setState({ threads: [row], loading: false, load: vi.fn(async () => undefined) });
});
afterEach(cleanup);
it('subscribes to thread and project changes and exposes a bounded display projection', () => {
  const { result } = renderHook(useSidebarThreads);
  expect(result.current.threads[0].title).toBe('Before');
  expect(result.current.threads[0]).not.toHaveProperty('cwd');
  act(() => useThreads.getState().upsert({ ...row, title: 'After', runtime: { displayStatus: 'waiting-for-host', hostReconnectGraceExpiresAt: null } }));
  expect(result.current.threads[0]).toMatchObject({ title: 'After', status: 'waiting-for-host' });
  act(() => useData.setState({ projects: [{ id: 'p', name: 'Renamed project' }] as never }));
  expect(result.current.projects).toEqual([{ id: 'p', name: 'Renamed project' }]);
  act(() => useThreads.setState({ loading: true, threads: [{ ...row, archivedAt: 10 }] }));
  expect(result.current.status).toBe('loading');
  expect(result.current.threads).toEqual([]);
});
it('keeps project scope and routes mutations through the product API', async () => {
  const { result } = renderHook(useSidebarThreadActions);
  result.current.open('t'); expect(navigate).toHaveBeenLastCalledWith('/projects/p/threads/t');
  result.current.openNewThread(); expect(navigate).toHaveBeenLastCalledWith('/projects/p/threads/new');
  result.current.openNewThread({ projectId: 'q' }); expect(navigate).toHaveBeenLastCalledWith('/projects/q/threads/new');
  await result.current.setPinned('t', true); expect(product.threads.pin).toHaveBeenCalledWith('t');
  await result.current.setPinned('t', false); expect(product.threads.unpin).toHaveBeenCalledWith('t');
  await result.current.setRead('t', true); expect(product.threads.read).toHaveBeenCalledWith('t');
  await result.current.setRead('t', false); expect(product.threads.unread).toHaveBeenCalledWith('t');
  await result.current.rename('t', 'New'); expect(product.threads.rename).toHaveBeenCalledWith('t', 'New');
  expect(useThreads.getState().load).toHaveBeenCalledTimes(5);
  await result.current.archive('t'); await result.current.stop('t'); await result.current.closeFollowup('t');
  expect(runMenu.mock.calls.map(call => call[0])).toEqual(['archive', 'stop', 'close-followup']);
  const context = runMenu.mock.calls[0][2]; context.remove('t');
  await expect(result.current.archive('t')).rejects.toThrow('no longer available');
});
it('exposes the host split handlers', () => {
  const { result } = renderHook(() => useSidebarThreadSplit('t'));
  expect(result.current.isAvailable).toBe(true);
  expect(result.current.splitProps.onPointerDown).toBeTypeOf('function');
  expect(result.current.consumeClick?.()).toBe(false);
});
it('uses global routes outside a project and retains host confirmation for destructive actions', async () => {
  route.isProjectFocused = false;
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    const { result } = renderHook(useSidebarThreadActions);
    result.current.open('t'); expect(navigate).toHaveBeenLastCalledWith('/threads/t');
    result.current.openNewThread(); expect(navigate).toHaveBeenLastCalledWith('/threads/new');
    await result.current.archive('t');
    expect(runMenu.mock.calls[0][2].confirm('Archive?')).toBe(false);
    expect(confirmation).toHaveBeenCalledWith('Archive?');
    const split = renderHook(() => useSidebarThreadSplit('missing'));
    expect(split.result.current.isAvailable).toBe(true);
  } finally { confirmation.mockRestore(); }
});
