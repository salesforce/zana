// @vitest-environment happy-dom
import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ compact: false, basicCompact: false, classic: true, focused: true, pathname: '/projects/p/threads/new', panelProps: null as any, create: vi.fn(), close: vi.fn(), register: vi.fn(), file: vi.fn() }));
vi.mock('react-router-dom', async original => ({ ...await original<any>(), useLocation: () => ({ pathname: h.pathname }) }));
vi.mock('../../store.js', () => ({ useData: Object.assign(() => undefined, { getState: () => ({ classicSessionViewEnabled: h.classic }) }) }));
vi.mock('../../hooks/useBasicPanelLayout.js', () => ({ useBasicPanelLayout: (_ref: unknown, basic: boolean) => basic && h.basicCompact }));
vi.mock('../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => h.compact }));
vi.mock('../thread-detail/PaneContext.js', () => ({ useOptionalPaneContext: () => ({ isFocused: h.focused }) }));
vi.mock('../../lib/product-client.js', () => ({ product: { terminals: { create: h.create, close: h.close } } }));
vi.mock('../../components/thread/secondary-panel/useInAppBrowserPanel.js', () => ({ useInAppBrowserPanel: () => undefined }));
vi.mock('../../components/thread/secondary-panel/useThreadOpenFileSignal.js', () => ({ useThreadOpenFileSignal: h.file, forgetAgentTerminal: () => undefined }));
vi.mock('../../components/thread/secondary-panel/useThreadOpenTerminalSignal.js', () => ({ forgetAgentTerminal: () => undefined }));
vi.mock('../../components/thread/secondary-panel/browserViewVisibilityCoordinator.js', () => ({ registerBrowserView: h.register }));
vi.mock('../../components/thread/secondary-panel/ThreadSecondaryPanel.js', () => ({
  ThreadSecondaryPanel: (p: ComponentProps<typeof import('../../components/thread/secondary-panel/ThreadSecondaryPanel.js').ThreadSecondaryPanel>) => { h.panelProps = p; return <aside>
    <button onClick={p.onNewTab}>New tab</button><button onClick={p.onHide}>Hide</button>
    <button onClick={() => p.onResize(530, 1200)}>Resize</button><button onClick={p.onToggleMaximized}>Maximize</button>
    <button onClick={() => p.onAddTool?.('explorer')}>Quick files</button><button onClick={() => p.onAddTool?.('terminal')}>Quick terminal</button>
    {p.state.tabs.map(tab => <button key={tab.id} onClick={() => p.onActivateTab(tab.id)}>{tab.title}</button>)}{p.children}
  </aside>; }
}));
vi.mock('../../components/thread/secondary-panel/ThreadNewTabPage.js', () => ({
  ThreadNewTabPage: (p: ComponentProps<typeof import('../../components/thread/secondary-panel/ThreadNewTabPage.js').ThreadNewTabPage>) => <div data-testid="tools" data-terminals={String(p.allowSidecarTerminal)}>
    <button onClick={p.onOpenBrowser}>Open browser</button><button onClick={() => p.onOpenFile('/p/README.md', 'README.md')}>Open file</button>
    <button onClick={p.onOpenExplorer}>Open Explorer</button><button onClick={p.onOpenInbox}>Open Inbox</button><button onClick={p.onStartTerminal}>Start terminal</button>
    <button onClick={() => p.onOpenPlugin('fixture', 'Preview', { actionId: 'preview', params: { mode: 1 }, layout: 'flush' })}>Open plugin</button>
    <button onClick={() => p.onOpenRecent?.({ kind: 'browser', url: 'https://example.com', openedAt: 1 })}>Recent</button>
  </div>
}));
vi.mock('../../components/thread/secondary-panel/ThreadFilePreviewTab.js', () => ({ ThreadFilePreviewTab: ({ path }: { path: string }) => <div>File: {path}</div> }));
vi.mock('../../components/thread/secondary-panel/ThreadExplorerTab.js', () => ({ ThreadExplorerTab: () => <div>Project files</div> }));
vi.mock('../../components/thread/secondary-panel/ThreadInboxTab.js', () => ({ ThreadInboxTab: () => <div>Project inbox</div> }));
vi.mock('../../components/thread/secondary-panel/DockedTerminalTab.js', () => ({ DockedTerminalTab: ({ sessionId }: { sessionId: string }) => <div>Shell: {sessionId}</div> }));
vi.mock('../../components/thread/secondary-panel/ThreadPluginTab.js', () => ({ ThreadPluginTab: ({ params, projectId, tabState, onTabStateChange }: { params: unknown; projectId: string | null; tabState?: unknown; onTabStateChange?: (state: unknown) => void }) => (
  <div><span>Plugin: {JSON.stringify(params)}</span><button onClick={() => onTabStateChange?.({ place: 2 })}>Save plugin state</button><output data-testid="plugin-project">{String(projectId)}</output><output data-testid="plugin-state">{JSON.stringify(tabState ?? null)}</output></div>
) }));
vi.mock('../../components/thread/secondary-panel/BrowserTabDeck.js', () => ({
  BrowserTabDeck: (p: ComponentProps<typeof import('../../components/thread/secondary-panel/BrowserTabDeck.js').BrowserTabDeck>) => p.activeBrowserTabId ? <div data-testid="browser" data-visible={String(p.canShowNativeBrowserView)}>
    <button onClick={() => p.onUpdate({ tabId: p.activeBrowserTabId!, url: 'https://example.com/docs', title: 'Reference' })}>Visit page</button>
    <button onClick={() => p.onUpdate({ tabId: p.activeBrowserTabId!, url: '', title: null })}>Blank page</button>
  </div> : null
}));

import { NewChatPanelLayout } from './NewChatPanelLayout.js';
import { emptySecondaryPanelState, loadSecondaryPanelState, persistSecondaryPanelState } from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';
import { getBasicUiMode, setBasicUiMode } from '../../lib/basic-ui.js';

const project = { id: 'p', path: '/p' } as Project;
const buttons = ({ onCreated, onAgentCreated }: ComponentProps<typeof NewChatPanelLayout>['children'] extends (p: infer P) => ReactNode ? P : never) => <>
  <button onClick={() => onCreated('thread')}>Launch Modern</button>
  <button onClick={() => onAgentCreated({ id: 'cli' } as TerminalSession)}>Launch CLI</button>
</>;
const show = () => fireEvent.click(screen.getByRole('button', { name: 'Show right panel' }));
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }));
const renderDraft = (scopeId = 'p', selected: Project | undefined = project) => render(<NewChatPanelLayout key={scopeId} scopeId={scopeId} project={selected} hostId="host">{buttons}</NewChatPanelLayout>);

