// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useThreads, type ThreadListItem } from '../../thread-store.js';
import { useData, useUi } from '../../store.js';

const threads = vi.hoisted(() => ({
  archive: vi.fn(async () => ({ ok: true })),
  closeFollowup: vi.fn(async (_id: string) => ({ ok: true, wrappingUp: undefined as boolean | undefined, keptOpen: undefined as 'asks-you' | undefined })),
  // The menu's notification-level control loads on open; these tests leave it loading.
  notificationLevel: vi.fn(() => new Promise(() => undefined))
}));
vi.mock('../../lib/product-client.js', () => ({ product: { threads } }));

import { ThreadDetailOverflow } from './ThreadDetailOverflow.js';

const id = '11111111-1111-4111-8111-111111111111';
const row = (activeBackgroundCommandCount: number): ThreadListItem => ({
  id,
  projectId: 'p1',
  hostId: 'h1',
  environmentId: null,
  providerId: 'claude-code',
  status: 'idle',
  title: 'hello',
  createdAt: 1,
  cwd: null,
  branchName: null,
  isWorktree: false,
  activity: {
    activeWorkflowCount: 0,
    activeBackgroundAgentCount: 0,
    activeBackgroundCommandCount,
    activeGoalCount: 0,
    activePlanModeCount: 0
  }
});

function stubConfirm(answer: boolean) {
  const confirm = vi.fn(() => answer);
  window.confirm = confirm;
  return confirm;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  threads.archive.mockClear();
  threads.closeFollowup.mockClear();
  useThreads.setState({ threads: [] });
  useData.setState({ closeWrapUpEnabled: false });
});

function choose(item: string) {
  render(<MemoryRouter><ThreadDetailOverflow threadId={id} title="hello" status="idle" projectId={null} /></MemoryRouter>);
  fireEvent.click(screen.getByTestId('thread-overflow-trigger'));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('ThreadDetailOverflow running-process warning', () => {
  it('warns before archiving a thread that still runs a background process', () => {
    useThreads.setState({ threads: [row(1)] });
    const confirm = stubConfirm(false);
    choose('Archive');
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Ending its session stops it.'));
    expect(threads.archive).not.toHaveBeenCalled();
  });

  it('warns before closing with follow-up too', () => {
    useThreads.setState({ threads: [row(2)] });
    const confirm = stubConfirm(false);
    choose('Close with follow-up');
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 background processes running'));
    expect(threads.closeFollowup).not.toHaveBeenCalled();
  });

  it('archives and drops the row once the warning is accepted', async () => {
    useThreads.setState({ threads: [row(1)] });
    stubConfirm(true);
    choose('Archive');
    expect(threads.archive).toHaveBeenCalledWith(id);
    await waitFor(() => expect(useThreads.getState().threads).toHaveLength(0));
  });

  it('closes with follow-up once the warning is accepted', async () => {
    useThreads.setState({ threads: [row(1)] });
    stubConfirm(true);
    choose('Close with follow-up');
    expect(threads.closeFollowup).toHaveBeenCalledWith(id);
    await waitFor(() => expect(useThreads.getState().threads).toHaveLength(0));
  });

  it('keeps the plain prompt when nothing is running', () => {
    useThreads.setState({ threads: [row(0)] });
    const confirm = stubConfirm(false);
    choose('Archive');
    expect(confirm).toHaveBeenCalledWith('Archive “hello”?');
  });

  it('uses the wrap-up confirm and keeps the thread while it wraps up', async () => {
    useData.setState({ closeWrapUpEnabled: true });
    useThreads.setState({ threads: [row(0)] });
    const pushToast = vi.fn();
    useUi.setState({ pushToast } as never);
    threads.closeFollowup.mockResolvedValueOnce({ ok: true, wrappingUp: true });
    const confirm = stubConfirm(true);
    choose('Close with follow-up');
    expect(confirm).toHaveBeenCalledWith('Close “hello” with follow-up? The agent first saves what it learnt and tidies up, then closes with a summary in your inbox. If it asks you something, it stays open.');
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Wrapping up… “hello” closes when it finishes.', 'info'));
    expect(useThreads.getState().threads).toHaveLength(1);
  });

  it('toasts that the thread is waiting on the user and keeps it when the route says it was left open', async () => {
    useData.setState({ closeWrapUpEnabled: true });
    useThreads.setState({ threads: [row(0)] });
    const pushToast = vi.fn();
    useUi.setState({ pushToast } as never);
    threads.closeFollowup.mockResolvedValueOnce({ ok: true, wrappingUp: undefined, keptOpen: 'asks-you' });
    stubConfirm(true);
    choose('Close with follow-up');
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('“hello” is waiting on your answer, so it was left open (see your inbox).', 'info'));
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining('Wrapping up'), expect.anything());
    expect(useThreads.getState().threads).toHaveLength(1);
  });

  it('keeps today\'s confirm text with the experiment off', () => {
    useThreads.setState({ threads: [row(0)] });
    const confirm = stubConfirm(false);
    choose('Close with follow-up');
    expect(confirm).toHaveBeenCalledWith('Close “hello” and file a follow-up if work is left?');
  });
});
