// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';

vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {}, threads: {} } }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes, formatDuration } from './AgentBoard.js';
import { useUi } from '../store.js';

const worktreeAction = vi.fn();

const execution = {
  executionId: 'exec-1',
  projectId: 'p',
  jobTitle: 'Ship it',
  state: 'RUNNING',
  stateVersion: 3,
  createdAt: 1,
  updatedAt: 2,
  retainedWorktree: { path: '/tmp/wt', disposition: 'retained' }
} as unknown as ExecutionBoardProjection;

function openMenu() {
  render(<MemoryRouter><AgentBoardLanes cards={[]} executions={[execution]} onInspect={vi.fn()} /></MemoryRouter>);
  fireEvent.contextMenu(screen.getByText('Ship it').closest('button')!);
}

describe('AgentBoard retained worktree context actions', () => {
  let pushToast: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    worktreeAction.mockReset();
    pushToast = vi.fn();
    useUi.setState({ pushToast } as never);
    (window as unknown as { cc: unknown }).cc = { executionBoard: { worktreeAction } };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.confirm = vi.fn(() => true);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('Leave worktree sends the action with the current state version', async () => {
    worktreeAction.mockResolvedValue({ ok: true });
    openMenu();
    fireEvent.click(screen.getByText('Leave worktree'));
    await waitFor(() => expect(worktreeAction).toHaveBeenCalledWith('p', 'exec-1', 3, 'leave'));
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('toasts a rejected result', async () => {
    worktreeAction.mockResolvedValue({ ok: false, code: 'STALE', message: 'state changed' });
    openMenu();
    fireEvent.click(screen.getByText('Leave worktree'));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Squad worktree action failed: state changed', 'error'));
  });

  it('toasts an IPC rejection from Leave instead of leaving it unhandled', async () => {
    worktreeAction.mockRejectedValue(new Error('ipc down'));
    openMenu();
    fireEvent.click(screen.getByText('Leave worktree'));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Squad worktree action failed: ipc down', 'error'));
  });

  it('toasts a non-Error IPC rejection from Delete after confirmation', async () => {
    worktreeAction.mockRejectedValue('boom');
    openMenu();
    fireEvent.click(screen.getByText('Delete worktree'));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Squad worktree action failed: boom', 'error'));
    expect(worktreeAction).toHaveBeenCalledWith('p', 'exec-1', 3, 'delete');
  });

  it('does nothing when Delete is not confirmed', () => {
    window.confirm = vi.fn(() => false);
    openMenu();
    fireEvent.click(screen.getByText('Delete worktree'));
    expect(worktreeAction).not.toHaveBeenCalled();
  });

  it('falls back to the error code when a rejected result has no message', async () => {
    worktreeAction.mockResolvedValue({ ok: false, code: 'STALE' });
    openMenu();
    fireEvent.click(screen.getByText('Leave worktree'));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Squad worktree action failed: STALE', 'error'));
  });

  it('shows Dismiss for a finished run whose host is synthesized from the terminal execution', async () => {
    const dismiss = vi.fn().mockResolvedValue({ ok: true, value: { dismissedSessionIds: [] } });
    (window as unknown as { cc: unknown }).cc = { executionBoard: { worktreeAction, dismiss } };
    const finished = { ...execution, state: 'COMPLETED', retainedWorktree: undefined } as unknown as ExecutionBoardProjection;
    render(<MemoryRouter><AgentBoardLanes cards={[]} executions={[finished]} onInspect={vi.fn()} onDismissExecution={vi.fn()} /></MemoryRouter>);
    fireEvent.contextMenu(screen.getByText('Ship it').closest('button')!);
    expect(screen.queryByText('Leave worktree')).toBeNull();
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith('p', 'exec-1'));
  });
});

describe('formatDuration', () => {
  it('returns 0s for non-finite input and formats seconds, minutes and hours', () => {
    expect(formatDuration(Number.NaN)).toBe('0s');
    expect(formatDuration(5_000)).toBe('5s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_725_000)).toMatch(/^1h/);
  });
});
