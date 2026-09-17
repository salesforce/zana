// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry, Project } from '@zana-ai/zcc-domain/product';
import type { AgentCard } from '../AgentBoard.js';
import type { ThreadListItem } from '../../thread-store.js';

const calls = vi.hoisted(() => ({ cards: [] as AgentCard[], inspectThread: vi.fn(), inspectAgentSession: vi.fn(), focusInboxEntry: vi.fn() }));
vi.mock('../../hooks/useAgentCards.js', () => ({ useAllAgentCards: () => calls.cards }));
vi.mock('../../lib/inspect-session.js', () => ({ inspectThread: calls.inspectThread, inspectAgentSession: calls.inspectAgentSession }));
vi.mock('../../lib/inboxNavigation.js', () => ({ focusInboxEntry: calls.focusInboxEntry }));

import { useUi, useData, useInbox, useInboxRead, useFavoriteAgents, favoriteKey } from '../../store.js';
import { useThreads } from '../../thread-store.js';
import { FavoriteAgentsDrawer, sectionOfThread } from '../FavoriteAgentsDrawer.js';
import { NotificationsDrawer } from '../NotificationsDrawer.js';

function entry(id: string, props: Partial<InboxEntry> = {}): InboxEntry {
  return { id, projectId: 'p1', ts: Date.UTC(2026, 8, 17), subject: id, docs: [], ...props } as InboxEntry;
}
function card(id: string, props: Partial<AgentCard> = {}, session: Partial<AgentCard['session']> = {}): AgentCard {
  return { projectId: 'p1', projectName: 'Design', state: 'idle', ...props,
    session: { id, title: id, status: 'running', ...session } } as AgentCard;
}
function thread(id: string, props: Partial<ThreadListItem> = {}): ThreadListItem {
  return { id, projectId: 'p1', title: id, status: 'idle', ...props } as ThreadListItem;
}
function setup() {
  return render(<MemoryRouter>
    <button className="titlebar-bell" onClick={() => useUi.getState().toggleNotificationsDrawer()}>Bell</button>
    <button className="titlebar-fav" onClick={() => useUi.getState().toggleFavoritesDrawer()}>Star</button>
    <button>Workspace</button>
    <FavoriteAgentsDrawer /><NotificationsDrawer />
  </MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  calls.cards = [];
  localStorage.clear();
  useUi.setState({ favoritesDrawerOpen: false, notificationsDrawerOpen: false, focusedProjectId: null });
  useData.setState({ projects: [{ id: 'p1', name: 'Design', color: '#234567' }] as Project[] });
  useInbox.setState({ entries: [] });
  useInboxRead.setState({ readIds: {} });
  useFavoriteAgents.setState({ favoriteIds: {} });
  useThreads.setState({ threads: [] });
});
afterEach(cleanup);

describe('quick access panel interactions', () => {
  it('switches a single panel from both launch buttons and persists mutually exclusive state', () => {
    setup();
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByText('Bell'));
    expect(screen.getByRole('complementary').getAttribute('aria-label')).toBe('Notifications');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Notifications' }));
    fireEvent.pointerDown(screen.getByText('Star'));
    fireEvent.click(screen.getByText('Star'));
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(screen.getByRole('complementary').getAttribute('aria-label')).toBe('Favorites');
    expect(localStorage.getItem('zcc.notificationsDrawerOpen')).toBe('0');
    expect(localStorage.getItem('zcc.favoritesDrawerOpen')).toBe('1');
    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(localStorage.getItem('zcc.favoritesDrawerOpen')).toBe('0');
    fireEvent.click(screen.getByText('Bell'));
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByText('Star'));
    fireEvent.click(screen.getByText('Star'));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('supports roving tab keys, Escape and focus restoration', () => {
    setup();
    fireEvent.click(screen.getByText('Bell'));
    for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) {
      fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key });
      const selected = screen.getByRole('tab', { selected: true });
      expect(document.activeElement).toBe(selected);
      expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(selected.id);
    }
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'a' });
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Bell'));
    fireEvent.click(screen.getByText('Star'));
    fireEvent.click(screen.getByRole('button', { name: 'Close favorites' }));
    expect(document.activeElement).toBe(screen.getByText('Star'));
  });

  it('dismisses on outside pointer input, leaves inside input alone and cleans up listeners', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const view = setup();
    fireEvent.click(screen.getByText('Bell'));
    fireEvent.pointerDown(screen.getByRole('tabpanel'));
    expect(screen.getByRole('complementary')).toBeTruthy();
    fireEvent.pointerDown(screen.getByText('Workspace'));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    fireEvent.click(screen.getByText('Star'));
    view.unmount();
    fireEvent.pointerDown(document.body);
    expect(useUi.getState().favoritesDrawerOpen).toBe(true);
    remove.mockRestore();
  });

  it('does not close the active panel when the inactive panel is set closed', () => {
    useUi.getState().setNotificationsDrawerOpen(true);
    useUi.getState().setFavoritesDrawerOpen(false);
    expect(useUi.getState().notificationsDrawerOpen).toBe(true);
    expect(localStorage.getItem('zcc.notificationsDrawerOpen')).toBe('1');
    useUi.getState().setFavoritesDrawerOpen(true);
    useUi.getState().setNotificationsDrawerOpen(false);
    expect(useUi.getState().favoritesDrawerOpen).toBe(true);
    expect(localStorage.getItem('zcc.favoritesDrawerOpen')).toBe('1');
  });
});

