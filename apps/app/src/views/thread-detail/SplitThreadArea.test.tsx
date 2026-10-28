/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { startTransition, Suspense, useLayoutEffect } from 'react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const viewport = vi.hoisted(() => ({ compact: false }));
const archived = vi.hoisted(() => new Set<(threadId: string) => void>());
vi.mock('../../thread-store.js', () => ({
  onThreadArchived: (listener: (threadId: string) => void) => {
    archived.add(listener);
    return () => archived.delete(listener);
  }
}));
vi.mock('../../hooks/useIsCompactViewport.js', () => ({ useIsCompactViewport: () => viewport.compact }));

vi.mock('../home/HomeView.js', () => ({ HomeView: () => <div data-testid="home-view"><input aria-label="Draft" defaultValue="" /></div> }));
vi.mock('../inbox/InboxView.js', () => ({ InboxView: () => <div data-testid="inbox-view" /> }));
vi.mock('../agents/AgentsView.js', () => ({ AgentsView: () => <div data-testid="agents-view" /> }));
vi.mock('../agents/AgentSessionPage.js', () => ({
  AgentSessionPage: ({ sessionId, projectId }: { sessionId: string; projectId: string | null }) => (
    <div data-testid="agent-session-page" data-session={sessionId} data-project={projectId ?? ''}>
      session
    </div>
  )
}));
vi.mock('../threads/NewThreadView.js', () => ({ NewThreadView: () => <div data-testid="new-thread" /> }));
vi.mock('../threads/ThreadDetailView.js', () => ({ ThreadDetail: ({threadId,timelineEnabled}: {threadId: string; timelineEnabled?: boolean}) => <div data-testid="thread-detail" data-thread={threadId} data-timeline-enabled={String(timelineEnabled)} /> }));
vi.mock('./PluginPanelPaneView.js', () => ({ PluginPanelPaneView: () => <div data-testid="plugin-panel" /> }));
vi.mock('../../plugins/plugin-slots.js', () => {
  const panels: unknown[] = [];
  return {
    listNavPanels: () => panels,
    subscribePluginSlots: () => () => undefined
  };
});
vi.mock('../scheduler/SchedulerView.js', () => ({
  SchedulerView: () => <div data-testid="scheduler-view" />
}));
vi.mock('../scheduler/ScheduleDetailPage.js', () => ({
  ScheduleDetailPage: ({
    scheduleId,
    projectId
  }: {
    scheduleId: string | null;
    projectId: string | null;
  }) => (
    <div
      data-testid="schedule-detail-page"
      data-schedule={scheduleId ?? 'new'}
      data-project={projectId ?? ''}
    />
  )
}));
vi.mock('../project/ProjectModePane.js', () => ({
  ProjectModePane: ({
    projectId,
    mode,
    paneId
  }: {
    projectId: string;
    mode: string;
    paneId: string;
  }) => (
    <div
      data-testid="project-mode-pane"
      data-project={projectId}
      data-mode={mode}
      data-pane={paneId}
    />
  )
}));

import { getProjectModeRoutePath } from '../../lib/route-paths.js';
import { splitPane, movePane, swapPanes, removePane } from '../../lib/split-layout/ops.js';
import { GLOBAL_SPLIT_SCOPE_KEY, projectSplitScopeKey } from '../../lib/split-layout/scope.js';
import { createSinglePaneLayout, paneContentForPathname } from '../../lib/split-layout/splitThreadNavigation.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';
import { paneCommandsAvailable, runPaneCommand } from '../../lib/split-layout/paneCommands.js';
import { SplitThreadArea } from './SplitThreadArea.js';

function resetSplitWorkspace(): void {
  viewport.compact = false;
  useSplitWorkspace.setState({
    layout: null,
    maximizedPaneId: null,
    dimInactiveSplits: true,
    scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
    scopes: {}
  });
}

