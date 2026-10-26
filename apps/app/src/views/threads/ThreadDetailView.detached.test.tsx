// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ threads: [{ id: 't-1', projectId: 'p-1' }] as Array<{ id: string; projectId: string }> }));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../../components/thread/DetachedThread.js', () => ({
  useThreadDetached: () => true,
  DetachedThread: ({ threadId, projectId }: { threadId: string; projectId: string | null }) => (
    <div data-testid="detached" data-thread={threadId} data-project={String(projectId)} />
  )
}));
vi.mock('../../thread-store.js', async (original) => ({
  ...(await original<object>()),
  useThreads: (pick: (state: { threads: typeof h.threads }) => unknown) => pick({ threads: h.threads })
}));

import { ThreadDetail } from './ThreadDetailView.js';

afterEach(cleanup);

it('shows the placeholder, with the thread project, for a thread open in its own window', () => {
  render(<ThreadDetail threadId="t-1" />);
  expect(screen.getByTestId('detached').dataset).toMatchObject({ thread: 't-1', project: 'p-1' });
});

it('targets a thread missing from the roster by id alone', () => {
  h.threads = [];
  render(<ThreadDetail threadId="t-2" />);
  expect(screen.getByTestId('detached').dataset).toMatchObject({ thread: 't-2', project: 'null' });
});
