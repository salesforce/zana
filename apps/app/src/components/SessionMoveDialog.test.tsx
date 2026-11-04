/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../thread-store.js';

const api = vi.hoisted(() => ({ move: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { threads: {
  move: api.move, onUpdated: () => () => {}, onEvent: () => () => {}
} } }));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductEvent: () => () => {}, subscribeProductReconnect: () => () => {} }));
vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => [], primaryHost: () => ({ id: 'h1' }) }));
import { SessionMoveDialog } from './SessionMoveDialog.js';
import { Toaster } from './Toaster.js';
import { useData, useUi } from '../store.js';
import { useThreads } from '../thread-store.js';
import { sessionMoveReason, sessionNeedsStop, useSessionMove } from '../lib/session-move.js';

const projects = [
  { id: 'p1', name: 'Scratchpad', path: '/one' },
  { id: 'p2', name: 'Command Center', path: '/two' },
  { id: 'remote', name: 'Remote', path: '/remote', hostId: 'h2' }
] as Project[];
const thread: ThreadListItem = { id: 't1', projectId: 'p1', hostId: 'h1', environmentId: 'e1',
  providerId: 'fake', status: 'idle', title: 'Move me', createdAt: 1, cwd: '/one', branchName: null, isWorktree: false };
function CurrentPath() { return <output data-testid="path">{useLocation().pathname}</output>; }
function show(path = '/projects/p1/threads/t1') {
  return render(<MemoryRouter initialEntries={[path]}><SessionMoveDialog /><Toaster /><CurrentPath /></MemoryRouter>);
}
beforeEach(() => {
  api.move.mockReset().mockImplementation(async (_id, input) => ({ thread: { ...thread,
    projectId: input.projectId, cwd: input.projectId === 'p2' ? '/two' : '/one' } }));
  useData.setState({ projects });
  useThreads.setState({ threads: [thread] });
  useSessionMove.setState({ request: null, primaryHostId: 'h1' });
  useUi.setState({ toasts: [] });
});
afterEach(() => { cleanup(); useSessionMove.getState().close(); });

describe('session move dialog', () => {
  it('searches destinations and disables the current project and other machines', () => {
    useSessionMove.getState().open(thread.id);show();
    expect((screen.getByRole('button', { name: /Scratchpad.*Current project/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Remote.*Other machine/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search destination projects' }), { target: { value: 'none' } });
    expect(screen.getByText('No matching projects')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Command' } });
    expect((screen.getByRole('button', { name: /Command Center/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();expect(api.move).not.toHaveBeenCalled();
  });

  it('moves an idle session, follows the scoped route, expands the project, and provides working Undo', async () => {
    useSessionMove.getState().open(thread.id);show();
    fireEvent.click(screen.getByRole('button', { name: /Command Center/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.move).toHaveBeenCalledExactlyOnceWith('t1', { projectId: 'p2', expectedProjectId: 'p1', stop: false });
    expect(useThreads.getState().threads[0]?.projectId).toBe('p2');
    expect(screen.getByTestId('path').textContent).toBe('/projects/p2/threads/t1');
    expect(useUi.getState().projectExpanded.p2).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(2));
    expect(api.move).toHaveBeenLastCalledWith('t1', { projectId: 'p1', expectedProjectId: 'p2', stop: false });
  });

  it('preserves the global thread view when moving from outside project focus', async () => {
    useSessionMove.getState().open(thread.id, 'p2');show('/threads/t1');
    await waitFor(() => expect(api.move).toHaveBeenCalledOnce());
    expect(screen.getByTestId('path').textContent).toBe('/threads/t1');
  });

  it('requires confirmation for running sessions, allows cancel, then sends the explicit stop flag', async () => {
    useThreads.setState({ threads: [{ ...thread, status: 'active' }] });
    useSessionMove.getState().open(thread.id);show();
    fireEvent.click(screen.getByRole('button', { name: /Command Center/ }));
    expect(screen.getByRole('dialog', { name: 'Stop and move this session?' })).toBeTruthy();
    expect(api.move).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useSessionMove.getState().open(thread.id, 'p2'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop & move' }));
    await waitFor(() => expect(api.move).toHaveBeenCalledExactlyOnceWith('t1', { projectId: 'p2', expectedProjectId: 'p1', stop: true }));
  });

  it('asks for confirmation when a session started running after the picker opened', async () => {
    api.move.mockRejectedValueOnce(Object.assign(new Error('Running'), { code: 'session-running' }));
    useSessionMove.getState().open(thread.id, 'p2');show();
    await screen.findByRole('dialog', { name: 'Stop and move this session?' });
    expect(api.move).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Stop & move' }));
    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(2));
    expect(api.move.mock.calls[1]?.[1].stop).toBe(true);
  });

  it('keeps failures reviewable and allows choosing a destination again', async () => {
    api.move.mockRejectedValueOnce(new Error('Host is offline'));
    useSessionMove.getState().open(thread.id);show();
    fireEvent.click(screen.getByRole('button', { name: /Command Center/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Host is offline');
    expect(useThreads.getState().threads[0]?.projectId).toBe('p1');
    fireEvent.click(screen.getByRole('button', { name: /Command Center/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('prevents duplicate submissions and dismissal while a move is pending', async () => {
    let release!: (result: unknown) => void;
    api.move.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    useSessionMove.getState().open(thread.id);show();
    fireEvent.click(screen.getByRole('button', { name: /Command Center/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeTruthy();expect(api.move).toHaveBeenCalledOnce();
    await act(async () => release({ thread: { ...thread, projectId: 'p2' } }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('handles a vanished session', () => {
    useSessionMove.getState().open('missing');show();
    expect(screen.getByRole('dialog', { name: 'Session unavailable' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('treats background processes as running and uses explicit host bindings', () => {
    expect(sessionNeedsStop({ status: 'idle', activity: { activeBackgroundCommandCount: 1 } as ThreadListItem['activity'] })).toBe(true);
    expect(sessionNeedsStop({ status: 'idle', activity: { activeBackgroundAgentCount: 1 } as ThreadListItem['activity'] })).toBe(true);
    expect(sessionMoveReason(thread, { ...projects[1]!, hostId: 'h1' })).toBeNull();
    expect(sessionMoveReason(thread, { ...projects[1]!, remote: {} as Project['remote'] }, 'h1')).toBe('Other machine');
  });
});
