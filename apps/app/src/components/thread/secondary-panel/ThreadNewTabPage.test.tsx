/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PluginNewThreadPanelActionRegistration, PluginThreadPanelActionRegistration } from '@zana-ai/zcc-plugin-sdk';

vi.mock('../../../lib/app-surface.js', () => ({
  hasDesktopBridge: () => false
}));
vi.mock('../../../lib/product-client.js', () => ({
  product: { fs: {} }
}));
vi.mock('../../../store.js', () => ({
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] })
}));
const slots = vi.hoisted(() => ({
  thread: [
    { pluginId: 'tasks', id: 'board', title: 'Tasks', layout: 'padded' as const },
    {
      pluginId: 'tasks',
      id: 'live',
      title: 'Live board',
      layout: 'padded' as const,
      scopes: ['agent-session'] as const
    }
  ] as Omit<PluginThreadPanelActionRegistration, 'generation' | 'component'>[],
  compose: [{ pluginId: 'tasks', id: 'compose', title: 'Compose tasks' }] as Omit<PluginNewThreadPanelActionRegistration, 'generation' | 'component'>[]
}));

vi.mock('../../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listThreadPanelActions: () => slots.thread,
  listNewThreadPanelActions: () => slots.compose
}));

import { ThreadNewTabPage, ThreadNewTabView } from './ThreadNewTabPage.js';

afterEach(cleanup);