describe('SplitThreadArea agent-session', () => {
  afterEach(() => {
    cleanup();
    resetSplitWorkspace();
  });

  it('renders a global session page without an update-depth loop', () => {
    expect(() => {
      render(
        <MemoryRouter>
          <SplitThreadArea
            routeContent={{ kind: 'agent-session', projectId: null, sessionId: 's1' }}
          />
        </MemoryRouter>
      );
    }).not.toThrow();
    expect(screen.getByTestId('agent-session-page').getAttribute('data-session')).toBe('s1');
  });

  it('replaces a stored Agents board with the session page on first paint', () => {
    useSplitWorkspace.setState({
      layout: createSinglePaneLayout({ kind: 'agents' }),
      maximizedPaneId: null
    });
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'agent-session', projectId: null, sessionId: 's1' }}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('agent-session-page').getAttribute('data-session')).toBe('s1');
    expect(screen.queryByTestId('agents-view')).toBeNull();
  });

  it('reuses a project-scoped session pane for the global session URL', () => {
    useSplitWorkspace.setState({
      layout: createSinglePaneLayout({ kind: 'agent-session', projectId: 'p1', sessionId: 's1' }),
      maximizedPaneId: null
    });
    expect(() => {
      render(
        <MemoryRouter>
          <SplitThreadArea
            routeContent={{ kind: 'agent-session', projectId: null, sessionId: 's1' }}
          />
        </MemoryRouter>
      );
    }).not.toThrow();
    expect(screen.getByTestId('agent-session-page').getAttribute('data-session')).toBe('s1');
  });
});

describe('SplitThreadArea scheduler panes', () => {
  afterEach(() => {
    cleanup();
    resetSplitWorkspace();
  });

  it('renders the catalogue for kind scheduler', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'scheduler' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('scheduler-view')).toBeTruthy();
  });

  it('renders the inbox view for kind inbox', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'inbox' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('inbox-view')).toBeTruthy();
  });

  it('renders the schedule page for kind schedule', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'schedule', projectId: null, scheduleId: 'sched-1' }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('scheduler-view')).toBeNull();
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-schedule')).toBe('sched-1');
  });

  it('renders the create page for kind new-schedule', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'new-schedule', projectId: 'p1' }} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('scheduler-view')).toBeNull();
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-schedule')).toBe('new');
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-project')).toBe('p1');
  });
});

describe('SplitThreadArea project-view panes', () => {
  afterEach(() => {
    cleanup();
    resetSplitWorkspace();
  });

  it('renders explorer and terminals project modes', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'project-view', projectId: 'p1', mode: 'explorer' }}
        />
      </MemoryRouter>
    );
    const pane = screen.getByTestId('project-mode-pane');
    expect(pane.getAttribute('data-mode')).toBe('explorer');
    expect(pane.getAttribute('data-project')).toBe('p1');
  });

  it('renders a terminals project-view pane with the layout pane id', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'project-view', projectId: 'p1', mode: 'terminals' }}
        />
      </MemoryRouter>
    );
    const pane = screen.getByTestId('project-mode-pane');
    expect(pane.getAttribute('data-mode')).toBe('terminals');
    expect(pane.getAttribute('data-pane')).toBe('pane-1');
  });

  it('renders a plugin project tab as a project-view pane', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'project-view', projectId: 'p1', mode: 'consensus' }}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('project-mode-pane').getAttribute('data-mode')).toBe('consensus');
  });

  it('marks the unsplit workspace as a drop target', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'agents' }} />
      </MemoryRouter>
    );
    const workspace = screen.getByTestId('split-workspace');
    expect(workspace.getAttribute('data-split')).toBe('false');
    expect(workspace.querySelector('[data-split-pane-id="pane-1"]')).not.toBeNull();
  });

  it('activates the project scope without carrying global splits into the workspace', () => {
    const globalLayout = splitPane(
      createSinglePaneLayout({ kind: 'home' }),
      'pane-1',
      'right',
      { kind: 'agents' }
    );
    useSplitWorkspace.setState({
      scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
      layout: globalLayout,
      maximizedPaneId: null,
      scopes: {
        [GLOBAL_SPLIT_SCOPE_KEY]: { layout: globalLayout, maximizedPaneId: null }
      }
    });
    render(
      <MemoryRouter initialEntries={[getProjectModeRoutePath('p1', 'explorer')]}>
        <SplitThreadArea
          routeContent={{ kind: 'project-view', projectId: 'p1', mode: 'explorer' }}
        />
      </MemoryRouter>
    );
    expect(useSplitWorkspace.getState().scopeKey).toBe(projectSplitScopeKey('p1'));
    expect(useSplitWorkspace.getState().scopes[GLOBAL_SPLIT_SCOPE_KEY]?.layout).toEqual(globalLayout);
    expect(screen.getByTestId('project-mode-pane').getAttribute('data-mode')).toBe('explorer');
    expect(screen.queryByTestId('home-view')).toBeNull();
    expect(screen.queryByTestId('agents-view')).toBeNull();
  });
});

