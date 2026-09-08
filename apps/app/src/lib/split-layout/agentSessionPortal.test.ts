import { describe, expect, it } from 'vitest';
import { agentSessionAnchorId, pickAgentSessionPortalTarget, pickProjectTerminalsPortalTarget, projectTerminalsAnchorId } from './agentSessionPortal.js';
import { createSinglePaneLayout, threadPaneContent } from './splitThreadNavigation.js';
import { splitPane } from './ops.js';

describe('pickAgentSessionPortalTarget', () => {
  it('builds a stable DOM id for the session pane anchor', () => {
    expect(agentSessionAnchorId('sess-1')).toBe('cc-terminal-anchor-agent-session-sess-1');
  });

  it('uses the route when layout is empty', () => {
    expect(
      pickAgentSessionPortalTarget(null, {
        kind: 'agent-session',
        projectId: 'p1',
        sessionId: 's1'
      })
    ).toEqual({ projectId: 'p1', sessionId: 's1' });
    expect(pickAgentSessionPortalTarget(null, { kind: 'home' })).toBeNull();
  });

  it('prefers the focused agent-session pane when two are open', () => {
    const first = createSinglePaneLayout({ kind: 'agent-session', projectId: 'p1', sessionId: 's1' });
    const two = splitPane(first, 'pane-1', 'right', {
      kind: 'agent-session',
      projectId: 'p1',
      sessionId: 's2'
    });
    expect(pickAgentSessionPortalTarget(two, null)).toEqual({ projectId: 'p1', sessionId: 's2' });
  });

  it('keeps the agent pane when a thread is focused beside it', () => {
    const seeded = createSinglePaneLayout({ kind: 'agent-session', projectId: 'p1', sessionId: 's1' });
    const two = splitPane(seeded, 'pane-1', 'right', threadPaneContent('t1', 'p1'));
    expect(pickAgentSessionPortalTarget(two, { kind: 'thread', projectId: 'p1', threadId: 't1' })).toEqual({
      projectId: 'p1',
      sessionId: 's1'
    });
  });
});

describe('pickProjectTerminalsPortalTarget', () => {
  it('builds a stable DOM id for the terminals pane anchor', () => {
    expect(projectTerminalsAnchorId('pane-3')).toBe('cc-terminal-anchor-project-view-pane-3');
  });

  it('uses the route when layout is empty', () => {
    expect(
      pickProjectTerminalsPortalTarget(null, {
        kind: 'project-view',
        projectId: 'p1',
        mode: 'terminals'
      })
    ).toEqual({ paneId: 'pane-1', projectId: 'p1' });
    expect(
      pickProjectTerminalsPortalTarget(null, {
        kind: 'project-view',
        projectId: 'p1',
        mode: 'explorer'
      })
    ).toBeNull();
  });

  it('keeps the terminals pane when explorer is focused beside it', () => {
    const seeded = createSinglePaneLayout({
      kind: 'project-view',
      projectId: 'p1',
      mode: 'terminals'
    });
    const two = splitPane(seeded, 'pane-1', 'right', {
      kind: 'project-view',
      projectId: 'p1',
      mode: 'explorer'
    });
    expect(
      pickProjectTerminalsPortalTarget(two, {
        kind: 'project-view',
        projectId: 'p1',
        mode: 'explorer'
      })
    ).toEqual({ paneId: 'pane-1', projectId: 'p1' });
  });
});
