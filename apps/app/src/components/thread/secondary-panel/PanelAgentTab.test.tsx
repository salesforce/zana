// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const composerProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
const threads = vi.hoisted(() => ({
  panelConversations: vi.fn(async (_pluginId: string, _panel?: string): Promise<Array<{ id: string; title: string | null; updatedAt: number }>> => []),
  openAsThread: vi.fn(async (_threadId: string) => ({ thread: {} }))
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../ThreadCommandComposer.js', () => ({
  ThreadCommandComposer: (props: { onCreated?: (threadId: string) => void }) => {
    composerProps.last = props;
    return <button type="button" onClick={() => props.onCreated?.('t-new')}>Send</button>;
  }
}));
vi.mock('../../../views/threads/ThreadDetailView.js', () => ({
  ThreadDetail: ({ threadId, embedded }: { threadId: string; embedded?: boolean }) => (
    <div data-testid="thread-detail">{`${threadId}:${embedded ? 'embedded' : 'full'}`}</div>
  )
}));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { PANEL_AGENT_RECENT_LIMIT, PanelAgentTab } from './PanelAgentTab.js';

const binding = { pluginId: 'p1', panel: 'main', view: 'items/7' };

afterEach(() => {
  cleanup();
  composerProps.last = null;
  threads.panelConversations.mockReset().mockResolvedValue([]);
  threads.openAsThread.mockReset().mockResolvedValue({ thread: {} });
  navigate.mockReset();
});

describe('PanelAgentTab', () => {
  it('starts a bound thread from a composer that never navigates away', () => {
    const onCreated = vi.fn();
    render(<PanelAgentTab pluginPanel={binding} onCreated={onCreated} />);
    expect(screen.getByTestId('panel-agent-tab-composer')).toBeTruthy();
    expect(screen.getByText('Ask about this page. The agent knows which plugin it is next to.')).toBeTruthy();
    expect(composerProps.last).toMatchObject({ navigateOnCreate: false, autoFocus: true, pluginPanel: binding });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onCreated).toHaveBeenCalledWith('t-new');
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

  it('reports a failed promotion and lets the user retry', async () => {
    threads.openAsThread.mockRejectedValueOnce(new Error('only side-panel conversations can be opened as threads'));
    render(<PanelAgentTab threadId="t1" pluginPanel={binding} onCreated={vi.fn()} />);
    const button = screen.getByTestId('panel-agent-open-as-thread') as HTMLButtonElement;
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toBe('only side-panel conversations can be opened as threads');
    expect(button.disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
