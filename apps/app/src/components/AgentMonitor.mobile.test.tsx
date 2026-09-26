// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ThreadListItem } from '../thread-store.js';
import type { AgentCard } from './AgentBoard.js';

const layout = vi.hoisted(() => ({ compact: true }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => layout.compact }));
vi.mock('../views/threads/ThreadDetailView.js', () => ({
  ThreadDetail: ({ threadId }: { threadId: string }) => <div data-testid="live-thread">{threadId}</div>
}));
vi.mock('./AgentSessionView.js', () => ({
  AgentSessionView: ({ session }: { session: { id: string } }) => <div data-testid="live-terminal">{session.id}</div>
}));
vi.mock('../lib/product-client.js', () => ({ product: { config: { set: vi.fn().mockResolvedValue({}) } } }));

import { AgentMonitor } from './AgentMonitor.js';
import { AgentViewToggle, ScheduledColumnToggle } from './AgentViewToggle.js';
import { agentFleetItem, threadFleetItem } from './fleet-item.js';
import { useData, useUi } from '../store.js';

const agent = agentFleetItem({ projectId: 'p', projectName: 'Project', state: 'idle',
  session: { id: 'cli', projectId: 'p', profile: 'claude', title: 'Terminal task', status: 'running', cwd: '/tmp', createdAt: 1 }
} as AgentCard);
const thread = threadFleetItem({ id: 'thread', projectId: 'p', title: 'Conversation task', status: 'idle', providerId: 'fake', createdAt: 1 } as ThreadListItem);
const cards = [agent, thread];
const monitor = (items = cards) => <MemoryRouter><AgentMonitor cards={items} /></MemoryRouter>;

beforeEach(() => {
  layout.compact = true;
  useUi.setState({ agentMonitor: null, agentsBoardView: 'flow' });
  useData.setState({ projects: [], terminals: {}, agentsListOrganization: 'status', includeScheduledAgentsInAgentView: false });
});
afterEach(cleanup);

it('shows only Board and List on mobile and preserves the desktop Flow preference', () => {
  const { rerender } = render(<AgentViewToggle />);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Flow view' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Board view' }).getAttribute('aria-pressed')).toBe('true');
  expect(useUi.getState().agentsBoardView).toBe('flow');
  layout.compact = false;
  rerender(<AgentViewToggle />);
  expect(screen.getByRole('button', { name: 'Flow view' }).getAttribute('aria-pressed')).toBe('true');
  layout.compact = true;
  rerender(<AgentViewToggle />);
  fireEvent.click(screen.getByRole('button', { name: 'List view' }));
  expect(useUi.getState().agentsBoardView).toBe('list');
  expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Board view' }));
  expect(useUi.getState().agentsBoardView).toBe('board');
});

it('keeps scheduled agents independently toggleable on mobile', () => {
  const set = vi.fn();
  const original = useData.getState().setIncludeScheduledAgentsInAgentView;
  useData.setState({ setIncludeScheduledAgentsInAgentView: set });
  try {
    render(<ScheduledColumnToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Show scheduled agents' }));
    expect(set).toHaveBeenCalledWith(true);
    act(() => useData.setState({ includeScheduledAgentsInAgentView: true }));
    expect(screen.getByRole('button', { name: 'Hide scheduled agents' }).getAttribute('aria-pressed')).toBe('true');
  } finally { useData.setState({ setIncludeScheduledAgentsInAgentView: original }); }
});

it('mounts neither conversation nor terminal until tapped, then returns to the same list and focus', () => {
  useUi.setState({ agentMonitor: { sessionId: 'cli', projectId: 'p' } });
  render(monitor());
  const list = screen.getByRole('navigation', { name: 'Agents' });
  list.scrollTop = 180;
  expect(screen.queryByTestId('live-terminal')).toBeNull();
  expect(screen.queryByTestId('live-thread')).toBeNull();
  expect(useUi.getState().agentMonitor).toBeNull();
  const row = screen.getByRole('button', { name: /Conversation task/ });
  fireEvent.click(row);
  expect(screen.getByTestId('live-thread').textContent).toBe('thread');
  expect(list.hidden).toBe(true);
  expect(screen.queryByTestId('live-terminal')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to agents' }));
  expect(screen.queryByTestId('live-thread')).toBeNull();
  expect(list.hidden).toBe(false);
  expect(list.scrollTop).toBe(180);
  expect(document.activeElement).toBe(row);
  fireEvent.click(screen.getByRole('button', { name: /Terminal task/ }));
  expect(screen.getByTestId('live-terminal').textContent).toBe('cli');
  expect(useUi.getState().agentMonitor).toEqual({ sessionId: 'cli', projectId: 'p' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to agents' }));
  expect(screen.queryByTestId('live-terminal')).toBeNull();
  expect(useUi.getState().agentMonitor).toBeNull();
});

it('returns to the list if the selected item disappears without opening another agent', () => {
  const { rerender } = render(monitor());
  fireEvent.click(screen.getByRole('button', { name: /Conversation task/ }));
  rerender(monitor([agent]));
  expect(screen.queryByTestId('live-thread')).toBeNull();
  expect(screen.queryByTestId('live-terminal')).toBeNull();
  expect(screen.getByRole('navigation', { name: 'Agents' }).hidden).toBe(false);
  rerender(monitor());
  expect(screen.queryByTestId('live-thread')).toBeNull();
});

it('keeps the desktop split monitor and clears its selection when returning to mobile or unmounting', () => {
  layout.compact = false;
  const { rerender, unmount } = render(monitor());
  expect(screen.getByRole('navigation', { name: 'Agents' }).hidden).toBe(false);
  expect(screen.getByTestId('live-terminal')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Back to agents' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Conversation task/ }));
  expect(screen.getByTestId('live-thread')).toBeTruthy();
  layout.compact = true;
  rerender(monitor());
  expect(screen.queryByTestId('live-thread')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Terminal task/ }));
  unmount();
  expect(useUi.getState().agentMonitor).toBeNull();
});
