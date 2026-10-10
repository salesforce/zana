// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useThreads, type ThreadListItem } from '../../thread-store.js';

const threads = vi.hoisted(() => ({ archive: vi.fn(async () => ({ ok: true })), closeFollowup: vi.fn(async () => ({ ok: true })) }));
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
  useThreads.setState({ threads: [] });
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

  it('keeps the plain prompt when nothing is running', () => {
    useThreads.setState({ threads: [row(0)] });
    const confirm = stubConfirm(false);
    choose('Archive');
    expect(confirm).toHaveBeenCalledWith('Archive “hello”?');
  });
});