beforeEach(() => {
  localStorage.clear(); h.compact = false; h.basicCompact = false; h.classic = true; h.focused = true; h.pathname = '/projects/p/threads/new'; h.panelProps = null; setBasicUiMode('advanced'); vi.clearAllMocks();
  h.create.mockResolvedValue({ ok: true, value: { id: 'shell', title: 'Terminal' } }); h.close.mockResolvedValue(true);
});
afterEach(() => { cleanup(); setBasicUiMode('advanced'); });

describe('New chat side panels', () => {
  it('passes Basic chrome policy while retaining the draft and selected document', () => {
    renderDraft(); show(); click('Open file');
    const preview = screen.getByText('File: /p/README.md');
    const launch = screen.getByRole('button', { name: 'Launch Modern' });
    const saved = loadSecondaryPanelState('new-chat:p');
    act(() => setBasicUiMode('basic'));
    expect(h.panelProps.basic).toBe(true);
    expect(screen.getByText('File: /p/README.md')).toBe(preview);
    expect(screen.getByRole('button', { name: 'Launch Modern' })).toBe(launch);
    expect(loadSecondaryPanelState('new-chat:p')).toEqual(saved);
    act(() => h.panelProps.onOpenAdvanced());
    expect(getBasicUiMode()).toBe('advanced');
    expect(h.panelProps.basic).toBe(false);
    expect(screen.getByText('File: /p/README.md')).toBe(preview);
    expect(loadSecondaryPanelState('new-chat:p')).toEqual(saved);
  });

  it('focuses a narrow Basic result while retaining the inaccessible composer until returning to chat', () => {
    h.basicCompact = true;
    setBasicUiMode('basic');
    renderDraft();
    const launch = screen.getByRole('button', { name: 'Launch Modern' });
    show();
    expect(h.panelProps.basicCompact).toBe(true);
    const main = launch.closest<HTMLElement>('.new-chat-panel-main')!;
    expect(main.hidden).toBe(true);
    expect(main.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Launch Modern' })).toBeNull();
    click('Hide');
    expect(main.hidden).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show right panel' }));
    expect(main.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: 'Launch Modern' })).toBe(launch);
    act(() => setBasicUiMode('advanced'));
    expect(screen.getByTestId('new-chat-panel-layout').hasAttribute('data-basic-panel-compact')).toBe(false);
  });

  it('suppresses native browser views when a retained Basic draft is behind an unsupported route', () => {
    renderDraft(); show(); click('Open browser');
    const browser = screen.getByTestId('browser');
    const saved = loadSecondaryPanelState('new-chat:p');
    act(() => setBasicUiMode('basic'));
    expect(browser.getAttribute('data-visible')).toBe('true');
    h.pathname = '/scheduler';
    act(() => setBasicUiMode('advanced'));
    act(() => setBasicUiMode('basic'));
    expect(screen.getByTestId('browser')).toBe(browser);
    expect(browser.getAttribute('data-visible')).toBe('false');
    expect(loadSecondaryPanelState('new-chat:p')).toEqual(saved);
    act(() => setBasicUiMode('advanced'));
    expect(browser.getAttribute('data-visible')).toBe('true');
  });

  it('hands off the latest layout when an asynchronous launch completes', () => {
    let launch!: () => void;
    render(<NewChatPanelLayout scopeId="p" project={project}>{handlers => {
      launch ??= () => handlers.onCreated('thread');
      return buttons(handlers);
    }}</NewChatPanelLayout>);
    show(); click('Open browser'); click('Visit page'); click('Resize');
    const before = loadSecondaryPanelState('new-chat:p');
    act(() => launch());
    expect(loadSecondaryPanelState('thread')).toEqual(before);
  });

  it('opens, hides, resizes and maximizes the existing panel; moves all tabs and selection into Modern', () => {
    renderDraft(); show(); click('Open file'); click('New tab'); click('Open browser'); click('Visit page'); click('Resize');
    const before = loadSecondaryPanelState('new-chat:p');
    click('Maximize');
    expect(screen.getByTestId('new-chat-panel-layout').className).toContain('is-secondary-maximized');
    click('Launch Modern');
    expect(loadSecondaryPanelState('thread')).toEqual({ ...before, isMaximized: true });
    expect(h.register).toHaveBeenCalledWith({ tabId: before.activeId, threadId: 'thread' });
    expect(loadSecondaryPanelState('new-chat:p')).toEqual(emptySecondaryPanelState());
    show(); expect(screen.queryByTestId('browser')).toBeNull();
    click('Hide'); show(); expect(screen.getByTestId('tools')).toBeTruthy();
  });

  it.each([true, false])('hands the selected shell to the CLI page or inspector (classic=%s)', async classic => {
    h.classic = classic; renderDraft(); show(); click('Start terminal');
    await screen.findByText('Shell: shell');
    const before = loadSecondaryPanelState('new-chat:p');
    click('Launch CLI');
    expect(loadSecondaryPanelState(classic ? 'cli' : 'cli:modal')).toEqual(before);
    expect(h.close).not.toHaveBeenCalled();
    expect(screen.queryByText('Shell: shell')).toBeNull();
    show(); expect(screen.getByTestId('tools')).toBeTruthy();
  });

  it('retains drafts across navigation, isolates projects, and preserves a hidden panel on launch', () => {
    const draft = renderDraft(); show(); click('Open file'); expect(screen.getByText('File: /p/README.md')).toBeTruthy();
    draft.unmount(); const other = renderDraft('q'); show(); expect(screen.getByTestId('tools')).toBeTruthy(); other.unmount();
    renderDraft(); showIfHidden(); expect(screen.getByText('File: /p/README.md')).toBeTruthy(); click('Hide'); click('Launch Modern');
    expect(loadSecondaryPanelState('thread')).toMatchObject({ isOpen: false, tabs: [{ path: '/p/README.md' }] });
  });

  it('opens Explorer, Inbox, plugin tools and recent pages, and keeps inactive browser views hidden', () => {
    renderDraft(); show(); click('Open Explorer'); expect(screen.getByText('Project files')).toBeTruthy();
    click('New tab'); click('Open Inbox'); expect(screen.getByText('Project inbox')).toBeTruthy();
    click('New tab'); click('Open plugin'); expect(screen.getByText('Plugin: {"mode":1}')).toBeTruthy();
    expect(screen.getByTestId('plugin-state').textContent).toBe('null'); click('Save plugin state');
    expect(screen.getByTestId('plugin-state').textContent).toBe('{"place":2}');
    click('New tab'); click('Recent'); expect(screen.getByTestId('browser')).toBeTruthy(); click('Blank page');
    expect(screen.getByRole('button', { name: 'Browser', exact: true })).toBeTruthy();
    click('Quick files'); expect(screen.getByText('Project files')).toBeTruthy();
    expect(h.file).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'new-chat:p', environmentId: '/p' }));
  });

  it('mounts a saved plugin tab with no project when the draft has none', () => {
    persistSecondaryPanelState('new-chat:p', { ...emptySecondaryPanelState(), isOpen: true, activeId: 'plugin:1', tabs: [{ id: 'plugin:1', kind: 'plugin', title: 'Docs', moduleId: 'docs', actionId: 'doc', params: { mode: 1 } }] });
    render(<NewChatPanelLayout scopeId="p" hostId="host">{buttons}</NewChatPanelLayout>);
    expect(screen.getByTestId('plugin-project').textContent).toBe('null');
  });

  it('shows a terminal failure without discarding the draft, then permits a retry', async () => {
    h.create.mockResolvedValueOnce({ ok: false, message: 'Host offline' });
    renderDraft(); show(); click('Quick terminal');
    expect((await screen.findByRole('alert')).textContent).toBe('Host offline');
    click('Start terminal'); await screen.findByText('Shell: shell');
    expect(h.create).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p', hostId: 'host' }));
  });

  it('closes a shell whose creation completes after launch or navigation', async () => {
    let resolve!: (value: unknown) => void;
    h.create.mockImplementation(() => new Promise(done => { resolve = done; }));
    const draft = renderDraft(); show(); click('Start terminal'); click('Launch Modern');
    await act(async () => resolve({ ok: true, value: { id: 'late', title: 'Terminal' } }));
    expect(h.close).toHaveBeenCalledWith('late');
    expect(loadSecondaryPanelState('thread').tabs).toEqual(expect.not.arrayContaining([expect.objectContaining({ sessionId: 'late' })]));
    draft.unmount(); renderDraft(); show(); click('Start terminal'); cleanup();
    await act(async () => resolve({ ok: true, value: { id: 'unmounted', title: 'Terminal' } }));
    expect(h.close).toHaveBeenCalledWith('unmounted');
  });

  it('supports the compact overlay and the unscoped launcher without creating shells', () => {
    h.compact = true; render(<NewChatPanelLayout scopeId="global">{buttons}</NewChatPanelLayout>); show();
    expect(screen.getByTestId('new-chat-panel-layout').className).toContain('is-compact');
    expect(screen.getByTestId('tools').getAttribute('data-terminals')).toBe('false');
    click('Start terminal'); expect(h.create).not.toHaveBeenCalled();
    click('Open browser'); expect(screen.getByTestId('browser').getAttribute('data-visible')).toBe('true');
  });

  it('does not show a native browser in an unfocused split', () => {
    h.focused = false;
    persistSecondaryPanelState('new-chat:p', { ...emptySecondaryPanelState({ isOpen: true }), activeId: 'b', tabs: [{ id: 'b', kind: 'browser', title: 'Browser' }] });
    renderDraft(); expect(screen.getByTestId('browser').getAttribute('data-visible')).toBe('false');
  });
});
function showIfHidden() { if (screen.queryByRole('button', { name: 'Show right panel' })) show(); }
