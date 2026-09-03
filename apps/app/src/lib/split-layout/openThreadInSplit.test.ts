import { afterEach, describe, expect, it } from 'vitest';
import { openAgentSessionInSplit, openPaneContentInSplit, openScheduleInSplit, openThreadInSplit } from './openThreadInSplit.js';
import { useSplitWorkspace } from './store.js';
import { agentSessionPaneContent, createSinglePaneLayout, threadPaneContent } from './splitThreadNavigation.js';
import { countPanes, findPaneByContent, findPaneByThread, listPanes, MAX_PANES, splitPane } from './ops.js';

describe('openThreadInSplit', () => {
  afterEach(() => {
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null });
  });
  it('navigates without mutating layout when compact', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openThreadInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: 'p1',
      threadId: 't1',
      isCompact: true,
      currentPathname: '/agents'
    });
    expect(routes).toEqual(['/projects/p1/threads/t1']);
    expect(useSplitWorkspace.getState().layout).toBeNull();
  });

  it('navigates without mutating layout when empty and the page is not keepable', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openThreadInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: 'p1',
      threadId: 't1',
      isCompact: false,
      currentPathname: '/inbox'
    });
    expect(routes).toEqual(['/projects/p1/threads/t1']);
    expect(useSplitWorkspace.getState().layout).toBeNull();
  });

  it('keeps the agents board in a left pane when opening a thread from /agents', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openThreadInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: 'p1',
      threadId: 't1',
      isCompact: false,
      currentPathname: '/agents'
    });
    const layout = useSplitWorkspace.getState().layout;
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(countPanes(layout.root)).toBe(2);
    expect(findPaneByContent(layout.root, { kind: 'agents' })).not.toBeNull();
    expect(findPaneByThread(layout.root, 'p1', 't1')).not.toBeNull();
    expect(listPanes(layout.root)[0]?.content).toEqual({ kind: 'agents' });
    expect(routes).toEqual(['/projects/p1/threads/t1']);
  });

  it('focuses an already-open thread and splits right for a new one', () => {
    const seeded = createSinglePaneLayout(threadPaneContent('t1', 'p1'));
    useSplitWorkspace.setState({ layout: seeded, maximizedPaneId: null });
    const routes: Array<{ route: string; replace?: boolean }> = [];
    openThreadInSplit({
      navigate: (route, options) => {
        routes.push({ route, replace: options?.replace });
      },
      projectId: 'p1',
      threadId: 't1',
      isCompact: false
    });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    expect(routes.at(-1)?.replace).toBe(true);

    openThreadInSplit({
      navigate: (route) => routes.push({ route }),
      projectId: 'p1',
      threadId: 't2',
      isCompact: false
    });
    const layout = useSplitWorkspace.getState().layout;
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(countPanes(layout.root)).toBe(2);
    expect(findPaneByThread(layout.root, 'p1', 't2')).not.toBeNull();
  });

  it('grows a two-pane row from a right split', () => {
    const two = splitPane(
      createSinglePaneLayout(threadPaneContent('t1', 'p1')),
      'pane-1',
      'right',
      threadPaneContent('t2', 'p1')
    );
    useSplitWorkspace.setState({ layout: two });
    openThreadInSplit({
      navigate: () => undefined,
      projectId: 'p1',
      threadId: 't3',
      isCompact: false
    });
    const layout = useSplitWorkspace.getState().layout;
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(countPanes(layout.root)).toBe(3);
  });
});

