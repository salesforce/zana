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
import { MOBILE_THREAD_CONTROLS_ID } from './useMobileThreadTitleTarget.js';

const agent = agentFleetItem({ projectId: 'p', projectName: 'Project', state: 'idle',
  session: { id: 'cli', projectId: 'p', profile: 'claude', title: 'Terminal task', status: 'running', cwd: '/tmp', createdAt: 1 }
} as AgentCard);
const thread = threadFleetItem({ id: 'thread', projectId: 'p', title: 'Conversation task', status: 'idle', providerId: 'fake', createdAt: 1 } as ThreadListItem);
const cards = [agent, thread];
const monitor = (items = cards) => <MemoryRouter><AgentMonitor cards={items} /></MemoryRouter>;

beforeEach(() => {
  layout.compact = true;
  useUi.setState({ agentMonitor: null, agentsBoardView: 'flow', mobileAgentsBoardView: null });
  useData.setState({ projects: [], terminals: {}, agentsListOrganization: 'status', includeScheduledAgentsInAgentView: false });
});
afterEach(cleanup);

it('offers Canvas without inheriting desktop Flow and preserves each screen choice', () => {
  const { unmount } = render(<AgentViewToggle />);
  expect(screen.getAllByRole('button')).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Squads view' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: 'Board view' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Squads view' }));
  expect(useUi.getState().mobileAgentsBoardView).toBe('flow');
  expect(screen.getByRole('button', { name: 'Squads view' }).getAttribute('aria-pressed')).toBe('true');
  unmount();
  render(<AgentViewToggle />);
  expect(screen.getByRole('button', { name: 'Squads view' }).getAttribute('aria-pressed')).toBe('true');
  cleanup();
  const next = render(<AgentViewToggle />);
  layout.compact = false;
  next.rerender(<AgentViewToggle />);
  fireEvent.click(screen.getByRole('button', { name: 'List view' }));
  expect(useUi.getState().agentsBoardView).toBe('list');
  layout.compact = true;
  next.rerender(<AgentViewToggle />);
  expect(screen.getByRole('button', { name: 'Squads view' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Board view' }));
  expect(useUi.getState().agentsBoardView).toBe('list');
  expect(useUi.getState().mobileAgentsBoardView).toBe('board');
  fireEvent.click(screen.getByRole('button', { name: 'List view' }));
  expect(useUi.getState().mobileAgentsBoardView).toBe('list');
});

it('retains the usual mobile List default until the user chooses another view', () => {
  useUi.setState({ agentsBoardView: 'list' });
  render(<AgentViewToggle />);
  expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('true');
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

it('puts the mobile list Back action in the shell and restores focus after returning', () => {
  const { unmount } = render(<><div id={MOBILE_THREAD_CONTROLS_ID} data-testid="shell-controls" />{monitor()}</>);
  const row = screen.getByRole('button', { name: /Conversation task/ });
  fireEvent.click(row);
  const back = screen.getByRole('button', { name: 'Back to agents' });
  expect(screen.getByTestId('shell-controls').contains(back)).toBe(true);
  fireEvent.click(back);
  expect(screen.getByTestId('shell-controls').childElementCount).toBe(0);
  expect(document.activeElement).toBe(row);
  fireEvent.click(screen.getByRole('button', { name: /Terminal task/ }));
  expect(document.querySelector('.agent-monitor-main-head')).toBeNull();
  const slot = screen.getByTestId('shell-controls');
  unmount();
  expect(slot.childElementCount).toBe(0);
});