describe('SplitThreadArea host bar', () => {
  afterEach(() => {
    cleanup();
    resetSplitWorkspace();
  });

  it('shows an always-visible bar on host-header panes when split', () => {
    const seeded = createSinglePaneLayout({ kind: 'agents' });
    useSplitWorkspace.setState({
      layout: splitPane(seeded, seeded.focusedPaneId, 'right', { kind: 'home' }),
      maximizedPaneId: null
    });
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'home' }} />
      </MemoryRouter>
    );
    const bars = screen.getAllByTestId('split-pane-bar');
    expect(bars).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Close pane' })).toHaveLength(2);
    expect(screen.getByTestId('agents-view')).toBeTruthy();
    expect(screen.getByTestId('home-view')).toBeTruthy();
  });

  it('does not add a second bar on thread panes', () => {
    const seeded = createSinglePaneLayout({
      kind: 'thread',
      projectId: 'p1',
      threadId: 't1'
    });
    useSplitWorkspace.setState({
      layout: splitPane(seeded, seeded.focusedPaneId, 'right', { kind: 'agents' }),
      maximizedPaneId: null
    });
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'agents' }} />
      </MemoryRouter>
    );
    expect(screen.getAllByTestId('split-pane-bar')).toHaveLength(1);
    expect(screen.getByTestId('thread-detail')).toBeTruthy();
  });

  it('closes an empty pane from the bar, not an in-well button', () => {
    const seeded = createSinglePaneLayout({ kind: 'agents' });
    useSplitWorkspace.setState({
      layout: splitPane(seeded, seeded.focusedPaneId, 'right', { kind: 'empty' }),
      maximizedPaneId: null
    });
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'agents' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('split-pane-empty')).toBeTruthy();
    expect(screen.queryByTestId('split-pane-empty-close')).toBeNull();
    const closeButtons = screen.getAllByRole('button', { name: 'Close pane' });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    expect(useSplitWorkspace.getState().layout).not.toBeNull();
    expect(screen.queryByTestId('split-pane-empty')).toBeNull();
  });
});


function RoutedArea() {
  const { pathname } = useLocation();
  return <SplitThreadArea routeContent={paneContentForPathname(pathname) ?? { kind: 'home' }} />;
}
function renderPair(side: 'right' | 'bottom' = 'right') {
  const layout = splitPane(createSinglePaneLayout({ kind: 'agents' }), 'pane-1', side, { kind: 'home' });
  useSplitWorkspace.setState({ layout, maximizedPaneId: null });
  return render(<MemoryRouter><RoutedArea /></MemoryRouter>);
}