describe('notification content', () => {
  it('shows concise empty copy and opens the full Inbox', () => {
    setup();
    fireEvent.click(screen.getByText('Bell'));
    expect(screen.getByText('You’re all caught up')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View all in Inbox' }));
    expect(useUi.getState().notificationsDrawerOpen).toBe(false);
    expect(useUi.getState().nav).toBe('inbox');
  });

  it('preserves priority groups, unread filtering and loud updates, with separate preview and project/date', () => {
    const question = entry('Choose a direction', { question: { prompt: 'Which direction?' } as InboxEntry['question'] });
    const report = entry('Review ready', { comments: 'Read the summary.' });
    useInbox.setState({ entries: [report, question, entry('Goal complete', { dedupeKey: 'goal:123' }),
      entry('Read already'), entry('Quiet run', { scheduled: true }),
      entry('Loud run', { dedupeKey: 'auto-close:test', scheduled: true, notify: 'loud', projectId: 'missing', projectLabel: 'Fallback project' }),
      entry('Project removed', { projectId: 'removed' })] });
    useInboxRead.setState({ readIds: { 'Read already': true } });
    setup();
    fireEvent.click(screen.getByText('Bell'));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Needs your answer1', 'Goals1', 'Reports2', 'Other1']);
    expect(screen.queryByText('Quiet run')).toBeNull();
    expect(screen.queryByText('Read already')).toBeNull();
    expect(screen.getByText('Fallback project')).toBeTruthy();
    expect(screen.getByText('removed')).toBeTruthy();
    const row = screen.getByRole('button', { name: /Review ready/ });
    expect(row.querySelector('.quick-access-row-preview')?.textContent).toBe('Read the summary.');
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-17T00:00:00.000Z');
    fireEvent.click(row);
    expect(calls.focusInboxEntry).toHaveBeenCalledWith(report);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('caps recent rows while showing the true total and respects project scope', () => {
    useInbox.setState({ entries: Array.from({ length: 25 }, (_, i) => entry(`Report ${i}`, { ts: Date.UTC(2026, 8, 17) + i })) });
    setup();
    fireEvent.click(screen.getByText('Bell'));
    expect(screen.getByText('25 unread · All projects')).toBeTruthy();
    expect(document.querySelectorAll('.notifications-drawer-row')).toHaveLength(20);
    expect(screen.queryByText('Report 0')).toBeNull();
    expect(screen.getByRole('button', { name: /showing 20 of 25/ })).toBeTruthy();
    act(() => useUi.setState({ focusedProjectId: 'p1' }));
    expect(screen.getByText('25 unread · Design')).toBeTruthy();
    act(() => useUi.setState({ focusedProjectId: 'other' }));
    expect(screen.getByText('0 unread · This project')).toBeTruthy();
  });
});

describe('favorites content', () => {
  it('shows a short empty state and opens the full Agents view', () => {
    setup();
    fireEvent.click(screen.getByText('Star'));
    expect(screen.getByText('Keep important work close')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View all agents' }));
    expect(useUi.getState().nav).toBe('agents');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('groups followed threads and agents by status, excludes archived/unstarred entries, and opens exact targets', () => {
    calls.cards = [card('Blocked', { state: 'blocked' }), card('Busy', { state: 'working' }),
      card('Idle'), card('Background', {}, { headless: true }), card('Exited', {}, { status: 'exited' }), card('Unstarred')];
    useThreads.setState({ threads: [thread('Conversation', { hasPendingInteraction: true }), thread('Archived', { archivedAt: 1 }), thread('Not followed'), thread('Fallback', { projectId: 'missing' })] });
    useFavoriteAgents.setState({ favoriteIds: Object.fromEntries(['Blocked', 'Busy', 'Idle', 'Background', 'Exited', 'thread:Conversation', 'thread:Archived', 'thread:Fallback'].map((id) => [id, true])) });
    setup();
    fireEvent.click(screen.getByText('Star'));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Needs you2', 'Working1', 'Idle2', 'Background1', 'Done1']);
    expect(screen.queryByText('Archived')).toBeNull();
    expect(screen.queryByText('Unstarred')).toBeNull();
    expect(screen.queryByText('Not followed')).toBeNull();
    expect(screen.getByText('Unknown')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Conversation Design Thread/ }));
    expect(calls.inspectThread).toHaveBeenCalledWith('Conversation', 'p1', expect.any(Function));
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByText('Star'));
    fireEvent.click(screen.getByRole('button', { name: /Blocked Design CLI agent/ }));
    expect(calls.inspectAgentSession).toHaveBeenCalledWith('Blocked', 'p1', expect.any(Function));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('removes both kinds through separate native buttons without opening the item', () => {
    const agent = card('CLI', {}, { claudeSessionId: 'stable' });
    calls.cards = [agent];
    useThreads.setState({ threads: [thread('Chat')] });
    useFavoriteAgents.setState({ favoriteIds: { [favoriteKey(agent.session)]: true, 'thread:Chat': true } });
    setup();
    fireEvent.click(screen.getByText('Star'));
    const panel = screen.getByRole('complementary');
    expect(panel.querySelectorAll('button button, button [role="button"]')).toHaveLength(0);
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove Chat from favorites' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove CLI from favorites' }));
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Favorites' }));
    expect(useFavoriteAgents.getState().favoriteIds).toEqual({});
    expect(calls.inspectThread).not.toHaveBeenCalled();
    expect(calls.inspectAgentSession).not.toHaveBeenCalled();
    expect(screen.getByText('Keep important work close')).toBeTruthy();
  });

  it('keeps waiting work in Working and unknown states in Idle', () => {
    expect(sectionOfThread('waiting')).toBe('working');
    expect(sectionOfThread('unknown')).toBe('idle');
  });
});