describe('openAgentSessionInSplit', () => {
  afterEach(() => {
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null });
  });

  it('keeps the agents board in a left pane when opening a session from /agents', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openAgentSessionInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: 'p1',
      sessionId: 's1',
      isCompact: false,
      currentPathname: '/agents'
    });
    const layout = useSplitWorkspace.getState().layout;
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(countPanes(layout.root)).toBe(2);
    expect(findPaneByContent(layout.root, { kind: 'agents' })).not.toBeNull();
    expect(
      findPaneByContent(layout.root, { kind: 'agent-session', projectId: 'p1', sessionId: 's1' })
    ).not.toBeNull();
    expect(listPanes(layout.root)[0]?.content).toEqual({ kind: 'agents' });
    expect(routes).toEqual(['/projects/p1/sessions/s1']);
  });

  it('navigates without mutating layout when compact', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openAgentSessionInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: 'p1',
      sessionId: 's1',
      isCompact: true,
      currentPathname: '/agents'
    });
    expect(routes).toEqual(['/projects/p1/sessions/s1']);
    expect(useSplitWorkspace.getState().layout).toBeNull();
  });

  it('focuses an already-open session pane', () => {
    const seeded = createSinglePaneLayout(agentSessionPaneContent('s1', 'p1'));
    useSplitWorkspace.setState({ layout: seeded, maximizedPaneId: null });
    const routes: Array<{ route: string; replace?: boolean }> = [];
    openAgentSessionInSplit({
      navigate: (route, options) => {
        routes.push({ route, replace: options?.replace });
      },
      projectId: 'p1',
      sessionId: 's1',
      isCompact: false
    });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    expect(routes.at(-1)?.replace).toBe(true);
  });

  it('does not seed a keep-beside pane when already on that session', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openAgentSessionInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: 'p1',
      sessionId: 's1',
      isCompact: false,
      currentPathname: '/projects/p1/sessions/s1'
    });
    expect(routes).toEqual(['/projects/p1/sessions/s1']);
    expect(useSplitWorkspace.getState().layout).toBeNull();
  });

  it('opens a global session URL from /agents without entering a project workspace', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openAgentSessionInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: null,
      sessionId: 's1',
      isCompact: false,
      currentPathname: '/agents'
    });
    const layout = useSplitWorkspace.getState().layout;
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(findPaneByContent(layout.root, { kind: 'agents' })).not.toBeNull();
    expect(
      findPaneByContent(layout.root, { kind: 'agent-session', projectId: null, sessionId: 's1' })
    ).not.toBeNull();
    expect(routes).toEqual(['/sessions/s1']);
  });
});

describe('openScheduleInSplit', () => {
  afterEach(() => {
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null });
  });

  it('keeps the scheduler catalogue in a left pane when opening a schedule from /scheduler', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openScheduleInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: null,
      scheduleId: 'sched-1',
      isCompact: false,
      currentPathname: '/scheduler'
    });
    const layout = useSplitWorkspace.getState().layout;
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(countPanes(layout.root)).toBe(2);
    expect(findPaneByContent(layout.root, { kind: 'scheduler' })).not.toBeNull();
    expect(
      findPaneByContent(layout.root, { kind: 'schedule', projectId: null, scheduleId: 'sched-1' })
    ).not.toBeNull();
    expect(listPanes(layout.root)[0]?.content).toEqual({ kind: 'scheduler' });
    expect(routes).toEqual(['/schedules/sched-1']);
  });

  it('navigates without mutating layout when compact', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openScheduleInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      projectId: 'p1',
      scheduleId: 'sched-1',
      isCompact: true,
      currentPathname: '/scheduler'
    });
    expect(routes).toEqual(['/projects/p1/schedules/sched-1']);
    expect(useSplitWorkspace.getState().layout).toBeNull();
  });
});

describe('openPaneContentInSplit', () => {
  afterEach(() => {
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null });
  });

  it('navigates only when split is disabled or the layout is empty', () => {
    const routes: string[] = [];
    openPaneContentInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      content: { kind: 'agents' },
      route: '/agents',
      enabled: false
    });
    expect(routes).toEqual(['/agents']);

    useSplitWorkspace.setState({ layout: null });
    openPaneContentInSplit({
      navigate: (route) => {
        routes.push(route);
      },
      content: { kind: 'home' },
      route: '/',
      enabled: true
    });
    expect(routes).toEqual(['/agents', '/']);
  });

  it('focuses an existing pane and splits right for a new one', () => {
    const seeded = createSinglePaneLayout({ kind: 'agents' });
    useSplitWorkspace.setState({ layout: seeded });
    const routes: Array<{ route: string; replace?: boolean }> = [];
    openPaneContentInSplit({
      navigate: (route, options) => {
        routes.push({ route, replace: options?.replace });
      },
      content: { kind: 'agents' },
      route: '/agents',
      enabled: true
    });
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-1');
    expect(routes.at(-1)?.replace).toBe(true);

    openPaneContentInSplit({
      navigate: (route) => {
        routes.push({ route });
      },
      content: { kind: 'home' },
      route: '/',
      enabled: true
    });
    expect(countPanes(useSplitWorkspace.getState().layout!.root)).toBe(2);
  });

  it('replaces the focused pane when already at the cap', () => {
    let layout = createSinglePaneLayout(threadPaneContent('t1', 'p1'));
    for (let i = 2; i <= MAX_PANES; i++) {
      layout = splitPane(layout, layout.focusedPaneId, 'right', threadPaneContent(`t${i}`, 'p1'));
    }
    useSplitWorkspace.setState({ layout });
    openPaneContentInSplit({
      navigate: () => undefined,
      content: { kind: 'agents' },
      route: '/agents',
      enabled: true
    });
    const next = useSplitWorkspace.getState().layout;
    expect(next).not.toBeNull();
    if (!next) return;
    expect(countPanes(next.root)).toBe(MAX_PANES);
    expect(findPaneByContent(next.root, { kind: 'agents' })).not.toBeNull();
  });
});
