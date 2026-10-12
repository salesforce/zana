/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ThreadListItem } from '../thread-store.js';

const openThreadInSplit = vi.hoisted(() => vi.fn());
vi.mock('../lib/split-layout/openThreadInSplit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/split-layout/openThreadInSplit.js')>()),
  openThreadInSplit
}));

import { ThreadCardMenu } from './threadCardActions.js';

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

afterEach(() => {
  cleanup();
  openThreadInSplit.mockReset();
});

describe('ThreadCardMenu split items', () => {
  it.each([
    ['Open in split', 'right'],
    ['Open in split below', 'bottom']
  ])('%s opens the thread on the %s side and closes the menu', async (label, side) => {
    const setMenu = vi.fn();
    render(
      <MemoryRouter initialEntries={['/agents']}>
        <ThreadCardMenu menu={{ thread, x: 8, y: 12 }} setMenu={setMenu} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    await vi.waitFor(() => expect(setMenu).toHaveBeenCalledWith(null));
    expect(openThreadInSplit).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: thread.id, currentPathname: '/agents', side })
    );
  });
});
