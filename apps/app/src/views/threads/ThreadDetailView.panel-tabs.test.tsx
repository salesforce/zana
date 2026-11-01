// @vitest-environment happy-dom
import { act,cleanup,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,expect,it,vi } from 'vitest';
const h=vi.hoisted(() => ({event:(_:any) => {},updated:(_:any) => {},reconnect:() => {},off:vi.fn(),get:vi.fn(),createTerminal:vi.fn(),addTab:vi.fn(),selectPin:vi.fn(),panelProps:null as any,bottomProps:null as any,diffProps:null as any,activateTab:vi.fn(),dockEnabled:false,timeline:vi.fn(),upsert:vi.fn(),state:{tabs:[] as any[],isOpen:true,isMaximized:false,activeId:'info' as string | null,widthPx:320}}));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../../lib/product-client.js',() => ({product:{environments:{status:vi.fn(async () => ({branchName:null})),pullRequest:vi.fn(async () => ({pullRequest:null}))},terminals:{create:h.createTerminal},threads:{get:h.get,timeline:h.timeline,onEvent:(fn:any) => {h.event=fn;return h.off;},onUpdated:(fn:any) => {h.updated=fn;return h.off;}}}}));
vi.mock('../../lib/product-ws.js',() => ({subscribeProductReconnect:(fn:any) => {h.reconnect=fn;return h.off;}}));
vi.mock('../../thread-store.js',async original => ({...await original<any>(),useThreads:Object.assign((pick:any) => pick({threads:[],upsert:h.upsert}),{getState:() => ({threads:[],upsert:h.upsert})})}));
vi.mock('../../store.js',() => ({useData:(pick:any) => pick({projects:[],dockableThreadToolsEnabled:h.dockEnabled})}));
vi.mock('../../hooks/useRouteState.js',() => ({useRouteState:() => ({threadId:'a',isProjectFocused:false})}));
vi.mock('../../hooks/useCompactLayout.js',() => ({useCompactLayout:() => false}));
vi.mock('../../components/useMobileThreadTitleTarget.js',() => ({useMobileThreadTitleTarget:() => null,useMobileThreadActionsTarget:() => null,useMobileThreadControlsTarget:() => null}));
vi.mock('../../components/thread/secondary-panel/useThreadSecondaryPanel.js',() => ({useThreadSecondaryPanel:() => ({state:h.state,open:() => {},addTab:h.addTab,selectPin:h.selectPin,activateTab:h.activateTab,patchTab:() => {}})}));
vi.mock('../../components/thread/secondary-panel/ThreadSecondaryPanel.js',() => ({ThreadSecondaryPanel:(props:any) => { if (props.dock?.side !== 'bottom') h.panelProps=props; else h.bottomProps=props; return <aside data-testid="secondary-panel">{props.children}</aside>; }}));
vi.mock('../../components/thread/secondary-panel/BrowserTabDeck.js',() => ({BrowserTabDeck:() => null}));
vi.mock('../../components/thread/secondary-panel/useInAppBrowserPanel.js',() => ({useInAppBrowserPanel:() => {}}));
vi.mock('../../lib/use-desktop-browser-reveal.js',() => ({useDesktopBrowserReveal:() => {}}));
vi.mock('../../components/thread/secondary-panel/useThreadOpenFileSignal.js',() => ({useThreadOpenFileSignal:() => {},dispatchThreadOpenFile:() => {}}));
vi.mock('../../components/thread/secondary-panel/useThreadOpenTerminalSignal.js',() => ({useThreadOpenTerminalSignal:() => {}}));
vi.mock('../thread-detail/PaneContext.js',() => ({useOptionalPaneContext:() => null,usePaneSecondaryPanelRegistration:() => {}}));
vi.mock('../../components/thread/pending-interactions/useOpenPendingInteractions.js',async original => ({...await original<any>(),useOpenPendingInteractions:() => []}));
vi.mock('../../components/ThreadCommandComposer.js',() => ({ThreadCommandComposer:({serviceTier}:any) => <div data-testid="composer-tier">{serviceTier ?? 'default'}</div>}));
vi.mock('../../components/thread/ThreadTimeline.js',() => ({ThreadTimeline:({rows,hasOlder,loadingOlder,onLoadOlder,searchHitRowId,forceExpandedRowIds,loadError,onOpenDiff}:any) => <div><button onClick={() => onOpenDiff?.('a.ts')}>Open changed file</button>{rows.length} rows<div data-testid="selected-message">{searchHitRowId}</div><div data-testid="expanded-messages">{[...(forceExpandedRowIds ?? [])].join(',')}</div>{loadError && <div role="alert">{loadError}</div>}{hasOlder && <button disabled={loadingOlder} onClick={onLoadOlder}>Load older</button>}</div>}));
vi.mock('../../components/thread/ThreadWorkspaceBanner.js',() => ({ThreadWorkspaceBanner:() => null}));
vi.mock('../../components/thread/ThreadDetailOverflow.js',() => ({ThreadDetailOverflow:() => null}));
vi.mock('../../components/thread/ThreadDetailSearch.js',() => ({ThreadDetailSearch:() => null}));
vi.mock('../../components/thread/timeline/ThreadBanners.js',() => ({ThreadDetailHeading:({title}:any) => <h1>{title}</h1>,ThreadDetailActions:({children}:any) => children,ThreadPromptModeCard:() => null,ThreadStatusBadge:() => null,ThreadTodoCard:() => null}));
vi.mock('../../components/thread/timeline/ComposerStackCards.js',() => ({BackgroundCommandsCard:() => null,ModelFallbackCard:() => null,PromptContextBanner:() => null,QueuedMessagesCard:() => null}));
vi.mock('../../components/thread/pending-interactions/ChildThreadPendingBanners.js',() => ({ChildThreadPendingBanners:() => null}));
vi.mock('../../plugins/PluginThreadHeaderActions.js',() => ({PluginThreadHeaderActions:() => null}));
vi.mock('../../plugins/thread-panel-owner.js',() => ({ThreadPanelOwnerProvider:({children}:any) => children}));
vi.mock('../../components/thread/secondary-panel/ThreadInfoContent.js',() => ({ThreadInfoContent:(props:any) => <div data-testid="tab-ThreadInfoContent" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/ThreadDiffPanel.js',() => ({ThreadDiffPanel:(props:any) => {h.diffProps=props;return <div data-testid="tab-ThreadDiffPanel" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>;}}));
vi.mock('../../components/thread/secondary-panel/ThreadNewTabPage.js',() => ({ThreadNewTabPage:(props:any) => <div data-testid="tab-ThreadNewTabPage" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadFilePreviewTab.js',() => ({ThreadFilePreviewTab:(props:any) => <div data-testid="tab-ThreadFilePreviewTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadTerminalTab.js',() => ({ThreadTerminalTab:(props:any) => <div data-testid="tab-ThreadTerminalTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadPluginTab.js',() => ({ThreadPluginTab:(props:any) => <div data-testid="tab-ThreadPluginTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadExplorerTab.js',() => ({ThreadExplorerTab:(props:any) => <div data-testid="tab-ThreadExplorerTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadInboxTab.js',() => ({ThreadInboxTab:(props:any) => <div data-testid="tab-ThreadInboxTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
import { ThreadDetail } from './ThreadDetailView.js';
afterEach(() => {cleanup();vi.clearAllMocks();h.dockEnabled=false;h.bottomProps=null;localStorage.clear();});

const tabs = [
  { id: 't-new', kind: 'new-tab', title: 'New Tab' },
  { id: 't-file', kind: 'file-preview', title: 'a.ts', path: 'a.ts' },
  { id: 't-browser', kind: 'browser', title: 'Browser', url: '' },
  { id: 't-term', kind: 'terminal', title: 'Terminal', sessionId: 's1' },
  { id: 't-explorer', kind: 'explorer', title: 'Explorer' },
  { id: 't-inbox', kind: 'inbox', title: 'Inbox' },
  { id: 't-plugin', kind: 'plugin', title: 'Graph', moduleId: 'salesforce', actionId: 'graph', params: { node: 'n1' }, layout: 'flush' }
];
const expected: Record<string, string | null> = {
  info: 'ThreadInfoContent', 't-new': 'ThreadNewTabPage', 't-file': 'ThreadFilePreviewTab', 't-browser': null,
  't-term': null, 't-explorer': 'ThreadExplorerTab', 't-inbox': 'ThreadInboxTab', 't-plugin': 'ThreadPluginTab'
};

it('shows each side-panel tab kind and tells a plugin tab its surface and tab id', async () => {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Panel thread', status: 'idle', createdAt: 1 } });
  h.timeline.mockResolvedValue({ rows: [], maxSeq: 0, status: 'idle' });
  h.state.tabs = tabs;
  const content = () => <MemoryRouter><ThreadDetail threadId="a"/></MemoryRouter>;
  const view = render(content());
  await act(async () => {});
  for (const [activeId, component] of Object.entries(expected)) {
    h.state = { ...h.state, activeId };
    view.rerender(content());
    const shown = Object.values(expected).filter(Boolean).map(name => screen.queryByTestId(`tab-${name}`)).filter(Boolean);
    // A terminal needs a project; a browser tab draws through the native deck.
    expect(shown.map(node => node!.dataset.testid)).toEqual(component ? [`tab-${component}`] : []);
  }
  h.state = { ...h.state, activeId: 't-plugin' };
  view.rerender(content());
  expect(JSON.parse(screen.getByTestId('tab-ThreadPluginTab').dataset.props!)).toMatchObject({
    moduleId: 'salesforce', threadId: 'a', actionId: 'graph', params: { node: 'n1' }, layout: 'flush', surface: 'thread', tabId: 't-plugin'
  });
  // Diff and Plan pins without an environment or plan fall back to their empty states.
  h.state = { ...h.state, activeId: 'diff' };
  view.rerender(content());
  expect(screen.getByText('No environment is attached to this agent.')).toBeTruthy();
});


it('quick-add appends tools to the chosen dock and reports terminal creation failures', async () => {
  h.dockEnabled = true;
  h.state = { tabs: [], isOpen: true, isMaximized: false, activeId: 'info', widthPx: 320 };
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Dock thread', status: 'idle', createdAt: 1, projectId: 'p', hostId: 'host', environmentId: 'env', cwd: '/checkout' } });
  h.timeline.mockResolvedValue({ rows: [], maxSeq: 0, status: 'idle' });
  render(<MemoryRouter><ThreadDetail threadId="a"/></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Dock thread' })).toBeTruthy());
  expect(h.panelProps.onAddTool).toBeTypeOf('function');
  act(() => h.panelProps.onAddTool('browser'));
  expect(h.addTab).toHaveBeenLastCalledWith({ kind: 'browser', title: 'Browser', url: '', id: expect.stringMatching(/^browser:/) });
  act(() => h.panelProps.onAddTool('explorer'));
  expect(h.addTab).toHaveBeenLastCalledWith({ kind: 'explorer', title: 'Explorer', id: expect.stringMatching(/^explorer:/) });
  expect(h.selectPin).toHaveBeenLastCalledWith('info');
  h.createTerminal.mockResolvedValueOnce({ ok: true, value: { id: 'shell', title: 'Shell' } });
  await act(async () => h.panelProps.onAddTool('terminal'));
  expect(h.createTerminal).toHaveBeenCalledWith({ projectId: 'p', profile: 'shell', hostId: 'host', workspace: { kind: 'reuse', environmentId: 'env' }, cwd: '/checkout', cols: 80, rows: 24, prompt: undefined, title: 'Terminal' });
  expect(h.addTab).toHaveBeenLastCalledWith({ kind: 'terminal', title: 'Shell', sessionId: 'shell', id: expect.stringMatching(/^terminal:/) });
  const added = h.addTab.mock.calls.length;
  h.createTerminal.mockResolvedValueOnce({ ok: false, message: 'Host unavailable' });
  await act(async () => h.panelProps.onAddTool('terminal'));
  expect(screen.getByRole('alert').textContent).toContain('Host unavailable');
  expect(h.addTab).toHaveBeenCalledTimes(added);
  h.createTerminal.mockRejectedValueOnce(new Error('Connection lost'));
  await act(async () => h.panelProps.onAddTool('terminal'));
  expect(screen.getByRole('alert').textContent).toContain('Connection lost');
  expect(h.addTab).toHaveBeenCalledTimes(added);
});

it('moves pinned views between panes and keeps independent selections without closable tool tabs', async () => {
  h.dockEnabled = true;
  h.state = { tabs: [], isOpen: true, isMaximized: false, activeId: 'info', widthPx: 320 };
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Pinned tabs', status: 'idle', createdAt: 1, projectId: 'p', hostId: 'host', environmentId: 'env' } });
  h.timeline.mockResolvedValue({ rows: [], maxSeq: 0, status: 'idle' });
  const content = () => <MemoryRouter><ThreadDetail threadId="a"/></MemoryRouter>;
  const view = render(content());
  await waitFor(() => expect(h.panelProps.showDiffPin).toBe(true));
  act(() => h.panelProps.dock.onMove('info'));
  expect(h.panelProps.showInfoPin).toBe(false);
  expect(h.bottomProps.showInfoPin).toBe(true);
  expect(h.bottomProps.state).toMatchObject({ activeId: 'info', tabs: [], isOpen: true });
  act(() => h.panelProps.onSelectDiff());
  expect(h.selectPin).toHaveBeenLastCalledWith('diff');
  expect(h.panelProps.state.activeId).toBe('diff');
  act(() => h.bottomProps.onSelectInfo());
  expect(h.selectPin).toHaveBeenLastCalledWith('info');
  expect(h.panelProps.state.activeId).toBe('diff');
  expect(h.bottomProps.state.activeId).toBe('info');
  act(() => h.diffProps.onClose());
  expect(h.bottomProps.state.activeId).toBe('info');
  expect(h.panelProps.state.activeId).toBe('diff');
  act(() => h.bottomProps.dock.onToggleCollapsed());
  expect(h.bottomProps.dock.collapsed).toBe(true);
  act(() => h.bottomProps.onSelectInfo());
  expect(h.bottomProps.dock.collapsed).toBe(false);
  h.state = { ...h.state, activeId: 'diff' };
  view.rerender(content());
  act(() => h.panelProps.dock.onMove('diff'));
  expect(h.bottomProps.showDiffPin).toBe(true);
  expect(h.panelProps.showDiffPin).toBe(false);
  act(() => h.bottomProps.dock.onToggleCollapsed());
  act(() => screen.getByRole('button', { name: 'Open changed file' }).click());
  expect(h.bottomProps.dock.collapsed).toBe(false);
  expect(h.bottomProps.state.activeId).toBe('diff');
  act(() => h.bottomProps.dock.onMove('diff'));
  expect(h.panelProps.showDiffPin).toBe(true);
  expect(h.selectPin).toHaveBeenLastCalledWith('diff');
  expect(h.activateTab).not.toHaveBeenCalled();
  expect(h.addTab).not.toHaveBeenCalled();
  act(() => screen.getByRole('button', { name: 'Open changed file' }).click());
  expect(h.panelProps.state.activeId).toBe('diff');
  h.state = { ...h.state, tabs: [{ id: 'browser', kind: 'browser', title: 'Browser' }] };
  view.rerender(content());
  act(() => h.panelProps.onActivateTab('browser'));
  expect(h.activateTab).toHaveBeenLastCalledWith('browser');
  act(() => h.panelProps.dock.onMove('browser'));
  act(() => h.bottomProps.onActivateTab('browser'));
  expect(h.bottomProps.state.activeId).toBe('browser');
  act(() => h.bottomProps.dock.onMove('browser'));
  expect(h.panelProps.state.activeId).toBe('browser');
  const event = { dataTransfer: { setData: vi.fn(), effectAllowed: '', dropEffect: '' }, preventDefault: vi.fn() };
  act(() => { h.panelProps.dock.onDragOver(event); h.panelProps.dock.onDrop(event); });
  expect(event.preventDefault).not.toHaveBeenCalled();
  act(() => h.panelProps.dock.onDragStart(event, 'browser'));
  expect(event.dataTransfer.setData).toHaveBeenCalledWith('application/x-zcc-thread-tool', 'browser');
  expect(event.dataTransfer.effectAllowed).toBe('move');
  act(() => h.bottomProps.dock.onDragOver(event));
  expect(event.dataTransfer.dropEffect).toBe('move');
  act(() => h.bottomProps.dock.onDrop(event));
  expect(h.bottomProps.state.activeId).toBe('browser');
  act(() => h.bottomProps.dock.onDragStart(event, 'info'));
  act(() => h.panelProps.dock.onDrop(event));
  expect(h.panelProps.showInfoPin).toBe(true);
  expect(h.panelProps.state.activeId).toBe('info');
  act(() => h.panelProps.dock.onDragEnd());
  act(() => h.panelProps.onNewTab());
  expect(h.addTab).toHaveBeenLastCalledWith({ id: expect.stringMatching(/^new-tab:/), kind: 'new-tab', title: 'New Tab' });
  act(() => h.bottomProps.onNewTab());
  const newTab = h.addTab.mock.calls.at(-1)![0];
  h.state = { ...h.state, activeId: newTab.id, tabs: [...h.state.tabs, newTab] };
  view.rerender(content());
  expect(h.bottomProps.state.activeId).toBe(newTab.id);
});
