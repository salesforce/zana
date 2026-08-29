import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionStats, TerminalSession } from '@zana-ai/zcc-domain/product';

vi.mock('./AgentDetailPanel.js', () => ({
  AgentDetailPanel: () => <div data-testid="agent-info-body">Status PID</div>
}));
vi.mock('./AgentDiffPanel.js', () => ({
  AgentDiffPanel: () => <div data-testid="agent-diff-panel">diff</div>
}));
vi.mock('./AgentInsights.js', () => ({
  useSessionStats: () => null
}));
vi.mock('./thread/secondary-panel/ThreadNewTabPage.js', () => ({
  ThreadNewTabPage: () => <div data-testid="thread-new-tab-page" />
}));
vi.mock('./thread/secondary-panel/ThreadFilePreviewTab.js', () => ({
  ThreadFilePreviewTab: () => <div data-testid="thread-file-preview" />
}));
vi.mock('./thread/secondary-panel/BrowserTabDeck.js', () => ({
  BrowserTabDeck: () => <div data-testid="thread-browser-tab" />
}));
vi.mock('./thread/secondary-panel/ThreadPluginTab.js', () => ({
  ThreadPluginTab: () => <div data-testid="thread-plugin-tab" />
}));
vi.mock('./thread/secondary-panel/ThreadExplorerTab.js', () => ({
  ThreadExplorerTab: () => <div data-testid="thread-explorer-tab" />
}));

import { AgentSessionView, agentWriteScope } from './AgentSessionView.js';

function session(over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 's1',
    title: 'PTY agent',
    status: 'running',
    profile: 'claude',
    cwd: '/tmp/proj',
    createdAt: 1,
    pid: 80636,
    ...over
  } as unknown as TerminalSession;
}

function persistPanel(ownerId: string, patch: Record<string, unknown>): void {
  localStorage.setItem(`zcc.secondaryPanel.${ownerId}`, JSON.stringify({
    version: 1,
    isOpen: true,
    isMaximized: false,
    widthPx: 352,
    activeId: 'info',
    tabs: [],
    ...patch
  }));
}

function installMemoryStorage(): void {
  const memory = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
    removeItem: (key) => { memory.delete(key); },
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() { return memory.size; }
  } as Storage;
}