describe('split shell interaction', () => {
  afterEach(() => { cleanup(); resetSplitWorkspace(); vi.restoreAllMocks(); localStorage.removeItem('zcc.keyboard-overrides'); });

  it('focuses panes by direction, yields arrow chords to code editors, and follows remapped shortcuts', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    renderPair('bottom');
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
    fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true, altKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true, altKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    const editor = document.createElement('div');
    editor.className = 'monaco-editor';
    const editorInput = document.createElement('textarea');
    editor.appendChild(editorInput);
    document.body.appendChild(editor);
    fireEvent.keyDown(editorInput, { key: 'ArrowDown', metaKey: true, altKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    editor.remove();
    fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true, altKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
    localStorage.setItem('zcc.keyboard-overrides', JSON.stringify([
      { command: 'pane.focus.up', shortcut: { key: 'k', mod: true, meta: false, control: false, alt: true, shift: false } }
    ]));
    fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true, altKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
    fireEvent.keyDown(window, { key: '˚', code: 'KeyK', metaKey: true, altKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
  });

  it('closes panes whose thread is archived elsewhere, keeping focus and route in step', () => {
    const three = splitPane(
      splitPane(createSinglePaneLayout({ kind: 'thread', projectId: null, threadId: 'a' }), 'pane-1', 'right', { kind: 'thread', projectId: null, threadId: 'b' }),
      'pane-2',
      'bottom',
      { kind: 'thread', projectId: null, threadId: 'a' }
    );
    useSplitWorkspace.setState({
      layout: three,
      maximizedPaneId: null,
      scopes: { [projectSplitScopeKey('p9')]: { layout: createSinglePaneLayout({ kind: 'thread', projectId: 'p9', threadId: 'a' }), maximizedPaneId: null } }
    });
    let pathname = '';
    function Probe() { pathname = useLocation().pathname; return null; }
    const view = render(<MemoryRouter initialEntries={['/threads/a']}><RoutedArea /><Probe /></MemoryRouter>);
    expect(archived.size).toBe(1);
    const fire = (threadId: string) => act(() => { for (const listener of [...archived]) listener(threadId); });
    fire('unrelated');
    expect(screen.getAllByTestId('thread-detail')).toHaveLength(3);
    fire('a');
    expect(screen.getAllByTestId('thread-detail').map((el) => el.getAttribute('data-thread'))).toEqual(['b']);
    expect(pathname).toBe('/threads/b');
    expect(useSplitWorkspace.getState().scopes[projectSplitScopeKey('p9')]?.layout).toBeNull();
    // A lone pane is the normal single-thread view; it stays.
    fire('b');
    expect(screen.getAllByTestId('thread-detail')).toHaveLength(1);
    view.unmount();
    expect(archived.size).toBe(0);
  });

  it('exposes pane commands to the palette only while a split is visible', () => {
    expect(paneCommandsAvailable()).toBe(false);
    const view = renderPair();
    const run = (command: Parameters<typeof runPaneCommand>[0]) => {
      let handled = false;
      act(() => { handled = runPaneCommand(command); });
      return handled;
    };
    expect(paneCommandsAvailable()).toBe(true);
    expect(run('pane.focus.previous')).toBe(true);
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    expect(run('pane.focus.right')).toBe(true);
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
    expect(run('pane.focus.down')).toBe(false);
    expect(run('pane.focus.8')).toBe(false);
    expect(run('pane.focus.1')).toBe(true);
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    expect(run('pane.maximize.toggle')).toBe(true);
    expect(useSplitWorkspace.getState().maximizedPaneId).toBe('pane-1');
    expect(run('pane.close')).toBe(true);
    expect(screen.getByTestId('split-workspace').getAttribute('data-split')).toBe('false');
    expect(paneCommandsAvailable()).toBe(false);
    view.unmount();
    expect(runPaneCommand('pane.close')).toBe(false);
  });

  it('pauses hidden thread timelines on maximize and compact layouts, retaining visible siblings', () => {
    const layout = splitPane(createSinglePaneLayout({ kind: 'thread', projectId: null, threadId: 'a' }), 'pane-1', 'right', { kind: 'thread', projectId: null, threadId: 'b' });
    useSplitWorkspace.setState({ layout, maximizedPaneId: null });
    const ui = <MemoryRouter initialEntries={['/threads/b']}><SplitThreadArea routeContent={{kind:'thread',projectId:null,threadId:'b'}} /></MemoryRouter>;
    const view = render(ui);
    const first = screen.getAllByTestId('thread-detail').find(element => element.dataset.thread === 'a')!;
    const second = screen.getAllByTestId('thread-detail').find(element => element.dataset.thread === 'b')!;
    expect(first.dataset.timelineEnabled).toBe('true');
    expect(second.dataset.timelineEnabled).toBe('true');
    act(() => useSplitWorkspace.getState().setMaximizedPaneId('pane-2'));
    expect(first.dataset.timelineEnabled).toBe('false');
    expect(second.dataset.timelineEnabled).toBe('true');
    act(() => useSplitWorkspace.getState().setMaximizedPaneId(null));
    expect(first.dataset.timelineEnabled).toBe('true');
    viewport.compact = true;
    view.rerender(<MemoryRouter initialEntries={['/threads/b']}><SplitThreadArea routeContent={{kind:'thread',projectId:null,threadId:'b'}} /></MemoryRouter>);
    expect(first.dataset.timelineEnabled).toBe('false');
    expect(second.dataset.timelineEnabled).toBe('true');
  });

  it('renders the focused pane on compact screens and preserves the desktop tree', () => {
    viewport.compact = true;
    renderPair();
    expect(screen.getByTestId('home-view')).toBeTruthy();
    expect(screen.getByTestId('agents-view').closest('[hidden]')).not.toBeNull();
    expect(useSplitWorkspace.getState().layout?.root.type).toBe('split');
    expect(screen.getByTestId('split-workspace').querySelector('.split-pane-slot:not([hidden]) [data-split-pane-id]')?.getAttribute('data-split-pane-id')).toBe('pane-2');
  });

  it('tracks keyboard focus and supports focus, cycle, maximize and close shortcuts', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    renderPair();
    const agentPane = screen.getByTestId('agents-view').closest('[data-split-pane-id]')!;
    fireEvent.focus(agentPane.querySelector('button')!);
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
    fireEvent.keyDown(window, { key: '[', metaKey: true, altKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    fireEvent.keyDown(window, { key: ']', metaKey: true, altKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
    fireEvent.keyDown(window, { key: 'M', metaKey: true, shiftKey: true });
    expect(useSplitWorkspace.getState().maximizedPaneId).toBe('pane-2');
    expect(screen.getByTestId('agents-view').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true });
    expect(useSplitWorkspace.getState().maximizedPaneId).toBe('pane-1');
    fireEvent.keyDown(window, { key: 'M', metaKey: true, shiftKey: true });
    expect(useSplitWorkspace.getState().maximizedPaneId).toBeNull();
    fireEvent.keyDown(window, { key: '8', code: 'Digit8', metaKey: true });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    fireEvent.keyDown(window, { key: 'w', metaKey: true, altKey: true });
    expect(screen.queryByTestId('agents-view')).toBeNull();
    expect(screen.getByTestId('split-workspace').getAttribute('data-split')).toBe('false');
  });

  it('keeps its shortcut listener ahead of later global handlers across focus changes', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    renderPair();
    // App installs the global ⌘N tab shortcuts after child effects have run.
    const globalShortcuts = vi.fn();
    window.addEventListener('keydown', globalShortcuts, true);
    try {
      fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true });
      expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
      fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true });
      expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
      expect(globalShortcuts).not.toHaveBeenCalled();
      // AZERTY: ⌘ plus the 1 key reports "&".
      fireEvent.keyDown(window, { key: '&', code: 'Digit1', metaKey: true });
      expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
      // A remap without ⌘/Ctrl still fires; plain typing passes through.
      localStorage.setItem('zcc.keyboard-overrides', JSON.stringify([
        { command: 'pane.focus.next', shortcut: { key: 'F6', mod: false, meta: false, control: false, alt: false, shift: false } }
      ]));
      fireEvent.keyDown(window, { key: 'F6', code: 'F6' });
      expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
      fireEvent.keyDown(window, { key: 'a', code: 'KeyA' });
      expect(globalShortcuts).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', globalShortcuts, true);
      localStorage.removeItem('zcc.keyboard-overrides');
    }
  });

  it.each(['left', 'right', 'above', 'below'])('moves a pane %s without dragging', (side) => {
    renderPair();
    fireEvent.click(screen.getAllByRole('button', { name: 'Move pane', exact: true })[1]!);
    fireEvent.click(screen.getByRole('option', { name: `Move pane ${side}` }));
    const root = useSplitWorkspace.getState().layout?.root;
    expect(root?.type === 'split' && root.dir).toBe(side === 'left' || side === 'right' ? 'row' : 'col');
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
  });

  it('resizes, maximizes and restores through the visible controls', () => {
    renderPair();
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(useSplitWorkspace.getState().layout?.root).toMatchObject({ sizes: [0.52, 0.48] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Maximize pane' })[0]!);
    expect(useSplitWorkspace.getState().maximizedPaneId).toBe('pane-1');
    fireEvent.click(screen.getByRole('button', { name: 'Restore pane' }));
    expect(useSplitWorkspace.getState().maximizedPaneId).toBeNull();
  });

  it('clears a missing maximized pane and closes an unfocused pane', () => {
    renderPair();
    act(() => useSplitWorkspace.setState({ maximizedPaneId: 'missing' }));
    expect(useSplitWorkspace.getState().maximizedPaneId).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close pane' })[0]!);
    expect(screen.queryByTestId('agents-view')).toBeNull();
    expect(screen.getByTestId('home-view')).toBeTruthy();
  });
});

describe('pane dragging', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); resetSplitWorkspace(); vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  function dragPair(zone: 'center' | 'right', maximize = false) {
    renderPair();
    if (maximize) fireEvent.click(screen.getAllByRole('button', { name: 'Maximize pane' })[1]!);
    const source = screen.getByTestId('home-view').closest<HTMLElement>('[data-split-pane-id]')!;
    const target = screen.getByTestId('agents-view').closest<HTMLElement>('[data-split-pane-id]')!;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 100, 500, 400));
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] });
    fireEvent.pointerDown(source.querySelector('.split-pane-bar-title')!, { button: 0, pointerId: 1, clientX: 50, clientY: 200 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 54, clientY: 200 });
    expect(document.querySelector('.split-drag-overlay')).toBeNull();
    const x = zone === 'right' ? 675 : 450;
    fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: 300 });
    return { x, source, target };
  }

  it.each(['center', 'right'] as const)('commits a pane drop at %s', (zone) => {
    const { x } = dragPair(zone);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: 300 });
    const layout = useSplitWorkspace.getState().layout!;
    expect(layout.focusedPaneId).toBe(zone === 'center' ? 'pane-1' : 'pane-2');
    expect(document.querySelector('.split-drag-overlay')).toBeNull();
  });

  it('temporarily reveals siblings of a maximized pane and restores on cancellation', () => {
    dragPair('center', true);
    expect(useSplitWorkspace.getState().maximizedPaneId).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSplitWorkspace.getState().maximizedPaneId).toBe('pane-2');
  });
});


