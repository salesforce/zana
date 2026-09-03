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
    expect(paneContentForPathname('/scheduler')).toEqual({ kind: 'scheduler' });
    expect(paneContentRoute({ kind: 'scheduler' })).toBe('/scheduler');
    expect(paneContentForPathname('/schedules/new')).toEqual({ kind: 'new-schedule' });
    expect(paneContentForPathname('/projects/p1/schedules/new')).toEqual({
      kind: 'new-schedule',
      projectId: 'p1'
    });
    expect(paneContentForPathname('/schedules/sched-1')).toEqual({
      kind: 'schedule',
      projectId: null,
      scheduleId: 'sched-1'
    });
    expect(paneContentForPathname('/projects/p1/schedules/sched-1')).toEqual({
      kind: 'schedule',
      projectId: 'p1',
      scheduleId: 'sched-1'
    });
    expect(paneContentRoute({ kind: 'schedule', projectId: null, scheduleId: 'sched-1' })).toBe(
      '/schedules/sched-1'
    );
    expect(paneContentRoute({ kind: 'new-schedule', projectId: 'p1' })).toBe(
      '/projects/p1/schedules/new'
    );
    expect(isSplitWorkspacePath('/scheduler')).toBe(true);
    expect(isSplitWorkspacePath('/schedules/sched-1')).toBe(true);
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
    expect(paneContentForPathname('/projects/p1/sessions/sess-1')).toEqual({
      kind: 'agent-session',
      projectId: 'p1',
      sessionId: 'sess-1'
    });
    expect(paneContentForPathname('/sessions/sess-1')).toEqual({
      kind: 'agent-session',
      projectId: null,
      sessionId: 'sess-1'
    });
    expect(paneContentRoute({ kind: 'agent-session', projectId: 'p1', sessionId: 'sess-1' })).toBe(
      '/projects/p1/sessions/sess-1'
    );
    expect(paneContentRoute({ kind: 'agent-session', projectId: null, sessionId: 'sess-1' })).toBe(
      '/sessions/sess-1'
    );
    expect(isSplitWorkspacePath('/projects/p1/sessions/sess-1')).toBe(true);
    expect(isSplitWorkspacePath('/sessions/sess-1')).toBe(true);
    expect(paneContentForPathname('/plugins/docs/panel/nested/path')).toEqual({
      kind: 'plugin-panel',
      pluginId: 'docs',
      panelPath: 'panel',
      subPath: 'nested/path'
    });
    expect(isSplitWorkspacePath('/inbox')).toBe(false);
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

  it('reuses a CLI-agent pane across global and project URLs without cloning', () => {
    const content = { kind: 'agent-session' as const, projectId: null, sessionId: 's1' };
    const seeded = reconcileLayoutForContent(null, content);
    expect(reconcileLayoutForContent(seeded, { ...content })).toBe(seeded);

    const withProject = createSinglePaneLayout({
      kind: 'agent-session',
      projectId: 'p1',
      sessionId: 's1'
    });
    const aligned = reconcileLayoutForContent(withProject, content);
    expect(aligned.root.type === 'pane' && aligned.root.content).toEqual(content);
    expect(reconcileLayoutForContent(aligned, content)).toBe(aligned);
  });

  it('updates a plugin panel subpath on the existing pane', () => {
    const first = createSinglePaneLayout({
      kind: 'plugin-panel',
      pluginId: 'docs',
      panelPath: 'panel',
      subPath: ''
    });
    const next = reconcileLayoutForContent(first, {
      kind: 'plugin-panel',
      pluginId: 'docs',
      panelPath: 'panel',
      subPath: 'a/b'
    });
    expect(next.root.type === 'pane' && next.root.content).toEqual({
      kind: 'plugin-panel',
      pluginId: 'docs',
      panelPath: 'panel',
      subPath: 'a/b'
    });
  });
});