describe('AgentSessionView', () => {
  afterEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });
  it('keeps the secondary panel closed by default in the inspector modal', () => {
    const html = renderToStaticMarkup(
      <AgentSessionView
        session={session()}
        projectId="p1"
        projectName="demo-project"
        state="idle"
        terminalAnchorId="cc-terminal-anchor-agent-modal"
        footer={<button type="button">Close Session</button>}
        modal
      />
    );
    expect(html).toContain('thread-detail-view--modal');
    expect(html).toContain('data-testid="thread-secondary-show"');
    expect(html).not.toContain('data-testid="thread-secondary-panel"');
    expect(html).not.toContain('Close Session');
  });

  it('does not inherit a workspace-open panel into the inspector modal', () => {
    installMemoryStorage();
    persistPanel('s1', { isOpen: true });
    const html = renderToStaticMarkup(
      <AgentSessionView
        session={session()}
        projectId="p1"
        projectName="demo-project"
        state="idle"
        terminalAnchorId="cc-terminal-anchor-agent-modal"
        modal
      />
    );
    expect(html).toContain('data-testid="thread-secondary-show"');
    expect(html).not.toContain('data-testid="thread-secondary-panel"');
  });

  it('opens the thread secondary panel by default with agent actions in the footer', () => {
    const html = renderToStaticMarkup(
      <AgentSessionView
        session={session()}
        projectId="p1"
        projectName="demo-project"
        state="idle"
        terminalAnchorId="cc-terminal-anchor-agent-modal"
        footer={<button type="button">Close Session</button>}
      />
    );
    expect(html).toContain('data-testid="agent-session-view"');
    expect(html).toContain('thread-detail-split');
    expect(html).toContain('thread-detail-header');
    expect(html).toContain('PTY agent');
    expect(html.indexOf('thread-detail-split')).toBeLessThan(html.indexOf('thread-detail-main agent-session-main'));
    expect(html.indexOf('thread-detail-main agent-session-main')).toBeLessThan(html.indexOf('thread-detail-header'));
    expect(html).toContain('data-testid="thread-secondary-panel"');
    expect(html).toContain('data-testid="thread-info-pin"');
    expect(html).toContain('data-testid="thread-diff-pin"');
    expect(html).not.toContain('data-testid="thread-plan-pin"');
    expect(html).toContain('data-testid="thread-secondary-footer"');
    expect(html).toContain('Close Session');
    expect(html).toContain('Status PID');
    expect(html).toContain('id="cc-terminal-anchor-agent-modal"');
    expect(html).not.toContain('data-testid="thread-secondary-show"');
  });

  it('shows the reopen control when the secondary panel is closed', () => {
    installMemoryStorage();
    persistPanel('s-closed', { isOpen: false });
    const html = renderToStaticMarkup(
      <AgentSessionView
        session={session({ id: 's-closed' })}
        projectId="p1"
        projectName="demo-project"
        state="idle"
        terminalAnchorId="cc-terminal-anchor-agent-monitor"
      />
    );
    expect(html).toContain('data-testid="thread-secondary-show"');
    expect(html).not.toContain('data-testid="thread-secondary-panel"');
  });

  it('renders Diff, New Tab, file, browser, plugin, and sidecar-terminal empty bodies', () => {
    installMemoryStorage();
    persistPanel('s-diff', { activeId: 'diff' });
    expect(renderToStaticMarkup(
      <AgentSessionView session={session({ id: 's-diff' })} projectId="p1" projectName="demo" state="working" terminalAnchorId="a" />
    )).toContain('data-testid="agent-diff-panel"');

    persistPanel('s-new', { activeId: 'new-tab:1', tabs: [{ id: 'new-tab:1', kind: 'new-tab', title: 'New Tab' }] });
    expect(renderToStaticMarkup(
      <AgentSessionView session={session({ id: 's-new' })} projectId="p1" projectName="demo" state="working" terminalAnchorId="a" />
    )).toContain('data-testid="thread-new-tab-page"');

    persistPanel('s-file', { activeId: 'file:1', tabs: [{ id: 'file:1', kind: 'file-preview', title: 'README.md', path: '/tmp/README.md' }] });
    expect(renderToStaticMarkup(
      <AgentSessionView session={session({ id: 's-file' })} projectId="p1" projectName="demo" state="working" terminalAnchorId="a" />
    )).toContain('data-testid="thread-file-preview"');

    persistPanel('s-browser', { activeId: 'browser:1', tabs: [{ id: 'browser:1', kind: 'browser', title: 'Browser', url: 'https://example.com' }] });
    expect(renderToStaticMarkup(
      <AgentSessionView session={session({ id: 's-browser' })} projectId="p1" projectName="demo" state="working" terminalAnchorId="a" />
    )).toContain('data-testid="thread-browser-tab"');

    persistPanel('s-plugin', { activeId: 'plugin:1', tabs: [{ id: 'plugin:1', kind: 'plugin', title: 'Docs', moduleId: 'docs' }] });
    expect(renderToStaticMarkup(
      <AgentSessionView session={session({ id: 's-plugin' })} projectId="p1" projectName="demo" state="working" terminalAnchorId="a" />
    )).toContain('data-testid="thread-plugin-tab"');

    persistPanel('s-explorer', { activeId: 'explorer:1', tabs: [{ id: 'explorer:1', kind: 'explorer', title: 'Explorer' }] });
    expect(renderToStaticMarkup(
      <AgentSessionView session={session({ id: 's-explorer' })} projectId="p1" projectName="demo" state="working" terminalAnchorId="a" />
    )).toContain('data-testid="thread-explorer-tab"');

    persistPanel('s-term', { activeId: 'term:1', tabs: [{ id: 'term:1', kind: 'terminal', title: 'Terminal', sessionId: 'other' }] });
    expect(renderToStaticMarkup(
      <AgentSessionView session={session({ id: 's-term' })} projectId="p1" projectName="demo" state="working" terminalAnchorId="a" />
    )).toContain('A sidecar terminal cannot share this inspector');
  });

  it('applies maximized chrome and optional stage overlays', () => {
    installMemoryStorage();
    persistPanel('s-max', { isMaximized: true });
    persistPanel('s-nopath', {
      activeId: 'file:1',
      tabs: [{ id: 'file:1', kind: 'file-preview', title: 'x' }]
    });
    const html = renderToStaticMarkup(
      <AgentSessionView
        session={session({ id: 's-max', status: 'exited' })}
        projectId="p1"
        projectName="demo"
        state="idle"
        terminalAnchorId="a"
        projectRemote
        showIdentity
        showProject
        stageChrome={<span>pending-q</span>}
        stageOverlay={<span>report-overlay</span>}
        focusDiffKey={1}
      />
    );
    expect(html).toContain('is-secondary-maximized');
    expect(html).toContain('pending-q');
    expect(html).toContain('report-overlay');
    expect(renderToStaticMarkup(
      <AgentSessionView session={session({ id: 's-nopath' })} projectId="p1" projectName="demo" state="idle" terminalAnchorId="a" />
    )).toContain('data-testid="thread-secondary-panel"');
  });

  it('intersects transcript writes for the Diff pin', () => {
    expect(agentWriteScope(null)).toBeNull();
    expect([...agentWriteScope({
      files: [
        { path: '/a.ts', op: 'W' },
        { path: '/b.ts', op: 'R' },
        { path: '/c.ts', op: 'C' }
      ],
      queue: [],
      model: 'sonnet'
    } as SessionStats)!]).toEqual(['/a.ts', '/c.ts']);
  });

  it('omits the sidecar terminal path and uses AgentDiffPanel for the Diff pin', () => {
    const source = readFileSync(new URL('./AgentSessionView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('allowSidecarTerminal={false}');
    expect(source).toContain("kind: 'explorer'");
    expect(source).toContain('<ThreadExplorerTab');
    expect(source).toContain('thread-detail-split');
    expect(source).toContain('thread-detail-header');
    expect(source.indexOf('thread-detail-split')).toBeLessThan(source.indexOf('thread-detail-main agent-session-main'));
    expect(source.indexOf('thread-detail-main agent-session-main')).toBeLessThan(source.indexOf('className="thread-detail-header"'));
    expect(source).toContain('thread-detail-view--modal');
    expect(source).toContain('defaultOpen: !modal');
    expect(source).not.toContain('agent-session-show-panel');
    expect(source).toContain('<AgentDiffPanel');
    expect(source).toContain('<AgentDetailPanel');
    expect(source).toContain('variant="embedded"');
    expect(source).toContain('collapsible={false}');
    expect(source).not.toContain('ThreadTerminalTab');
    expect(source).not.toContain('product.threads.create');
    expect(source).not.toContain('createTerminal');
  });
});
