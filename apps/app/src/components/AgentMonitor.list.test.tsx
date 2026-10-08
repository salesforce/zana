// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ThreadListItem } from '../thread-store.js';
import type { AgentCard } from './AgentBoard.js';

vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => true }));
vi.mock('../views/threads/ThreadDetailView.js', () => ({ ThreadDetail: () => null }));
vi.mock('./AgentSessionView.js', () => ({ AgentSessionView: () => null }));
vi.mock('../lib/product-client.js', () => ({ product: { config: { set: vi.fn().mockResolvedValue({}) } } }));

import { AgentMonitor } from './AgentMonitor.js';
import { agentFleetItem, threadFleetItem, type FleetItem } from './fleet-item.js';
import { useData, useUi } from '../store.js';

const NOW = Date.now();

function thread(id: string, project: string, extra: Partial<ThreadListItem> = {}): FleetItem {
  return threadFleetItem(
    { id, projectId: project, title: `Thread ${id}`, status: 'idle', providerId: 'fake', createdAt: NOW - 3_600_000, lastReadSeq: 1, maxSeq: 1, ...extra } as ThreadListItem,
    { name: `proj-${project}`, color: '#123456' }
  );
}

const exitedAgent = agentFleetItem({
  projectId: 'a', projectName: 'proj-a', state: 'done',
  session: { id: 'done-1', projectId: 'a', profile: 'claude', title: 'Finished agent', status: 'exited', cwd: '/tmp', createdAt: NOW - 600_000, finishedAt: NOW - 120_000 }
} as AgentCard);

const items = [
  thread('a1', 'a', { updatedAt: NOW - 7_200_000 }),
  thread('a2', 'a', { updatedAt: NOW - 60_000, lastReadSeq: 1, maxSeq: 4 }),
  thread('b1', 'b', { updatedAt: NOW - 5 * 60_000 }),
  thread('c1', 'c', { updatedAt: NOW - 86_400_000 * 2, status: 'error' }),
  exitedAgent
];

const monitor = (cards = items, showProject = true) => (
  <MemoryRouter><AgentMonitor cards={cards} showProject={showProject} /></MemoryRouter>
);

const rowTitles = (root: HTMLElement) =>
  [...root.querySelectorAll('.agent-monitor-row-title')].map((el) => el.textContent);

beforeEach(() => {
  useUi.setState({ agentMonitor: null });
  useData.setState({ projects: [], terminals: {}, agentsListOrganization: 'status', includeScheduledAgentsInAgentView: false });
});
afterEach(cleanup);

it('groups rows by project inside a lane and folds single-item projects', () => {
  render(monitor());
  const idle = screen.getByRole('button', { name: /^Idle/ }).closest('.agent-monitor-group') as HTMLElement;
  const sections = [...idle.querySelectorAll('[data-project-section]')].map((el) => el.getAttribute('data-project-section'));
  expect(sections).toEqual(['a', 'other-projects']);
  const own = idle.querySelector('[data-project-section="a"]') as HTMLElement;
  expect(within(own).getByText('proj-a')).toBeTruthy();
  // Rows under a named project header don't repeat the name; folded rows do.
  expect(own.querySelectorAll('.agent-monitor-row-project')).toHaveLength(0);
  const other = idle.querySelector('[data-project-section="other-projects"]') as HTMLElement;
  expect([...other.querySelectorAll('.agent-monitor-row-project')].map((el) => el.textContent)).toEqual(['proj-b', 'proj-c']);
  expect(within(other).getByText('Error')).toBeTruthy();
});

it('shows relative ages and marks unread rows', () => {
  render(monitor());
  const unread = screen.getByRole('button', { name: /Thread a2/ });
  expect(unread.className).toContain('is-unread');
  expect(within(unread).getByLabelText('New activity')).toBeTruthy();
  expect(within(unread).getByText('1m')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Thread a1/ }).className).not.toContain('is-unread');
  expect(within(screen.getByRole('button', { name: /Thread c1/ })).getByText('2d')).toBeTruthy();
  // The repeated per-row kind chip is gone for threads.
  expect(within(unread).queryByTestId('fleet-kind-chip')).toBeNull();
});

it('filters to unread and shows an empty message when nothing is unread', () => {
  const { rerender } = render(monitor());
  const unreadChip = screen.getByRole('button', { name: /^Unread/ });
  expect(unreadChip.textContent).toContain('1');
  expect(screen.getByRole('button', { name: /^All/ }).textContent).toContain('5');
  fireEvent.click(unreadChip);
  expect(unreadChip.getAttribute('aria-pressed')).toBe('true');
  const list = screen.getByRole('navigation', { name: 'Agents' });
  expect(rowTitles(list)).toEqual(['Thread a2']);
  rerender(monitor(items.filter((i) => i.id !== 'a2')));
  expect(screen.getByText('No unread agents.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^All/ }));
  expect(screen.queryByText('No unread agents.')).toBeNull();
});

it('orders by recent activity without project headers', () => {
  render(monitor());
  const list = screen.getByRole('navigation', { name: 'Agents' });
  fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
  expect(screen.getByRole('button', { name: 'Recent' }).getAttribute('aria-pressed')).toBe('true');
  expect(list.querySelectorAll('[data-project-section]')).toHaveLength(0);
  expect(rowTitles(list)).toEqual(['Thread a2', 'Thread b1', 'Thread a1', 'Thread c1']);
  expect(list.querySelectorAll('.agent-monitor-row-project').length).toBe(4);
});

it('starts Done collapsed and toggles any group', () => {
  render(monitor());
  const done = screen.getByRole('button', { name: /^Done/ });
  expect(done.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Finished agent')).toBeNull();
  fireEvent.click(done);
  expect(done.getAttribute('aria-expanded')).toBe('true');
  const row = screen.getByRole('button', { name: /Finished agent/ });
  expect(within(row).getByText('2m')).toBeTruthy();
  expect(within(row).getByText(/^ran /)).toBeTruthy();
  const idle = screen.getByRole('button', { name: /^Idle/ });
  fireEvent.click(idle);
  expect(screen.queryByText('Thread a1')).toBeNull();
});

it('skips project headers in a single-project scope', () => {
  render(monitor(items.slice(0, 2), false));
  const list = screen.getByRole('navigation', { name: 'Agents' });
  expect(list.querySelectorAll('[data-project-section]')).toHaveLength(0);
  expect(list.querySelectorAll('.agent-monitor-row-project')).toHaveLength(0);
});
