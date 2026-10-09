// @vitest-environment happy-dom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(() => ({event:(_:any) => {},updated:(_:any) => {},reconnect:() => {},off:vi.fn(),get:vi.fn(),timeline:vi.fn(),upsert:vi.fn(),panelOpen:false}));
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
import { ThreadDetail } from './ThreadDetailView.js';
afterEach(() => {cleanup();vi.useRealTimers();vi.clearAllMocks();h.panelOpen=false;});
it('wires bounded continuous refresh, matching filters, reconnect and unmount cancellation through the real detail effect',async () => {
  vi.useFakeTimers();
  h.get.mockResolvedValue({thread:{id:'a',title:'Loaded thread',status:'idle',createdAt:1}});
  h.timeline.mockResolvedValue({rows:[],maxSeq:0,status:'idle',activeThinking:null});
  const view=render(<MemoryRouter><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await act(async () => {});expect(h.get).toHaveBeenCalledTimes(1);expect(h.timeline).toHaveBeenCalledTimes(1);
  act(() => {h.event({threadId:'other',sequence:1});h.updated({id:'other'});vi.advanceTimersByTime(1000);});
  expect(h.get).toHaveBeenCalledTimes(1);
  await act(async () => {for(let index=0;index<20;index++){h.event({threadId:'a',sequence:index+1});vi.advanceTimersByTime(25);await Promise.resolve();}});
  expect(h.get.mock.calls.length).toBeGreaterThanOrEqual(3);
  await act(async () => {h.reconnect();vi.advanceTimersByTime(100);});
  const count=h.get.mock.calls.length;
  act(() => h.event({threadId:'a',sequence:100}));view.unmount();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(h.get).toHaveBeenCalledTimes(count);expect(h.off).toHaveBeenCalledTimes(3);
});

it('keeps hidden panes idle and catches up once on reveal using the loaded sequence',async () => {
  vi.useFakeTimers();
  h.get.mockResolvedValue({thread:{id:'a',title:'Retained thread',status:'idle',createdAt:1}});
  h.timeline.mockResolvedValue({rows:[],maxSeq:10,status:'idle',activeThinking:null});
  const content = (enabled:boolean) => <MemoryRouter><ThreadDetail threadId="a" embedded timelineEnabled={enabled}/></MemoryRouter>;
  const view=render(content(false));
  await act(async () => {});
  expect(h.get).not.toHaveBeenCalled();expect(h.timeline).not.toHaveBeenCalled();
  view.rerender(content(true));await act(async () => {});
  expect(h.timeline).toHaveBeenCalledTimes(1);
  view.rerender(content(false));
  const offCount=h.off.mock.calls.length;
  await act(async () => {for(let index=0;index<100;index++){h.event({threadId:'a',sequence:index+11});h.updated({id:'a'});h.reconnect();vi.advanceTimersByTime(25);}});
  expect(h.timeline).toHaveBeenCalledTimes(1);expect(h.off).toHaveBeenCalledTimes(offCount);
  expect(screen.getByRole('heading',{name:'Retained thread'})).toBeTruthy();
  h.timeline.mockResolvedValue({delta:{upsertRows:[]},maxSeq:111,status:'idle'});
  view.rerender(content(true));await act(async () => {});
  expect(h.timeline).toHaveBeenCalledTimes(2);
  expect(h.timeline.mock.calls[1]?.[1]).toMatchObject({afterSequence:'10'});
  expect(screen.getByRole('heading',{name:'Retained thread'})).toBeTruthy();
});

it('aborts hidden in-flight requests and ignores their late results',async () => {
  let finish: (value:any) => void = () => {};
  h.get.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
  h.timeline.mockResolvedValue({rows:[],maxSeq:0,status:'idle'});
  const content=(enabled:boolean) => <MemoryRouter><ThreadDetail threadId="a" embedded timelineEnabled={enabled}/></MemoryRouter>;
  const view=render(content(true));await act(async () => {});
  const signal=h.get.mock.calls[0]?.[1].signal;
  view.rerender(content(false));expect(signal.aborted).toBe(true);
  await act(async () => finish({thread:{id:'a',title:'Stale hidden result',status:'idle'}}));
  expect(screen.queryByRole('heading',{name:'Stale hidden result'})).toBeNull();
});

it('aborts an older-history request on hide and allows paging again after reveal', async () => {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Paging thread', status: 'idle', createdAt: 1 } });
  const page = { rows: [], maxSeq: 10, status: 'idle', timelinePage: { hasOlderRows: true, olderCursor: { anchorId: 'older', anchorSeq: 5 } } };
  h.timeline.mockResolvedValue(page);
  const content = (enabled: boolean) => <MemoryRouter><ThreadDetail threadId="a" embedded timelineEnabled={enabled}/></MemoryRouter>;
  const view = render(content(true));
  await act(async () => {});
  let finish!: (value: unknown) => void;
  h.timeline.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
  expect((screen.getByRole('button', { name: 'Load older' }) as HTMLButtonElement).disabled).toBe(true);
  const signal = h.timeline.mock.calls[1]?.[2].signal;
  view.rerender(content(false));
  expect(signal.aborted).toBe(true);
  view.rerender(content(true));
  await act(async () => {});
  expect((screen.getByRole('button', { name: 'Load older' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => finish({ ...page, timelinePage: { hasOlderRows: false } }));
  expect(screen.getByRole('button', { name: 'Load older' })).toBeTruthy();
  h.timeline.mockResolvedValueOnce({ ...page, timelinePage: { hasOlderRows: false } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load older' })));
  expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
});

const message = (id: string, sequence: number) => ({
  id, kind: 'conversation', threadId: 'a', turnId: null, role: 'assistant',
  text: id, attachments: null, turnRequest: null,
  sourceSeqStart: sequence, sourceSeqEnd: sequence, startedAt: 0, createdAt: 0
});
const historyPage = (rows: ReturnType<typeof message>[], cursor: string | null = null) => ({
  rows, maxSeq: 10, status: 'idle',
  timelinePage: { hasOlderRows: cursor !== null, olderCursor: cursor ? { anchorId: cursor, anchorSeq: 5 } : null }
});

it('selects a message link from the loaded page and preserves the configured service tier', async () => {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Linked thread', status: 'idle', serviceTier: 'priority' } });
  h.timeline.mockResolvedValue(historyPage([message('linked-message', 7)]));
  render(<MemoryRouter initialEntries={['/threads/a?message=7']}><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('selected-message').textContent).toBe('linked-message'));
  expect(screen.getByTestId('expanded-messages').textContent).toBe('linked-message');
  expect(screen.getByTestId('composer-tier').textContent).toBe('priority');
  expect(h.timeline).toHaveBeenCalledTimes(1);
  act(() => h.reconnect());
  await waitFor(() => expect(h.timeline).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('selected-message').textContent).toBe('linked-message');
});

it('pages backward for a message link and stops after finding the selected message', async () => {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Older link', status: 'idle' } });
  h.timeline.mockResolvedValueOnce(historyPage([message('recent', 10)], 'cursor-1'))
    .mockResolvedValueOnce(historyPage([message('middle', 5)], 'cursor-2'))
    .mockResolvedValueOnce(historyPage([message('linked-older', 2)], 'cursor-3'));
  render(<MemoryRouter initialEntries={['/threads/a?message=2']}><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('selected-message').textContent).toBe('linked-older'));
  expect(h.timeline).toHaveBeenCalledTimes(3);
  expect(h.timeline.mock.calls[1]?.[1]).toMatchObject({ beforeAnchorId: 'cursor-1' });
  expect(h.timeline.mock.calls[2]?.[1]).toMatchObject({ beforeAnchorId: 'cursor-2' });
  expect(screen.getByRole('button', { name: 'Load older' })).toBeTruthy();
});

it('does not loop when the older-history cursor fails to advance', async () => {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Stalled cursor', status: 'idle' } });
  h.timeline.mockResolvedValue(historyPage([message('recent', 10)], 'unchanged-cursor'));
  render(<MemoryRouter initialEntries={['/threads/a?message=2']}><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await waitFor(() => expect(h.timeline).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(h.timeline).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('selected-message').textContent).toBe('');
});

it.each(['invalid', '-1', '1.5', '9007199254740992'])('ignores malformed message link %s without paging', async (sequence) => {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Invalid link', status: 'idle' } });
  h.timeline.mockResolvedValue(historyPage([message('recent', 10)], 'older'));
  render(<MemoryRouter initialEntries={[`/threads/a?message=${sequence}`]}><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Invalid link' })).toBeTruthy());
  expect(h.timeline).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('selected-message').textContent).toBe('');
  expect(screen.getByTestId('composer-tier').textContent).toBe('default');
});

it('reports a failed older-page request without discarding the current messages', async () => {
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Paging failure', status: 'idle' } });
  h.timeline.mockResolvedValueOnce(historyPage([message('retained', 10)], 'older'))
    .mockRejectedValueOnce(new Error('Older history disconnected'));
  render(<MemoryRouter><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Load older' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Older history disconnected'));
  expect(screen.getByText('1 rows')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Load older' }) as HTMLButtonElement).disabled).toBe(false);
});

describe('secondary panel when embedded',() => {
  const load=() => {h.get.mockResolvedValue({thread:{id:'a',title:'Panel thread',status:'idle',createdAt:1}});h.timeline.mockResolvedValue({rows:[],maxSeq:0,status:'idle',activeThinking:null});};
  it('hides the panel and its toggle by default (plugin-hosted chats)',async () => {
    load();h.panelOpen=true;
    render(<MemoryRouter><ThreadDetail threadId="a" embedded/></MemoryRouter>);
    await act(async () => {});
    expect(screen.queryByTestId('secondary-panel')).toBeNull();
    expect(screen.getByTestId('thread-detail').className).not.toContain('is-secondary-open');
    h.panelOpen=false;cleanup();
    render(<MemoryRouter><ThreadDetail threadId="a" embedded/></MemoryRouter>);
    await act(async () => {});
    expect(screen.queryByTestId('thread-secondary-show')).toBeNull();
  });
  it('renders the panel when an embedded host opts in (Agents List view)',async () => {
    load();h.panelOpen=true;
    render(<MemoryRouter><ThreadDetail threadId="a" embedded showSecondaryPanel/></MemoryRouter>);
    await act(async () => {});
    expect(screen.getByTestId('secondary-panel')).toBeTruthy();
    expect(screen.getByTestId('thread-detail').className).toContain('is-secondary-open');
  });
  it('offers the show toggle when an embedded host opts in and the panel is closed',async () => {
    load();
    render(<MemoryRouter><ThreadDetail threadId="a" embedded showSecondaryPanel/></MemoryRouter>);
    await act(async () => {});
    expect(screen.getByTestId('thread-secondary-show')).toBeTruthy();
    expect(screen.queryByTestId('secondary-panel')).toBeNull();
  });
});

it('carries visibility into the roster upsert so a hidden panel chat stays off the Agents list', async () => {
  cleanup();h.upsert.mockReset();
  h.get.mockResolvedValue({ thread: { id: 'a', title: 'Panel chat', status: 'idle', createdAt: 1, visibility: 'hidden' } });
  h.timeline.mockResolvedValue({ rows: [], maxSeq: 0, status: 'idle', activeThinking: null });
  render(<MemoryRouter><ThreadDetail threadId="a" embedded/></MemoryRouter>);
  await waitFor(() => expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', visibility: 'hidden' })));
});
