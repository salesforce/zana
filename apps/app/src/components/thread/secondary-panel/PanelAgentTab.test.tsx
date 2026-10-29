// @vitest-environment happy-dom

import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const composerProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown>, session: null as unknown }));
const threads = vi.hoisted(() => ({
  panelConversations: vi.fn(async (_pluginId: string, _panel?: string): Promise<Array<{ id: string; title: string | null; updatedAt: number }>> => []),
  openAsThread: vi.fn(async (_threadId: string) => ({ thread: {} }))
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../ThreadCommandComposer.js', () => ({
  ThreadCommandComposer: (props: { onCreated?: (threadId: string) => void }) => {
    composerProps.last = props;
    composerProps.session = useComposerDraft();
    return <button type="button" onClick={() => props.onCreated?.('t-new')}>Send</button>;
  }
}));
vi.mock('../../../views/threads/ThreadDetailView.js', () => ({
  ThreadDetail: ({ threadId, embedded }: { threadId: string; embedded?: boolean }) => (
    <div data-testid="thread-detail" data-assistant-owner={usePluginAssistantOwner() ?? 'none'}>{`${threadId}:${embedded ? 'embedded' : 'full'}`}</div>
  )
}));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
const store = vi.hoisted(() => ({ projects: [{ id: 'dx', name: 'dx', path: '/tmp/dx' }] }));
vi.mock('../../../store.js', () => ({ useData: (select: (state: unknown) => unknown) => select(store) }));
const viewWindow = vi.hoisted(() => ({ target: null as null | { pluginId: string }, show: vi.fn(async (_to: string) => undefined) }));
vi.mock('../../../lib/pluginViewSurface.js', () => ({ getPluginViewTarget: () => viewWindow.target }));
vi.mock('../../../plugins/plugin-view-windows.js', () => ({ showInMainWindow: viewWindow.show }));

import { usePluginAssistantOwner } from '../../../plugins/plugin-assistant-context.js';
import { useComposerDraft } from '../../composer/ComposerDraft.js';
import { resetComposerSessions } from '../../composer/composer-session.js';
import { PANEL_AGENT_RECENT_LIMIT, PanelAgentTab } from './PanelAgentTab.js';

const binding = { pluginId: 'p1', panel: 'main', view: 'items/7' };

afterEach(() => {
  cleanup();
  resetComposerSessions();
  composerProps.last = null;
  composerProps.session = null;
  threads.panelConversations.mockReset().mockResolvedValue([]);
  threads.openAsThread.mockReset().mockResolvedValue({ thread: {} });
  navigate.mockReset();
});

