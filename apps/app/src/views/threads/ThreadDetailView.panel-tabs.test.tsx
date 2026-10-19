// @vitest-environment happy-dom
import { act,cleanup,render,screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,expect,it,vi } from 'vitest';
const h=vi.hoisted(() => ({event:(_:any) => {},updated:(_:any) => {},reconnect:() => {},off:vi.fn(),get:vi.fn(),timeline:vi.fn(),upsert:vi.fn(),state:{tabs:[] as any[],isOpen:true,isMaximized:false,activeId:'info' as string | null,widthPx:320}}));
vi.mock('../../lib/product-client.js',() => ({product:{threads:{get:h.get,timeline:h.timeline,onEvent:(fn:any) => {h.event=fn;return h.off;},onUpdated:(fn:any) => {h.updated=fn;return h.off;}}}}));
vi.mock('../../lib/product-ws.js',() => ({subscribeProductReconnect:(fn:any) => {h.reconnect=fn;return h.off;}}));
vi.mock('../../thread-store.js',async original => ({...await original<any>(),useThreads:Object.assign((pick:any) => pick({threads:[],upsert:h.upsert}),{getState:() => ({threads:[],upsert:h.upsert})})}));
vi.mock('../../store.js',() => ({useData:(pick:any) => pick({projects:[]})}));
vi.mock('../../hooks/useRouteState.js',() => ({useRouteState:() => ({threadId:'a',isProjectFocused:false})}));
vi.mock('../../hooks/useCompactLayout.js',() => ({useCompactLayout:() => false}));
vi.mock('../../components/useMobileThreadTitleTarget.js',() => ({useMobileThreadTitleTarget:() => null,useMobileThreadActionsTarget:() => null,useMobileThreadControlsTarget:() => null}));
vi.mock('../../components/thread/secondary-panel/useThreadSecondaryPanel.js',() => ({useThreadSecondaryPanel:() => ({state:h.state,open:() => {},addTab:() => {},selectPin:() => {},patchTab:() => {}})}));
vi.mock('../../components/thread/secondary-panel/ThreadSecondaryPanel.js',() => ({ThreadSecondaryPanel:({children}:any) => <aside data-testid="secondary-panel">{children}</aside>}));
vi.mock('../../components/thread/secondary-panel/BrowserTabDeck.js',() => ({BrowserTabDeck:() => null}));
vi.mock('../../components/thread/secondary-panel/useInAppBrowserPanel.js',() => ({useInAppBrowserPanel:() => {}}));
vi.mock('../../lib/use-desktop-browser-reveal.js',() => ({useDesktopBrowserReveal:() => {}}));
vi.mock('../../components/thread/secondary-panel/useThreadOpenFileSignal.js',() => ({useThreadOpenFileSignal:() => {},dispatchThreadOpenFile:() => {}}));
vi.mock('../../components/thread/secondary-panel/useThreadOpenTerminalSignal.js',() => ({useThreadOpenTerminalSignal:() => {}}));
vi.mock('../thread-detail/PaneContext.js',() => ({useOptionalPaneContext:() => null,usePaneSecondaryPanelRegistration:() => {}}));
vi.mock('../../components/thread/pending-interactions/useOpenPendingInteractions.js',async original => ({...await original<any>(),useOpenPendingInteractions:() => []}));
vi.mock('../../components/ThreadCommandComposer.js',() => ({ThreadCommandComposer:({serviceTier}:any) => <div data-testid="composer-tier">{serviceTier ?? 'default'}</div>}));
vi.mock('../../components/thread/ThreadTimeline.js',() => ({ThreadTimeline:({rows,hasOlder,loadingOlder,onLoadOlder,searchHitRowId,forceExpandedRowIds,loadError}:any) => <div>{rows.length} rows<div data-testid="selected-message">{searchHitRowId}</div><div data-testid="expanded-messages">{[...(forceExpandedRowIds ?? [])].join(',')}</div>{loadError && <div role="alert">{loadError}</div>}{hasOlder && <button disabled={loadingOlder} onClick={onLoadOlder}>Load older</button>}</div>}));
vi.mock('../../components/thread/ThreadWorkspaceBanner.js',() => ({ThreadWorkspaceBanner:() => null}));
vi.mock('../../components/thread/ThreadDetailOverflow.js',() => ({ThreadDetailOverflow:() => null}));
vi.mock('../../components/thread/ThreadDetailSearch.js',() => ({ThreadDetailSearch:() => null}));
vi.mock('../../components/thread/timeline/ThreadBanners.js',() => ({ThreadDetailHeading:({title}:any) => <h1>{title}</h1>,ThreadDetailActions:({children}:any) => children,ThreadPromptModeCard:() => null,ThreadStatusBadge:() => null,ThreadTodoCard:() => null}));
vi.mock('../../components/thread/timeline/ComposerStackCards.js',() => ({BackgroundCommandsCard:() => null,ModelFallbackCard:() => null,PromptContextBanner:() => null,QueuedMessagesCard:() => null}));
vi.mock('../../components/thread/pending-interactions/ChildThreadPendingBanners.js',() => ({ChildThreadPendingBanners:() => null}));
vi.mock('../../plugins/PluginThreadHeaderActions.js',() => ({PluginThreadHeaderActions:() => null}));
vi.mock('../../plugins/thread-panel-owner.js',() => ({ThreadPanelOwnerProvider:({children}:any) => children}));
vi.mock('../../components/thread/secondary-panel/ThreadInfoContent.js',() => ({ThreadInfoContent:(props:any) => <div data-testid="tab-ThreadInfoContent" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/ThreadDiffPanel.js',() => ({ThreadDiffPanel:(props:any) => <div data-testid="tab-ThreadDiffPanel" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadNewTabPage.js',() => ({ThreadNewTabPage:(props:any) => <div data-testid="tab-ThreadNewTabPage" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadFilePreviewTab.js',() => ({ThreadFilePreviewTab:(props:any) => <div data-testid="tab-ThreadFilePreviewTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadTerminalTab.js',() => ({ThreadTerminalTab:(props:any) => <div data-testid="tab-ThreadTerminalTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadPluginTab.js',() => ({ThreadPluginTab:(props:any) => <div data-testid="tab-ThreadPluginTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadExplorerTab.js',() => ({ThreadExplorerTab:(props:any) => <div data-testid="tab-ThreadExplorerTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
vi.mock('../../components/thread/secondary-panel/ThreadInboxTab.js',() => ({ThreadInboxTab:(props:any) => <div data-testid="tab-ThreadInboxTab" data-props={JSON.stringify(props,(_k,v) => typeof v === 'function' ? undefined : v)}/>}));
import { ThreadDetail } from './ThreadDetailView.js';
afterEach(() => {cleanup();vi.clearAllMocks();});

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
