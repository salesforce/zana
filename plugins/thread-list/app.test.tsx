// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThreadList, groupThreads } from './app.tsx';

const state = vi.hoisted(() => ({ status: 'ready', threads: [] as any[], projects: [{ id: 'p', name: 'Project' }] }));
const actions = vi.hoisted(() => ({ open: vi.fn(), openNewThread: vi.fn(), setPinned: vi.fn(), setRead: vi.fn(),
  rename: vi.fn(), archive: vi.fn(), stop: vi.fn(), closeFollowup: vi.fn() }));
const split = vi.hoisted(() => ({ isAvailable: true, splitProps: {}, openInSplit: vi.fn(), consumeClick: vi.fn(() => false) }));
vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({
  definePluginApp: (setup: unknown) => ({ setup }),
  experimental_useSidebarThreads: () => state,
  experimental_useSidebarThreadActions: () => actions,
  experimental_useSidebarThreadSplit: () => split
}));
const props = { pluginId: 'thread-list', activeThreadId: 't', activeProjectId: null, searchQuery: '', isCompactViewport: false, onNavigate: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  split.isAvailable = true;
  split.consumeClick.mockReturnValue(false);
  for (const action of [actions.setPinned, actions.setRead, actions.rename, actions.archive, actions.stop, actions.closeFollowup]) action.mockResolvedValue(undefined);
  state.status = 'ready';
  state.threads = [{ id: 't', projectId: 'p', title: 'Alpha', providerId: 'codex', status: 'active', createdAt: 1, maxSeq: 5, lastReadSeq: 0 }];
});
it('handles read pinned threads, missing titles, and pending interaction status', async () => {
  state.threads = [{ ...state.threads[0], title: null, status: 'error', pinnedAt: 1, maxSeq: undefined, lastReadSeq: undefined, hasPendingInteraction: true }];
  render(<ThreadList {...props} activeThreadId={null} />);
  expect(screen.getByText('Needs you')).toBeTruthy();
  expect(screen.queryByLabelText('Unread')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Untitled agent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unpin', exact: true }));
  await waitFor(() => expect(actions.setPinned).toHaveBeenCalledWith('t', false));
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Untitled agent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark unread', exact: true }));
  await waitFor(() => expect(actions.setRead).toHaveBeenCalledWith('t', false));
});
it('consumes drag clicks, cancels menus, opens splits and falls back when splits are unavailable', () => {
  const view = render(<ThreadList {...props} />);
  split.consumeClick.mockReturnValueOnce(true);
  fireEvent.click(screen.getByTestId('thread-list-entry'));
  expect(actions.open).not.toHaveBeenCalled();
  fireEvent.contextMenu(screen.getByTestId('thread-list-entry'));
  fireEvent.click(screen.getByRole('button', { name: 'Open in split' }));
  expect(split.openInSplit).toHaveBeenCalledOnce();
  fireEvent.contextMenu(screen.getByTestId('thread-list-entry'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('group')).toBeNull();
  split.isAvailable = false;
  view.rerender(<ThreadList {...props} />);
  fireEvent.click(screen.getByTestId('thread-list-entry'), { metaKey: true });
  expect(actions.open).toHaveBeenCalledWith('t');
  fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
  expect(actions.openNewThread).toHaveBeenCalledWith(undefined);
});
it('shows failed loads and blank rename validation, and orders pins deterministically', () => {
  const view = render(<ThreadList {...props} />);
  fireEvent.contextMenu(screen.getByTestId('thread-list-entry'));
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  expect(actions.rename).not.toHaveBeenCalled();
  state.threads = []; state.status = 'error';
  view.rerender(<ThreadList {...props} />);
  expect(screen.getByText('Could not load threads.')).toBeTruthy();
  const pins = [{ id: 'b', pinnedAt: 2 }, { id: 'a', pinnedAt: 2 }, { id: 'c', pinnedAt: 3, pinOrder: 0 }]
    .map(pin => ({ ...pin, projectId: 'p', title: 'Pin', providerId: 'codex', status: 'idle', createdAt: 1 }));
  expect(groupThreads(pins, [], null, '')[0].threads.map(thread => thread.id)).toEqual(['c', 'a', 'b']);
});
afterEach(cleanup);
it('groups pins separately, scopes projects, and searches title, project and branch', () => {
  const threads = [...state.threads, { ...state.threads[0], id: 'pin', pinnedAt: 1 }, { ...state.threads[0], id: 'other', projectId: 'q', branchName: 'fix' }];
  expect(groupThreads(threads, state.projects, null, '').map(group => group.id)).toEqual(['pinned', 'p', 'q']);
  expect(groupThreads(threads, state.projects, 'q', 'fix')[0].threads[0].id).toBe('other');
  expect(groupThreads(threads, state.projects, null, 'project').flatMap(group => group.threads)).toHaveLength(2);
  expect(groupThreads(threads, state.projects, 'p', 'missing')).toEqual([]);
});
it('searches, reacts to roster changes, opens scoped new threads and supports split clicks', () => {
  const view = render(<ThreadList {...props} />);
  fireEvent.click(screen.getByTestId('thread-list-entry'));
  expect(actions.open).toHaveBeenCalledWith('t');
  fireEvent.click(screen.getByTestId('thread-list-entry'), { ctrlKey: true });
  expect(split.openInSplit).toHaveBeenCalled();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beta' } });
  expect(screen.queryByTestId('thread-list-entry')).toBeNull();
  state.threads = [{ ...state.threads[0], title: 'Beta', status: 'idle' }];
  view.rerender(<ThreadList {...props} activeProjectId="p" />);
  expect(screen.getByText('Beta')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
  expect(actions.openNewThread).toHaveBeenCalledWith({ projectId: 'p' });
});
it('renames inline and keeps errors visible without discarding the draft', async () => {
  render(<ThreadList {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Thread name' }), { target: { value: 'Renamed' } });
  actions.rename.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Thread name' }).getAttribute('value')).toBe('Renamed');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Thread name' })).toBeNull());
  expect(actions.rename).toHaveBeenLastCalledWith('t', 'Renamed');
});
it.each([['Pin', 'setPinned', true], ['Mark read', 'setRead', true], ['Stop', 'stop'], ['Archive', 'archive'], ['Close with follow-up', 'closeFollowup']] as const)
  ('routes %s through host actions', async (label, method, value) => {
    render(<ThreadList {...props} />);
    fireEvent.contextMenu(screen.getByTestId('thread-list-entry'));
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    await waitFor(() => expect(actions[method]).toHaveBeenCalledWith(...(value === undefined ? ['t'] : ['t', value])));
  });
it('shows loading and empty states and dismisses the actions with Escape', () => {
  const view = render(<ThreadList {...props} />);
  fireEvent.contextMenu(screen.getByTestId('thread-list-entry'));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Thread actions' })).toBeNull();
  state.threads = []; state.status = 'loading';
  view.rerender(<ThreadList {...props} />);
  expect(screen.getByText('Loading threads…')).toBeTruthy();
  state.status = 'ready'; view.rerender(<ThreadList {...props} />);
  expect(screen.getByText('No threads yet')).toBeTruthy();
});
it.each([['host-reconnecting', 'Reconnecting'], ['waiting-for-host', 'Waiting for host'], ['pending', 'Not started'], ['provisioning', 'Starting']])
  ('does not label %s as idle', (status, label) => {
    state.threads = [{ ...state.threads[0], status }];
    render(<ThreadList {...props} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Idle')).toBeNull();
  });
