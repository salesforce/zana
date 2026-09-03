import { afterEach, describe, expect, it } from 'vitest';
import { countPanes, splitPane } from './ops.js';
import { createSinglePaneLayout, threadPaneContent } from './splitThreadNavigation.js';
import { useSplitWorkspace } from './store.js';

describe('split workspace store', () => {
  afterEach(() => {
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null, dimInactiveSplits: true });
  });

  it('closes every pane showing the archived threads and keeps a surviving focus', () => {
    const two = splitPane(
      createSinglePaneLayout(threadPaneContent('t1', 'p1')),
      'pane-1',
      'right',
      threadPaneContent('t2', 'p1')
    );
    useSplitWorkspace.setState({ layout: two, maximizedPaneId: null });
    const closed = useSplitWorkspace.getState().closePanesForThreads(['t1']);
    expect(closed.removedAny).toBe(true);
    const layout = useSplitWorkspace.getState().layout;
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(countPanes(layout.root)).toBe(1);
    expect(layout.root.type === 'pane' && layout.root.content.kind === 'thread').toBe(true);
    if (layout.root.type === 'pane' && layout.root.content.kind === 'thread') {
      expect(layout.root.content.threadId).toBe('t2');
    }
  });

  it('skips a maximized-pane write when the id is already set', () => {
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: 'pane-1' });
    const before = useSplitWorkspace.getState();
    useSplitWorkspace.getState().setMaximizedPaneId('pane-1');
    expect(useSplitWorkspace.getState()).toBe(before);
    useSplitWorkspace.getState().setMaximizedPaneId(null);
    expect(useSplitWorkspace.getState().maximizedPaneId).toBeNull();
  });

  it('clears the layout when the last thread pane is archived', () => {
    useSplitWorkspace.setState({
      layout: createSinglePaneLayout(threadPaneContent('t1', 'p1')),
      maximizedPaneId: null
    });
    const closed = useSplitWorkspace.getState().closePanesForThreads(['t1']);
    expect(closed.removedAny).toBe(true);
    expect(useSplitWorkspace.getState().layout).toBeNull();
  });
});
