// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ThreadListItem } from '../thread-store.js';

const archive = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../lib/product-client.js', () => ({ product: { threads: { archive } } }));

import { ThreadArchiveQuickAction } from './threadCardActions.js';

const thread: ThreadListItem = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'p1',
  hostId: 'h1',
  environmentId: null,
  providerId: 'claude-code',
  status: 'idle',
  title: 'hello',
  createdAt: 1,
  cwd: null,
  branchName: null,
  isWorktree: false
};
const running: ThreadListItem = {
  ...thread,
  activity: {
    activeWorkflowCount: 0,
    activeBackgroundAgentCount: 0,
    activeBackgroundCommandCount: 2,
    activeGoalCount: 0,
    activePlanModeCount: 0
  }
};

function stubConfirm(answer: boolean) {
  const confirm = vi.fn(() => answer);
  window.confirm = confirm;
  return confirm;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  archive.mockClear();
});

function clickArchive(row: ThreadListItem) {
  render(<MemoryRouter><ThreadArchiveQuickAction thread={row} /></MemoryRouter>);
  fireEvent.click(screen.getByTestId('thread-archive-quick'));
}

describe('ThreadArchiveQuickAction', () => {
  it('archives in one click when nothing is running', () => {
    const confirm = stubConfirm(true);
    clickArchive(thread);
    expect(confirm).not.toHaveBeenCalled();
    expect(archive).toHaveBeenCalledWith(thread.id);
  });

  it('asks first while background processes are running, and stays put on cancel', () => {
    const confirm = stubConfirm(false);
    clickArchive(running);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 background processes running'));
    expect(archive).not.toHaveBeenCalled();
  });

  it('archives once the running-process warning is accepted', () => {
    stubConfirm(true);
    clickArchive(running);
    expect(archive).toHaveBeenCalledWith(thread.id);
  });
});
