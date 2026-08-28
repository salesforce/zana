import { afterEach, describe, expect, it } from 'vitest';
import { openThreadInSplit } from './openThreadInSplit.js';
import { useSplitWorkspace } from './store.js';
import { createSinglePaneLayout, threadPaneContent } from './splitThreadNavigation.js';
import { countPanes, findPaneByThread, splitPane } from './ops.js';

describe('openThreadInSplit', () => {
  afterEach(() => {
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null });
  });
  it('navigates without mutating layout when compact or empty', () => {
    const routes: string[] = [];
    useSplitWorkspace.setState({ layout: null });
    openThreadInSplit({
      navigate: (route) => routes.push(route),
      projectId: 'p1',
      threadId: 't1',
      isCompact: true
    });
    expect(routes).toEqual(['/projects/p1/threads/t1']);
    expect(useSplitWorkspace.getState().layout).toBeNull();
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
