// @vitest-environment happy-dom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(() => ({event:(_:any) => {},updated:(_:any) => {},reconnect:() => {},off:vi.fn(),get:vi.fn(),timeline:vi.fn(),upsert:vi.fn(),panelOpen:false,interactions:[] as any[]}));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../../lib/product-client.js',() => ({product:{threads:{get:h.get,timeline:h.timeline,onEvent:(fn:any) => {h.event=fn;return h.off;},onUpdated:(fn:any) => {h.updated=fn;return h.off;}}}}));
vi.mock('../../lib/product-ws.js',() => ({subscribeProductReconnect:(fn:any) => {h.reconnect=fn;return h.off;}}));
vi.mock('../../thread-store.js',async original => ({...await original<any>(),useThreads:Object.assign((pick:any) => pick({threads:[],upsert:h.upsert}),{getState:() => ({threads:[],upsert:h.upsert})})}));
vi.mock('../../store.js',() => ({useData:(pick:any) => pick({projects:[]})}));
vi.mock('../../hooks/useRouteState.js',() => ({useRouteState:() => ({threadId:'a',isProjectFocused:false})}));
vi.mock('../../hooks/useCompactLayout.js',() => ({useCompactLayout:() => false}));
vi.mock('../../components/useMobileThreadTitleTarget.js',() => ({useMobileThreadTitleTarget:() => null,useMobileThreadActionsTarget:() => null,useMobileThreadControlsTarget:() => null}));
vi.mock('../../components/thread/secondary-panel/useThreadSecondaryPanel.js',() => ({useThreadSecondaryPanel:() => ({state:{tabs:[],isOpen:h.panelOpen,isMaximized:false,activeId:null,widthPx:320},open:() => {}})}));
vi.mock('../../components/thread/secondary-panel/ThreadSecondaryPanel.js',() => ({ThreadSecondaryPanel:({children}:any) => <aside data-testid="secondary-panel">{children}</aside>}));
vi.mock('../../components/thread/secondary-panel/BrowserTabDeck.js',() => ({BrowserTabDeck:() => null}));
vi.mock('../../components/thread/secondary-panel/useInAppBrowserPanel.js',() => ({useInAppBrowserPanel:() => {}}));
vi.mock('../../lib/use-desktop-browser-reveal.js',() => ({useDesktopBrowserReveal:() => {}}));
vi.mock('../../components/thread/secondary-panel/useThreadOpenFileSignal.js',() => ({useThreadOpenFileSignal:() => {},dispatchThreadOpenFile:() => {}}));
vi.mock('../../components/thread/secondary-panel/useThreadOpenTerminalSignal.js',() => ({useThreadOpenTerminalSignal:() => {}}));
vi.mock('../thread-detail/PaneContext.js',() => ({useOptionalPaneContext:() => null,usePaneSecondaryPanelRegistration:() => {}}));
vi.mock('../../components/thread/pending-interactions/useOpenPendingInteractions.js',async original => ({...await original<any>(),useOpenPendingInteractions:() => h.interactions}));
vi.mock('../../components/ThreadCommandComposer.js',() => ({ThreadCommandComposer:({sendBlocked,sendBlockedHint}:any) => <div data-testid="composer" data-blocked={String(sendBlocked)}>{sendBlockedHint}</div>}));
vi.mock('../../components/history/ArchivedThreadBanner.js',() => ({ArchivedThreadBanner:() => <div data-testid="archived-banner"/>}));
vi.mock('../../components/thread/pending-interactions/ThreadPendingInteractionBanner.js',() => ({ThreadPendingInteractionBanner:() => null}));
vi.mock('../../components/thread/ThreadTimeline.js',() => ({ThreadTimeline:({rows,hasOlder,loadingOlder,onLoadOlder,searchHitRowId,forceExpandedRowIds,loadError}:any) => <div>{rows.length} rows<div data-testid="selected-message">{searchHitRowId}</div><div data-testid="expanded-messages">{[...(forceExpandedRowIds ?? [])].join(',')}</div>{loadError && <div role="alert">{loadError}</div>}{hasOlder && <button disabled={loadingOlder} onClick={onLoadOlder}>Load older</button>}</div>}));
vi.mock('../../components/thread/ThreadWorkspaceBanner.js',() => ({ThreadWorkspaceBanner:() => null}));
vi.mock('../../components/thread/ThreadDetailOverflow.js',() => ({ThreadDetailOverflow:() => null}));
vi.mock('../../components/thread/ThreadDetailSearch.js',() => ({ThreadDetailSearch:() => null}));
vi.mock('../../components/thread/timeline/ThreadBanners.js',() => ({ThreadDetailHeading:({title}:any) => <h1>{title}</h1>,ThreadDetailActions:({children}:any) => children,ThreadPromptModeCard:() => null,ThreadStatusBadge:() => null,ThreadTodoCard:() => null}));
vi.mock('../../components/thread/timeline/ComposerStackCards.js',() => ({BackgroundCommandsCard:() => null,ModelFallbackCard:() => null,PromptContextBanner:() => null,QueuedMessagesCard:() => null}));
vi.mock('../../components/thread/pending-interactions/ChildThreadPendingBanners.js',() => ({ChildThreadPendingBanners:() => null}));
vi.mock('../../plugins/PluginThreadHeaderActions.js',() => ({PluginThreadHeaderActions:() => null}));
vi.mock('../../plugins/thread-panel-owner.js',() => ({ThreadPanelOwnerProvider:({children}:any) => children}));
import { ThreadDetail } from './ThreadDetailView.js';
afterEach(() => {cleanup();vi.clearAllMocks();h.interactions=[];});
const question={id:'q1',status:'pending',payload:{kind:'user_question',questions:[{id:'pick',prompt:'Pick one',multiSelect:false,allowFreeText:true}]}};
const approval={id:'a1',status:'pending',payload:{kind:'approval',reason:'r',availableDecisions:['deny'],subject:{kind:'command',itemId:'i',command:'ls',cwd:'/tmp',actions:[],sessionGrant:null}}};
async function show(thread:Record<string,unknown> = {}) {
  h.get.mockResolvedValue({thread:{id:'a',title:'Thread',status:'idle',createdAt:1,...thread}});
  h.timeline.mockResolvedValue({rows:[],maxSeq:0,status:'idle',activeThinking:null});
  render(<MemoryRouter><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await act(async () => {});
}
describe('composer hint while an interaction is open', () => {
  it('names an open question in the blocked-send hint', async () => {
    h.interactions=[question];
    await show();
    const composer=screen.getByTestId('composer');
    expect(composer.getAttribute('data-blocked')).toBe('true');
    expect(composer.textContent).toBe('Answer the question above first');
  });
  it('stays generic for an approval, and leaves sends open with nothing pending', async () => {
    h.interactions=[approval];
    await show();
    expect(screen.getByTestId('composer').textContent).toBe('Respond to the request above first');
    cleanup();
    h.interactions=[];
    await show();
    expect(screen.getByTestId('composer').getAttribute('data-blocked')).toBe('false');
  });
  it('shows the archived banner instead of the composer for an archived thread', async () => {
    h.interactions=[question];
    await show({archivedAt:5});
    await waitFor(() => expect(screen.getByTestId('archived-banner')).toBeTruthy());
    expect(screen.queryByTestId('composer')).toBeNull();
  });
});