describe('pane editing state', () => {
  afterEach(() => { cleanup(); resetSplitWorkspace(); });
  it('keeps the same editor through split, nesting, swap, compact mode and sibling close', () => {
    const ui = <MemoryRouter><RoutedArea /></MemoryRouter>;
    const view = render(ui);
    const input = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.change(input, { target: { value: 'Unsaved work' } });
    const expectDraft = () => {
      expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
      expect((input as HTMLInputElement).value).toBe('Unsaved work');
    };
    act(() => useSplitWorkspace.getState().updateLayout((layout) => splitPane(layout!, 'pane-1', 'right', { kind: 'agents' })));
    expectDraft();
    act(() => useSplitWorkspace.getState().updateLayout((layout) => movePane(layout!, 'pane-1', 'pane-2', 'bottom')));
    expectDraft();
    act(() => useSplitWorkspace.getState().updateLayout((layout) => swapPanes(layout!, 'pane-1', 'pane-2')));
    expectDraft();
    viewport.compact = true;
    view.rerender(<MemoryRouter><RoutedArea /></MemoryRouter>);
    expectDraft();
    viewport.compact = false;
    view.rerender(<MemoryRouter><RoutedArea /></MemoryRouter>);
    expectDraft();
    const layout = useSplitWorkspace.getState().layout!;
    const other = layout.focusedPaneId === 'pane-1' ? 'pane-2' : 'pane-1';
    act(() => useSplitWorkspace.getState().updateLayout((layout) => removePane(layout!, other)));
    expectDraft();
  });
});


