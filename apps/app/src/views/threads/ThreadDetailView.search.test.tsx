// @vitest-environment happy-dom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(() => ({outline:vi.fn(),event:(_:any) => {},updated:(_:any) => {},reconnect:() => {},off:vi.fn(),get:vi.fn(),timeline:vi.fn(),upsert:vi.fn(),panelOpen:false}));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../../lib/product-client.js',() => ({product:{threads:{get:h.get,timeline:h.timeline,conversationOutline:h.outline,onEvent:(fn:any) => {h.event=fn;return h.off;},onUpdated:(fn:any) => {h.updated=fn;return h.off;}}}}));
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
vi.mock('../../components/thread/pending-interactions/useOpenPendingInteractions.js',async original => ({...await original<any>(),useOpenPendingInteractions:() => []}));
vi.mock('../../components/ThreadCommandComposer.js',() => ({ThreadCommandComposer:({serviceTier}:any) => <div data-testid="composer-tier">{serviceTier ?? 'default'}</div>}));
vi.mock('../../components/thread/ThreadTimeline.js',() => ({ThreadTimeline:({rows,searchHitRowId,forceExpandedRowIds,search}:any) => <div>{rows.length} rows<div data-testid="selected-message">{searchHitRowId}</div><div data-testid="expanded-messages">{[...(forceExpandedRowIds ?? [])].join(',')}</div><div data-testid="timeline-search">{search ? `${search.query}#${search.occurrence}@${search.navigation}` : 'none'}</div></div>}));
vi.mock('../../components/thread/ThreadWorkspaceBanner.js',() => ({ThreadWorkspaceBanner:() => null}));
vi.mock('../../components/thread/ThreadDetailOverflow.js',() => ({ThreadDetailOverflow:() => null}));
vi.mock('../../components/thread/ThreadDetailSearch.js',() => ({ThreadDetailSearch:({value,onChange,onSubmit,matchIndex,matchCount,partial}:any) => <form>
  <input aria-label="Search in thread" value={value} onChange={(event) => onChange(event.target.value)}/>
  <button type="button" onClick={() => onSubmit(value.trim(),'next')}>Next</button>
  <button type="button" onClick={() => onSubmit(value.trim(),'previous')}>Previous</button>
  <output data-testid="counter">{matchCount === undefined ? 'hidden' : `${matchIndex + 1}/${matchCount}${partial ? '+' : ''}`}</output>
</form>}));
vi.mock('../../components/thread/timeline/ThreadBanners.js',() => ({ThreadDetailHeading:({title}:any) => <h1>{title}</h1>,ThreadDetailActions:({children}:any) => children,ThreadPromptModeCard:() => null,ThreadStatusBadge:() => null,ThreadTodoCard:() => null}));
vi.mock('../../components/thread/timeline/ComposerStackCards.js',() => ({BackgroundCommandsCard:() => null,ModelFallbackCard:() => null,PromptContextBanner:() => null,QueuedMessagesCard:() => null}));
vi.mock('../../components/thread/pending-interactions/ChildThreadPendingBanners.js',() => ({ChildThreadPendingBanners:() => null}));
vi.mock('../../plugins/PluginThreadHeaderActions.js',() => ({PluginThreadHeaderActions:() => null}));
vi.mock('../../plugins/thread-panel-owner.js',() => ({ThreadPanelOwnerProvider:({children}:any) => children}));
import { ThreadDetail } from './ThreadDetailView.js';
afterEach(() => {cleanup();vi.clearAllMocks();});

const message = (id: string, text: string, sequence: number) => ({
  id, kind: 'conversation', threadId: 'a', turnId: null, role: 'assistant',
  text, attachments: null, turnRequest: null,
  sourceSeqStart: sequence, sourceSeqEnd: sequence, startedAt: 0, createdAt: 0
});

async function openThread(path = '/') {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Search thread', status: 'idle', createdAt: 1 } });
  h.timeline.mockResolvedValue({ rows: [message('m1', 'cat cat', 1), message('m2', 'dog', 2), message('m3', 'Cat', 3)], maxSeq: 3, status: 'idle' });
  h.outline.mockResolvedValue({ items: [], maxSeq: 3, matches: [] });
  render(<MemoryRouter initialEntries={[path]}><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('3 rows')).toBeTruthy());
}

const type = (text: string) => fireEvent.change(screen.getByLabelText('Search in thread'), { target: { value: text } });

describe('find in thread', () => {
  it('counts, selects and steps through matches, and drops the highlight when the draft changes', async () => {
    await openThread();
    expect(screen.getByTestId('counter').textContent).toBe('hidden');
    expect(screen.getByTestId('timeline-search').textContent).toBe('none');

    type('cat');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByTestId('counter').textContent).toBe('1/3'));
    expect(h.outline).toHaveBeenCalledWith('a', 'cat');
    expect(screen.getByTestId('selected-message').textContent).toBe('m1');
    expect(screen.getByTestId('expanded-messages').textContent).toBe('m1');
    expect(screen.getByTestId('timeline-search').textContent).toMatch(/^cat#0@/);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('timeline-search').textContent).toMatch(/^cat#1@/);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('counter').textContent).toBe('3/3');
    expect(screen.getByTestId('selected-message').textContent).toBe('m3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('counter').textContent).toBe('1/3');
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByTestId('counter').textContent).toBe('3/3');

    // Editing the draft hides the stale counter and highlights until it is submitted.
    type('cats');
    expect(screen.getByTestId('counter').textContent).toBe('hidden');
    expect(screen.getByTestId('timeline-search').textContent).toBe('none');
    expect(screen.getByTestId('selected-message').textContent).toBe('');

    type('zebra');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByTestId('counter').textContent).toBe('0/0'));
    expect(screen.getByTestId('timeline-search').textContent).toMatch(/^zebra#-1@/);

    type('');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('counter').textContent).toBe('hidden');
    expect(screen.getByTestId('timeline-search').textContent).toBe('none');
  });

  it('ends a message link highlight once a search runs, so clearing it does not jump back', async () => {
    await openThread('/?message=2');
    await waitFor(() => expect(screen.getByTestId('selected-message').textContent).toBe('m2'));
    type('cat');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByTestId('selected-message').textContent).toBe('m1'));
    type('');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('selected-message').textContent).toBe('');
    expect(screen.getByTestId('expanded-messages').textContent).toBe('');
  });

  it('marks the counter partial when the outline search fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await openThread();
    h.outline.mockRejectedValueOnce(new Error('offline'));
    type('cat');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByTestId('counter').textContent).toBe('1/3+'));
    warn.mockRestore();
  });
});
