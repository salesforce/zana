import { afterEach, describe, expect, it } from 'vitest';
import { countPanes, splitPane } from './ops.js';
import { GLOBAL_SPLIT_SCOPE_KEY, projectSplitScopeKey } from './scope.js';
import { createSinglePaneLayout, threadPaneContent } from './splitThreadNavigation.js';
import { useSplitWorkspace } from './store.js';

const PROJECT_SCOPE = projectSplitScopeKey('p1');

function resetStore(): void {
  useSplitWorkspace.setState({
    layout: null,
    maximizedPaneId: null,
    dimInactiveSplits: true,
    scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
    scopes: {}
  });
}

describe('split workspace store', () => {
  afterEach(resetStore);

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

  it('snapshots the active layout and restores it when returning to a scope', () => {
    const globalLayout = splitPane(
      createSinglePaneLayout({ kind: 'home' }),
      'pane-1',
      'right',
      { kind: 'agents' }
    );
    useSplitWorkspace.getState().setLayout(globalLayout);
    useSplitWorkspace.getState().activateScope(PROJECT_SCOPE);
    expect(useSplitWorkspace.getState().scopeKey).toBe(PROJECT_SCOPE);
    expect(useSplitWorkspace.getState().layout).toBeNull();

    const projectLayout = createSinglePaneLayout({
      kind: 'project-view',
      projectId: 'p1',
      mode: 'explorer'
    });
    useSplitWorkspace.getState().setLayout(projectLayout);
    useSplitWorkspace.getState().activateScope(GLOBAL_SPLIT_SCOPE_KEY);
    expect(useSplitWorkspace.getState().layout).toEqual(globalLayout);

    useSplitWorkspace.getState().activateScope(PROJECT_SCOPE);
    expect(useSplitWorkspace.getState().layout).toEqual(projectLayout);
  });

  it('is a no-op when activateScope targets the already-active key', () => {
    const layout = createSinglePaneLayout({ kind: 'home' });
    useSplitWorkspace.setState({ layout, scopeKey: GLOBAL_SPLIT_SCOPE_KEY });
    const before = useSplitWorkspace.getState();
    useSplitWorkspace.getState().activateScope(GLOBAL_SPLIT_SCOPE_KEY);
    expect(useSplitWorkspace.getState()).toBe(before);
  });

  it('strips archived threads from inactive scopes without reviving them', () => {
    const globalLayout = splitPane(
      createSinglePaneLayout({ kind: 'home' }),
      'pane-1',
      'right',
      { kind: 'agents' }
    );
    const projectLayout = splitPane(
      createSinglePaneLayout(threadPaneContent('t-gone', 'p1')),
      'pane-1',
      'right',
      { kind: 'project-view', projectId: 'p1', mode: 'explorer' }
    );
    useSplitWorkspace.setState({
      scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
      layout: globalLayout,
      maximizedPaneId: null,
      scopes: {
        [PROJECT_SCOPE]: { layout: projectLayout, maximizedPaneId: null }
      }
    });
    const closed = useSplitWorkspace.getState().closePanesForThreads(['t-gone']);
    expect(closed.removedAny).toBe(true);
    expect(useSplitWorkspace.getState().layout).toEqual(globalLayout);
    const stored = useSplitWorkspace.getState().scopes[PROJECT_SCOPE];
    expect(stored?.layout).not.toBeNull();
    const remaining = stored?.layout;
    expect(remaining?.root.type === 'pane' && remaining.root.content.kind === 'project-view').toBe(
      true
    );

    useSplitWorkspace.getState().activateScope(PROJECT_SCOPE);
    const restored = useSplitWorkspace.getState().layout;
    expect(restored?.root.type === 'pane' && restored.root.content.kind === 'project-view').toBe(
      true
    );
  });

  it('clears an inactive scope whose only pane was the archived thread', () => {
    useSplitWorkspace.setState({
      scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
      layout: createSinglePaneLayout({ kind: 'home' }),
      scopes: {
        [PROJECT_SCOPE]: {
          layout: createSinglePaneLayout(threadPaneContent('t-gone', 'p1')),
          maximizedPaneId: null
        }
      }
    });
    useSplitWorkspace.getState().closePanesForThreads(['t-gone']);
    expect(useSplitWorkspace.getState().scopes[PROJECT_SCOPE]?.layout).toBeNull();
  });
});