describe('pane slot ownership', () => {
  afterEach(() => { cleanup(); resetSplitWorkspace(); });
  it('replaces the old host when navigation reuses a slot', () => {
    const { rerender, container } = render(<MemoryRouter><SplitThreadArea routeContent={{ kind: 'home' }} /></MemoryRouter>);
    rerender(<MemoryRouter><SplitThreadArea routeContent={{ kind: 'inbox' }} /></MemoryRouter>);
    rerender(<MemoryRouter><SplitThreadArea routeContent={{ kind: 'home' }} /></MemoryRouter>);
    expect(container.querySelectorAll('.split-pane-slot > .split-pane-host')).toHaveLength(1);
    expect(container.querySelectorAll('.split-pane')).toHaveLength(1);
  });
});

describe('route renders that never commit', () => {
  const activateScope = useSplitWorkspace.getState().activateScope;
  afterEach(() => {
    cleanup();
    useSplitWorkspace.setState({ activateScope });
    resetSplitWorkspace();
  });

  // #532: Back from a project renders the global route as a transition. A scope
  // switch during that render flipped the scope under the project tree on
  // screen, which flipped it back, so the route render restarted until React
  // forced it (about 5 s) and the visible pane remounted on every flip.
  it('keeps the active scope and the mounted pane while the global route has not committed', () => {
    const switches: string[] = [];
    useSplitWorkspace.setState({
      activateScope: (key) => {
        switches.push(key);
        // Stop a scope ping-pong from spinning forever inside act().
        if (switches.length > 20) throw new Error(`split scope ping-pong: ${switches.slice(-4).join(' > ')}`);
        activateScope(key);
      }
    });
    let navigate: NavigateFunction = () => undefined;
    const neverLoads = new Promise<never>(() => undefined);
    function Loading(): never {
      throw neverLoads;
    }
    function Shell() {
      const { pathname } = useLocation();
      navigate = useNavigate();
      return (
        <>
          <SplitThreadArea routeContent={paneContentForPathname(pathname) ?? { kind: 'home' }} />
          {pathname.startsWith('/sessions/') ? <Loading /> : null}
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={[getProjectModeRoutePath('p1', 'explorer')]}>
        <Suspense fallback={<p>loading</p>}>
          <Shell />
        </Suspense>
      </MemoryRouter>
    );
    const projectPane = screen.getByTestId('project-mode-pane');
    const projectHost = projectPane.closest('.split-pane-host');
    expect(useSplitWorkspace.getState().scopeKey).toBe(projectSplitScopeKey('p1'));
    switches.length = 0;

    act(() => startTransition(() => void navigate('/sessions/s1')));
    expect(switches).toEqual([]);
    expect(useSplitWorkspace.getState().scopeKey).toBe(projectSplitScopeKey('p1'));

    // An urgent update re-renders the tree on screen while the route waits.
    act(() => useSplitWorkspace.getState().setDimInactiveSplits(false));
    expect(switches).toEqual([]);
    expect(screen.getByTestId('project-mode-pane')).toBe(projectPane);
    expect(projectPane.closest('.split-pane-host')).toBe(projectHost);
    expect(screen.queryByText('loading')).toBeNull();
  });

  it('opens a project with no saved split as that project alone, not the global split', () => {
    const globalLayout = splitPane(createSinglePaneLayout({ kind: 'home' }), 'pane-1', 'right', { kind: 'agents' });
    useSplitWorkspace.setState({
      scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
      layout: globalLayout,
      maximizedPaneId: 'pane-2',
      scopes: {}
    });
    let firstCommit: { panes: number; modes: string[]; maximized: boolean } | null = null;
    function FirstCommit() {
      useLayoutEffect(() => {
        firstCommit = {
          panes: document.querySelectorAll('.split-pane').length,
          modes: [...document.querySelectorAll('[data-testid="project-mode-pane"]')].map((pane) => pane.getAttribute('data-mode') ?? ''),
          maximized: document.querySelector('.split-pane.is-maximized') !== null
        };
      }, []);
      return null;
    }
    render(
      <MemoryRouter initialEntries={[getProjectModeRoutePath('p1', 'explorer')]}>
        <RoutedArea />
        <FirstCommit />
      </MemoryRouter>
    );
    expect(firstCommit).toEqual({ panes: 1, modes: ['explorer'], maximized: false });
    expect(useSplitWorkspace.getState().scopeKey).toBe(projectSplitScopeKey('p1'));
    expect(useSplitWorkspace.getState().scopes[GLOBAL_SPLIT_SCOPE_KEY]).toEqual({ layout: globalLayout, maximizedPaneId: 'pane-2' });
  });

  it('shows a saved project split, maximized pane included, when the project opens', () => {
    const projectLayout = splitPane(
      createSinglePaneLayout({ kind: 'project-view', projectId: 'p1', mode: 'explorer' }),
      'pane-1',
      'right',
      { kind: 'project-view', projectId: 'p1', mode: 'terminals' }
    );
    useSplitWorkspace.setState({
      scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
      layout: createSinglePaneLayout({ kind: 'home' }),
      maximizedPaneId: null,
      scopes: { [projectSplitScopeKey('p1')]: { layout: projectLayout, maximizedPaneId: 'pane-1' } }
    });
    // The scope activates in a layout effect; the first commit must already
    // show the saved split rather than a one-pane placeholder.
    let firstCommit: { panes: number; maximized: string | null } | null = null;
    function FirstCommit() {
      useLayoutEffect(() => {
        firstCommit = {
          panes: document.querySelectorAll('.split-pane').length,
          maximized: document.querySelector('.split-pane.is-maximized')?.getAttribute('data-split-pane-id') ?? null
        };
      }, []);
      return null;
    }
    render(
      <MemoryRouter initialEntries={[getProjectModeRoutePath('p1', 'explorer')]}>
        <RoutedArea />
        <FirstCommit />
      </MemoryRouter>
    );
    expect(firstCommit).toEqual({ panes: 2, maximized: 'pane-1' });
    expect(useSplitWorkspace.getState().scopeKey).toBe(projectSplitScopeKey('p1'));
    expect(useSplitWorkspace.getState().maximizedPaneId).toBe('pane-1');
    expect(screen.getAllByTestId('project-mode-pane').map((pane) => pane.getAttribute('data-mode')).sort())
      .toEqual(['explorer', 'terminals']);
    expect(screen.queryByTestId('home-view')).toBeNull();
  });
});
