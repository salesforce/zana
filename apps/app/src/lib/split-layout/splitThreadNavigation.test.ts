import { describe, expect, it } from 'vitest';
import {
  createSinglePaneLayout,
  isSplitWorkspacePath,
  paneContentForPathname,
  paneContentRoute,
  reconcileLayoutForContent,
  threadPaneContent
} from './splitThreadNavigation.js';
import { splitPane } from './ops.js';

describe('splitThreadNavigation', () => {
  it('maps splittable pathnames to pane content and back', () => {
    expect(paneContentForPathname('/')).toEqual({ kind: 'home' });
    expect(paneContentRoute({ kind: 'home' })).toBe('/');
    expect(paneContentForPathname('/agents')).toEqual({ kind: 'agents' });
    expect(paneContentRoute({ kind: 'agents' })).toBe('/agents');
    expect(paneContentForPathname('/threads/new')).toEqual({ kind: 'new-thread' });
    expect(paneContentForPathname('/threads/abc')).toEqual({
      kind: 'thread',
      projectId: null,
      threadId: 'abc'
    });
    expect(paneContentForPathname('/projects/p1/threads/abc')).toEqual({
      kind: 'thread',
      projectId: 'p1',
      threadId: 'abc'
    });
    expect(paneContentForPathname('/projects/p1/threads/new')).toEqual({
      kind: 'new-thread',
      projectId: 'p1'
    });
    expect(paneContentForPathname('/plugins/docs/panel/nested/path')).toEqual({
      kind: 'plugin-panel',
      pluginId: 'docs',
      panelPath: 'panel',
      subPath: 'nested/path'
    });
    expect(paneContentForPathname('/inbox')).toBeNull();
    expect(paneContentForPathname('/extensions/plugins/docs')).toBeNull();
    expect(isSplitWorkspacePath('/threads/abc')).toBe(true);
    expect(isSplitWorkspacePath('/plugins/docs/panel')).toBe(true);
    expect(isSplitWorkspacePath('/agents')).toBe(true);
  });

  it('seeds a single pane and focuses an existing pane on reconcile', () => {
    const seeded = reconcileLayoutForContent(null, threadPaneContent('t1', 'p1'));
    expect(seeded).toEqual(createSinglePaneLayout(threadPaneContent('t1', 'p1')));
    const two = splitPane(seeded, 'pane-1', 'right', threadPaneContent('t2', 'p1'));
    const focused = reconcileLayoutForContent(two, threadPaneContent('t1', 'p1'));
    expect(focused.focusedPaneId).toBe('pane-1');
    const replaced = reconcileLayoutForContent(two, { kind: 'home' });
    expect(replaced.focusedPaneId).toBe(two.focusedPaneId);
  });
});