describe('PanelAgentTab', () => {
  it.each([binding, undefined])('provides the assistant owner only for plugin-bound chats (%j)', async (pluginPanel) => {
    render(<PanelAgentTab threadId="t1" pluginPanel={pluginPanel} onCreated={vi.fn()} />);
    expect((await screen.findByTestId('thread-detail')).getAttribute('data-assistant-owner')).toBe(pluginPanel?.pluginId ?? 'none');
  });

  it('starts a bound thread from a composer that never navigates away', () => {
    const onCreated = vi.fn();
    render(<PanelAgentTab pluginPanel={binding} onCreated={onCreated} />);
    expect(screen.getByTestId('panel-agent-tab-composer')).toBeTruthy();
    expect(screen.getByText('Ask about this page. The agent knows which plugin it is next to.')).toBeTruthy();
    expect(composerProps.last).toMatchObject({ navigateOnCreate: false, autoFocus: true, pluginPanel: binding });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onCreated).toHaveBeenCalledWith('t-new');
  });

  it('seeds the composer with a page draft and leaves the harness to the user', () => {
    render(<PanelAgentTab pluginPanel={binding} draft="Review this doc" draftProjectId="proj-1" onCreated={vi.fn()} />);
    expect(composerProps.last).toMatchObject({ initialText: 'Review this doc', composerProjectId: 'proj-1', pluginPanel: binding });
    expect(composerProps.last).not.toHaveProperty('providerId');
  });

  it('pins new threads to the page project', () => {
    render(<PanelAgentTab pluginPanel={binding} projectId="dx" onCreated={vi.fn()} />);
    expect(composerProps.last).toMatchObject({ project: store.projects[0], composerProjectId: 'dx', pluginPanel: binding });
  });

  it('pins nothing on a page without a project', () => {
    render(<PanelAgentTab pluginPanel={binding} onCreated={vi.fn()} />);
    expect(composerProps.last?.project).toBeUndefined();
  });

  it('keeps the generic hint and skips the lookup without a plugin binding', () => {
    render(<PanelAgentTab onCreated={vi.fn()} onOpenConversation={vi.fn()} />);
    expect(screen.getByText('Ask an agent without leaving this page.')).toBeTruthy();
    expect(threads.panelConversations).not.toHaveBeenCalled();
  });

  it('lists the plugin\'s recent conversations to reopen, capped', async () => {
    const now = Date.now();
    const rows = Array.from({ length: PANEL_AGENT_RECENT_LIMIT + 2 }, (_, index) => ({
      id: `t${index}`,
      title: index === 0 ? null : `Chat ${index}`,
      updatedAt: now - [0, 5 * 60_000, 3 * 3_600_000, 2 * 86_400_000, 1][index % 5]!
    }));
    threads.panelConversations.mockResolvedValue(rows);
    const onOpen = vi.fn();
    render(<PanelAgentTab pluginPanel={binding} onCreated={vi.fn()} onOpenConversation={onOpen} />);
    const items = await screen.findAllByTestId('panel-agent-recent');
    expect(threads.panelConversations).toHaveBeenCalledWith('p1', 'main');
    expect(items).toHaveLength(PANEL_AGENT_RECENT_LIMIT);
    expect(items.map((row) => row.textContent)).toEqual([
      'Untitled conversationnow',
      'Chat 15m',
      'Chat 23h',
      'Chat 32d',
      'Chat 4now'
    ]);
    fireEvent.click(items[1]!);
    expect(onOpen).toHaveBeenCalledWith(rows[1]);
  });

  it('shows nothing extra when there are no conversations or the lookup fails', async () => {
    threads.panelConversations.mockRejectedValueOnce(new Error('offline'));
    render(<PanelAgentTab pluginPanel={binding} onCreated={vi.fn()} onOpenConversation={vi.fn()} />);
    await waitFor(() => expect(threads.panelConversations).toHaveBeenCalled());
    expect(screen.queryByTestId('panel-agent-recents')).toBeNull();
  });

  it('shows the started thread as an embedded chat without promotion when unbound', async () => {
    render(<PanelAgentTab threadId="t1" onCreated={vi.fn()} />);
    expect((await screen.findByTestId('thread-detail')).textContent).toBe('t1:embedded');
    expect(screen.queryByTestId('panel-agent-tab-composer')).toBeNull();
    expect(screen.queryByTestId('panel-agent-open-as-thread')).toBeNull();
  });

  it('opens a bound conversation as a thread and goes to it', async () => {
    render(<PanelAgentTab threadId="t1" pluginPanel={binding} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByTestId('panel-agent-open-as-thread'));
    expect(threads.openAsThread).toHaveBeenCalledWith('t1');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.stringContaining('t1')));
  });

  it('opens the thread in the main window from a plugin view window', async () => {
    viewWindow.target = { pluginId: 'salesforce' };
    try {
      render(<PanelAgentTab threadId="t1" pluginPanel={binding} onCreated={vi.fn()} />);
      fireEvent.click(screen.getByTestId('panel-agent-open-as-thread'));
      await waitFor(() => expect(viewWindow.show).toHaveBeenCalledWith(expect.stringContaining('t1')));
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      viewWindow.target = null;
    }
  });

  it('reports a failed promotion and lets the user retry', async () => {
    threads.openAsThread.mockRejectedValueOnce(new Error('only side-panel conversations can be opened as threads'));
    render(<PanelAgentTab threadId="t1" pluginPanel={binding} onCreated={vi.fn()} />);
    const button = screen.getByTestId('panel-agent-open-as-thread') as HTMLButtonElement;
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toBe('only side-panel conversations can be opened as threads');
    expect(button.disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('retains the draft per plugin panel and view, and keeps unbound composers instance-local', () => {
    const sessionFor = (element: ReactElement) => { const view = render(element); const session = composerProps.session; view.unmount(); return session; };
    const noView = { pluginId: 'p1', panel: 'main' };
    const first = sessionFor(<PanelAgentTab pluginPanel={noView} onCreated={vi.fn()} />);
    expect(first).toBeTruthy();
    // Same panel and view: the draft survives remounting; a different view or panel does not share it.
    expect(sessionFor(<PanelAgentTab pluginPanel={noView} onCreated={vi.fn()} />)).toBe(first);
    expect(sessionFor(<PanelAgentTab pluginPanel={binding} onCreated={vi.fn()} />)).not.toBe(first);
    expect(sessionFor(<PanelAgentTab pluginPanel={{ ...noView, panel: 'other' }} onCreated={vi.fn()} />)).not.toBe(first);
    const unboundA = sessionFor(<PanelAgentTab onCreated={vi.fn()} />);
    const unboundB = sessionFor(<PanelAgentTab onCreated={vi.fn()} />);
    expect(unboundA).not.toBe(unboundB);
  });
});
