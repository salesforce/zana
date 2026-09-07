import { describe, expect, it } from 'vitest';
import { paneBarTitle, paneUsesHostBar } from './split-pane-bar-title.js';

describe('paneBarTitle', () => {
  it('labels host-header panes', () => {
    expect(paneBarTitle({ kind: 'home' })).toBe('Home');
    expect(paneBarTitle({ kind: 'inbox' })).toBe('Inbox');
    expect(paneBarTitle({ kind: 'agents' })).toBe('Agents');
    expect(paneBarTitle({ kind: 'scheduler' })).toBe('Scheduler');
    expect(paneBarTitle({ kind: 'empty' })).toBe('Drop a view here');
    expect(paneBarTitle({ kind: 'new-thread' })).toBe('New thread');
    expect(paneBarTitle({ kind: 'plugin-detail', pluginId: 'docs' })).toBe('Extension');
    expect(paneBarTitle({ kind: 'plugin-panel', pluginId: 'gus', panelPath: 'panel', subPath: '' })).toBe(
      'gus'
    );
    expect(
      paneBarTitle({ kind: 'plugin-panel', pluginId: 'gus', panelPath: 'panel', subPath: '' }, 'GUS')
    ).toBe('GUS');
    expect(paneBarTitle({ kind: 'project-view', projectId: 'p1', mode: 'agents' })).toBe('Agents');
    expect(paneBarTitle({ kind: 'project-view', projectId: 'p1', mode: 'consensus' })).toBe(
      'consensus'
    );
  });
});

describe('paneUsesHostBar', () => {
  it('skips views that already have a header row', () => {
    expect(paneUsesHostBar({ kind: 'thread', projectId: 'p1', threadId: 't1' })).toBe(false);
    expect(paneUsesHostBar({ kind: 'agent-session', projectId: 'p1', sessionId: 's1' })).toBe(false);
    expect(paneUsesHostBar({ kind: 'schedule', projectId: 'p1', scheduleId: 'sc1' })).toBe(false);
    expect(paneUsesHostBar({ kind: 'new-schedule' })).toBe(false);
    expect(paneUsesHostBar({ kind: 'project-view', projectId: 'p1', mode: 'scheduler' })).toBe(
      false
    );
  });

  it('hosts a bar on views without their own close chrome', () => {
    expect(paneUsesHostBar({ kind: 'home' })).toBe(true);
    expect(paneUsesHostBar({ kind: 'inbox' })).toBe(true);
    expect(paneUsesHostBar({ kind: 'agents' })).toBe(true);
    expect(paneUsesHostBar({ kind: 'empty' })).toBe(true);
    expect(paneUsesHostBar({ kind: 'project-view', projectId: 'p1', mode: 'agents' })).toBe(true);
  });
});
