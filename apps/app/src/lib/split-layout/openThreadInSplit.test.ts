import { afterEach, describe, expect, it } from 'vitest';
import { openThreadInSplit } from './openThreadInSplit.js';
import { useSplitWorkspace } from './store.js';
import { createSinglePaneLayout, threadPaneContent } from './splitThreadNavigation.js';
import { countPanes, findPaneByContent, findPaneByThread, listPanes, splitPane } from './ops.js';

describe('openThreadInSplit', () => {
  afterEach(() => {
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null });
  });
  it('navigates without mutating layout when compact', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openThreadInSplit({
      navigate: (route) => routes.push(route),
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
      navigate: (route) => routes.push(route),
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
      navigate: (route) => routes.push(route),
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
      navigate: (route, options) => routes.push({ route, replace: options?.replace }),
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