describe('ThreadNewTabPage', () => {
  it('shows Start terminal and hides Open browser without a desktop bridge', () => {
    const html = renderToStaticMarkup(
      <ThreadNewTabPage
        projectId={null}
        cwd={null}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(html).toContain('data-testid="thread-new-tab-page"');
    expect(html).toContain('data-testid="thread-new-tab-terminal"');
    expect(html).toContain('Start terminal');
    expect(html).not.toContain('data-testid="thread-new-tab-browser"');
    expect(html).not.toContain('data-testid="thread-new-tab-explorer"');
    expect(html).not.toContain('data-testid="thread-new-tab-inbox"');
    expect(html).toContain('data-testid="thread-new-tab-plugin-tasks-board"');
    expect(html).toContain('data-testid="thread-new-tab-plugin-tasks-compose"');
    expect(html).not.toContain('data-testid="thread-new-tab-plugin-tasks-live"');

    const withProject = renderToStaticMarkup(
      <ThreadNewTabPage
        projectId="p1"
        cwd={null}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onOpenExplorer={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(withProject).toContain('data-testid="thread-new-tab-explorer"');
    expect(withProject).toContain('Open Explorer');
    expect(withProject).toContain('data-testid="thread-new-tab-inbox"');
    expect(withProject).toContain('Open Inbox');
  });

  it('lists matching files and an empty search state', () => {
    const files = renderToStaticMarkup(
      <ThreadNewTabView
        query="readme"
        onQueryChange={() => undefined}
        matches={[{ path: '/tmp/README.md', rel: 'README.md' }]}
        desktop
        actions={[]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(files).toContain('README.md');
    expect(files).toContain('data-testid="thread-new-tab-page"');
    const empty = renderToStaticMarkup(
      <ThreadNewTabView
        query="zzz"
        onQueryChange={() => undefined}
        matches={[]}
        desktop={false}
        actions={[]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(empty).toContain('No matching tools or files');
    const desktop = renderToStaticMarkup(
      <ThreadNewTabView
        query=""
        onQueryChange={() => undefined}
        matches={[]}
        desktop
        actions={[{ pluginId: 'tasks', id: 'board', title: 'Tasks' }]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(desktop).toContain('data-testid="thread-new-tab-browser"');
    expect(desktop).toContain('data-testid="thread-new-tab-explorer"');
    expect(desktop).toContain('data-testid="thread-new-tab-inbox"');
    expect(desktop).toContain('Tasks');
    const withRecents = renderToStaticMarkup(
      <ThreadNewTabView
        query=""
        onQueryChange={() => undefined}
        matches={[]}
        desktop={false}
        recents={[
          { kind: 'file', source: 'workspace', path: 'src/a.ts', openedAt: Date.now() },
          { kind: 'browser', url: 'https://a.test', title: 'A', openedAt: Date.now() }
        ]}
        actions={[]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onOpenPlugin={() => undefined}
        allowSidecarTerminal={false}
        allowExplorer={false}
        allowInbox={false}
      />
    );
    expect(withRecents).toContain('data-testid="thread-new-tab-recents"');
    expect(withRecents).toContain('a.ts');
    expect(withRecents).toContain('A');
    const noSidecar = renderToStaticMarkup(
      <ThreadNewTabView
        query=""
        onQueryChange={() => undefined}
        matches={[]}
        desktop={false}
        actions={[]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onOpenPlugin={() => undefined}
        allowSidecarTerminal={false}
        allowExplorer={false}
        allowInbox={false}
      />
    );
    expect(noSidecar).not.toContain('data-testid="thread-new-tab-terminal"');
    expect(noSidecar).not.toContain('Start terminal');
    expect(noSidecar).not.toContain('data-testid="thread-new-tab-explorer"');
    expect(noSidecar).not.toContain('data-testid="thread-new-tab-inbox"');
  });

  it('lists only agent-session-scoped plugin actions on the CLI-agent inspector', () => {
    const html = renderToStaticMarkup(
      <ThreadNewTabPage
        projectId="p1"
        cwd={null}
        panelScope="agent-session"
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(html).toContain('data-testid="thread-new-tab-plugin-tasks-live"');
    expect(html).not.toContain('data-testid="thread-new-tab-plugin-tasks-board"');
    expect(html).not.toContain('data-testid="thread-new-tab-plugin-tasks-compose"');
  });

  it('invokes threadPanelAction.run before opening a tab', async () => {
    const { fireEvent, render, screen } = await import('@testing-library/react');
    const run = vi.fn(async (context: {
      threadId: string;
      openPanel: (options?: { title?: string; params?: unknown }) => boolean;
    }) => {
      context.openPanel({ title: 'Forked', params: { threadId: 'thr_fork' } });
    });
    slots.thread.push({
      pluginId: 'demo',
      id: 'panel',
      title: 'Start panel',
      layout: 'flush' as const,
      run
    });
    const onOpenPlugin = vi.fn();
    render(
      <ThreadNewTabPage
        projectId="p1"
        cwd={null}
        threadId="thr_src"
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={onOpenPlugin}
      />
    );
    fireEvent.click(screen.getByTestId('thread-new-tab-plugin-demo-panel'));
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thr_src' }));
    expect(onOpenPlugin).toHaveBeenCalledWith('demo', 'Forked', expect.objectContaining({
      actionId: 'panel',
      params: { threadId: 'thr_fork' },
      layout: 'flush'
    }));
    slots.thread.pop();
  });
});

const viewProps = {
  query: '', onQueryChange: vi.fn(), matches: [], desktop: true,
  onOpenFile: vi.fn(), onOpenBrowser: vi.fn(), onOpenExplorer: vi.fn(),
  onOpenInbox: vi.fn(), onStartTerminal: vi.fn(), onOpenPlugin: vi.fn(),
  actions: [
    { pluginId: 'crm', id: 'org', title: 'Org', category: 'CRM', layout: 'flush' as const },
    { pluginId: 'crm', id: 'query', title: 'Query data', category: ' crm ' },
    { pluginId: 'docs', id: 'document', title: 'Document', category: 'Documents', icon: 'FileText' },
    { pluginId: 'extra', id: 'tool', title: 'Extra tool' }
  ]
};

describe('New Tab categories and tool search', () => {
  it('groups tools in registration order, folds categories, and preserves launch options', () => {
    render(<ThreadNewTabView {...viewProps} />);
    expect(screen.getAllByRole('region').map((node) => node.getAttribute('aria-label')))
      .toEqual(['Essentials', 'CRM', 'Documents', 'Plugins']);
    const crm = screen.getByRole('region', { name: 'CRM' });
    const toggle = within(crm).getByRole('button', { name: 'CRM 2' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(crm).queryByRole('button', { name: 'Org' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Documents' })).getByRole('button', { name: 'Document' })).toBeTruthy();
    fireEvent.click(toggle);
    fireEvent.click(within(crm).getByRole('button', { name: 'Org' }));
    expect(viewProps.onOpenPlugin).toHaveBeenCalledWith('crm', 'Org', { actionId: 'org', layout: 'flush' });
    fireEvent.click(screen.getByRole('button', { name: 'Open browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Explorer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Inbox' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start terminal' }));
    for (const callback of [viewProps.onOpenBrowser, viewProps.onOpenExplorer, viewProps.onOpenInbox, viewProps.onStartTerminal]) {
      expect(callback).toHaveBeenCalledOnce();
    }
  });

  it('finds tools by title or category across collapsed groups and restores collapse after clearing', () => {
    const { rerender } = render(<ThreadNewTabView {...viewProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'CRM 2' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'crm query' } });
    expect(viewProps.onQueryChange).toHaveBeenCalledWith('crm query');
    rerender(<ThreadNewTabView {...viewProps} query=" CRM query " />);
    expect(screen.getByRole('button', { name: 'Query data' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Org' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Documents' })).toBeNull();
    expect(screen.getByRole('button', { name: 'CRM 1' }).hasAttribute('disabled')).toBe(true);
    rerender(<ThreadNewTabView {...viewProps} query="CRM" />);
    expect(screen.getByRole('button', { name: 'Org' })).toBeTruthy();
    rerender(<ThreadNewTabView {...viewProps} />);
    expect(screen.queryByRole('button', { name: 'Org' })).toBeNull();
  });

  it('searches built-ins and files together and only shows an empty state when neither matches', () => {
    const { rerender } = render(<ThreadNewTabView {...viewProps} query="browser"
      matches={[{ path: '/tmp/browser.md', rel: 'browser.md' }]} />);
    expect(screen.getByRole('button', { name: 'Open browser' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'browser.md' }));
    expect(viewProps.onOpenFile).toHaveBeenCalledWith('/tmp/browser.md', 'browser.md');
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<ThreadNewTabView {...viewProps} query="unknown" />);
    expect(screen.getByRole('status').textContent).toBe('No matching tools or files');
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    rerender(<ThreadNewTabView {...viewProps} query="browser" desktop={false} />);
    expect(screen.queryByRole('button', { name: 'Open browser' })).toBeNull();
  });

  it('keeps recents above categories and launches recent plugin, browser and file entries', () => {
    const recents = [
      { kind: 'plugin' as const, moduleId: 'crm', title: 'Org', openedAt: Date.now() },
      { kind: 'browser' as const, url: 'https://example.test', title: 'Example', openedAt: Date.now() },
      { kind: 'file' as const, source: 'workspace' as const, path: 'README.md', openedAt: Date.now() }
    ];
    const onOpenRecent = vi.fn();
    const { rerender } = render(<ThreadNewTabView {...viewProps} recents={recents} onOpenRecent={onOpenRecent} />);
    const recent = screen.getByTestId('thread-new-tab-recents');
    within(recent).getAllByRole('button').forEach((button) => fireEvent.click(button));
    expect(onOpenRecent.mock.calls.map(([item]) => item)).toEqual(recents);
    rerender(<ThreadNewTabView {...viewProps} recents={recents} query="CRM" />);
    expect(screen.queryByTestId('thread-new-tab-recents')).toBeNull();
  });

  it('forwards category and icon metadata through the page and launches a compose action', async () => {
    const run = vi.fn((context) => context.openPanel());
    slots.compose.push({ pluginId: 'demo', id: 'new', title: 'New note', category: 'Writing', icon: 'FileText', run });
    const onOpenPlugin = vi.fn();
    try {
      render(<ThreadNewTabPage projectId="p1" cwd={null} onOpenFile={vi.fn()}
        onOpenBrowser={vi.fn()} onOpenPlugin={onOpenPlugin} />);
      fireEvent.click(within(screen.getByRole('region', { name: 'Writing' })).getByRole('button', { name: 'New note' }));
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
      expect(onOpenPlugin).toHaveBeenCalledWith('demo', 'New note', { actionId: 'new', params: null, layout: undefined });
      fireEvent.click(screen.getByTestId('thread-new-tab-plugin-tasks-board'));
      expect(onOpenPlugin).toHaveBeenCalledWith('tasks', 'Tasks', { actionId: 'board', layout: 'padded' });
    } finally {
      slots.compose.pop();
    }
  });
});
