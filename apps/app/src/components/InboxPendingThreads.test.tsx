// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { ThreadListItem } from '../thread-store.js';
import { InboxPendingThreads, useInboxPendingThreads } from './InboxPendingThreads.js';

const load = vi.fn(async () => {});
const useThreads = create(() => ({ threads: [] as ThreadListItem[], load }));
vi.mock('../thread-store.js', () => ({ useThreads: (selector: Parameters<typeof useThreads>[0]) => useThreads(selector) }));

const projects = new Map([['one', 'Checkout'], ['two', 'Storefront']]);
function thread(id: string, projectId: string, fields: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    id, projectId, hostId: 'host', providerId: 'fake', environmentId: null, status: 'active',
    title: 'Review migration', createdAt: 1, cwd: null, branchName: null, isWorktree: false,
    hasPendingInteraction: true, ...fields
  };
}

afterEach(() => {
  cleanup();
  load.mockClear();
  useThreads.setState({ threads: [] });
});

it('uses the live pending roster and filters by project, visibility, and search', () => {
  const active = thread('active', 'one');
  const other = thread('other', 'two', { title: null });
  useThreads.setState({ threads: [
    active, other, thread('quiet', 'one', { hasPendingInteraction: false }),
    thread('archived', 'one', { archivedAt: 2 }), thread('hidden', 'one', { visibility: 'hidden' })
  ] });
  const { result, rerender } = renderHook(({ scope, query, enabled }) =>
    useInboxPendingThreads(enabled, scope, query, projects),
  { initialProps: { scope: null as string | null, query: '', enabled: false } });
  expect(result.current).toEqual([]);
  expect(load).not.toHaveBeenCalled();
  rerender({ scope: null, query: 'untitled', enabled: true });
  expect(result.current).toEqual([other]);
  expect(load).toHaveBeenCalledOnce();
  rerender({ scope: 'one', query: ' CHECKOUT ', enabled: true });
  expect(result.current).toEqual([active]);
  act(() => useThreads.setState({ threads: [{ ...active, hasPendingInteraction: false }, other] }));
  expect(result.current).toEqual([]);
});

it('links to the existing thread route in either Inbox scope', () => {
  const request = thread('approval', 'one', { title: null });
  const view = render(<MemoryRouter><InboxPendingThreads threads={[]} projectNames={projects} scope={null} /></MemoryRouter>);
  expect(screen.queryByRole('link')).toBeNull();
  view.rerender(<MemoryRouter><InboxPendingThreads threads={[request]} projectNames={projects} scope={null} /></MemoryRouter>);
  expect(screen.getByText('Untitled thread')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Review in thread' }).getAttribute('href')).toBe('/threads/approval');
  view.rerender(<MemoryRouter><InboxPendingThreads threads={[request]} projectNames={projects} scope="one" /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Review in thread' }).getAttribute('href')).toBe('/projects/one/threads/approval');
});
