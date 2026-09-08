import { describe, expect, it } from 'vitest';
import {
  deserializeSplitLayout,
  deserializeSplitLayoutBag,
  serializeSplitLayout,
  serializeSplitLayoutBag,
  SPLIT_LAYOUT_BAG_VERSION,
  SPLIT_LAYOUT_SCHEMA_VERSION
} from './persistence.js';
import { GLOBAL_SPLIT_SCOPE_KEY, projectSplitScopeKey } from './scope.js';
import type { SplitLayout } from './types.js';

function layoutWithPaneCount(count: number): SplitLayout {
  return {
    root: {
      type: 'split',
      dir: 'row',
      sizes: Array.from({ length: count }, () => 1 / count),
      children: Array.from({ length: count }, (_, index) => ({
        type: 'pane' as const,
        paneId: `pane-${index + 1}`,
        content: {
          kind: 'thread' as const,
          projectId: 'project-1',
          threadId: `thread-${index + 1}`
        }
      }))
    },
    focusedPaneId: `pane-${count}`
  };
}

const layout: SplitLayout = {
  root: {
    type: 'split',
    dir: 'row',
    sizes: [0.4, 0.6],
    children: [
      {
        type: 'pane',
        paneId: 'pane-1',
        content: { kind: 'thread', projectId: 'project-1', threadId: 'thread-1' }
      },
      {
        type: 'pane',
        paneId: 'pane-2',
        content: { kind: 'thread', projectId: 'project-2', threadId: 'thread-2' }
      }
    ]
  },
  focusedPaneId: 'pane-2'
};

describe('split layout persistence', () => {
  it('round-trips a versioned split layout', () => {
    const serialized = serializeSplitLayout(layout);
    expect(JSON.parse(serialized)).toMatchObject({ version: SPLIT_LAYOUT_SCHEMA_VERSION });
    expect(deserializeSplitLayout(serialized)).toEqual(layout);
  });

  it('round-trips mixed home, agents, new-thread, and plugin panel content', () => {
    const mixed: SplitLayout = {
      root: {
        type: 'split',
        dir: 'row',
        sizes: [0.5, 0.5],
        children: [
          {
            type: 'pane',
            paneId: 'pane-1',
            content: { kind: 'agent-session', projectId: 'p1', sessionId: 'sess-1' }
          },
          {
            type: 'pane',
            paneId: 'pane-2',
            content: {
              kind: 'plugin-panel',
              pluginId: 'notes',
              panelPath: 'notes',
              subPath: 'work/today.md'
            }
          }
        ]
      },
      focusedPaneId: 'pane-2'
    };
    expect(deserializeSplitLayout(serializeSplitLayout(mixed))).toEqual(mixed);
  });

  it('round-trips scheduler, schedule, and new-schedule pane content', () => {
    const mixed: SplitLayout = {
      root: {
        type: 'split',
        dir: 'row',
        sizes: [0.5, 0.5],
        children: [
          {
            type: 'pane',
            paneId: 'pane-1',
            content: { kind: 'scheduler' }
          },
          {
            type: 'pane',
            paneId: 'pane-2',
            content: { kind: 'schedule', projectId: null, scheduleId: 'sched-1' }
          }
        ]
      },
      focusedPaneId: 'pane-2'
    };
    expect(deserializeSplitLayout(serializeSplitLayout(mixed))).toEqual(mixed);
  });

  it('round-trips an unscoped agent-session pane', () => {
    const unscoped: SplitLayout = {
      root: {
        type: 'pane',
        paneId: 'pane-1',
        content: { kind: 'agent-session', projectId: null, sessionId: 'sess-1' }
      },
      focusedPaneId: 'pane-1'
    };
    expect(deserializeSplitLayout(serializeSplitLayout(unscoped))).toEqual(unscoped);
  });

  it('round-trips a project-view pane', () => {
    const projectView: SplitLayout = {
      root: {
        type: 'pane',
        paneId: 'pane-1',
        content: { kind: 'project-view', projectId: 'p1', mode: 'explorer' }
      },
      focusedPaneId: 'pane-1'
    };
    expect(deserializeSplitLayout(serializeSplitLayout(projectView))).toEqual(projectView);
  });

  it('round-trips an inbox pane', () => {
    const inbox: SplitLayout = {
      root: {
        type: 'pane',
        paneId: 'pane-1',
        content: { kind: 'inbox' }
      },
      focusedPaneId: 'pane-1'
    };
    expect(deserializeSplitLayout(serializeSplitLayout(inbox))).toEqual(inbox);
  });

  it('round-trips an empty drop well', () => {
    const empty: SplitLayout = {
      root: {
        type: 'split',
        dir: 'row',
        sizes: [0.5, 0.5],
        children: [
          {
            type: 'pane',
            paneId: 'pane-1',
            content: { kind: 'agents' }
          },
          {
            type: 'pane',
            paneId: 'pane-2',
            content: { kind: 'empty' }
          }
        ]
      },
      focusedPaneId: 'pane-2'
    };
    expect(deserializeSplitLayout(serializeSplitLayout(empty))).toEqual(empty);
  });

  it('round-trips and restores all eight panes with focus and sizes intact', () => {
    const eightPanes = layoutWithPaneCount(8);
    expect(deserializeSplitLayout(serializeSplitLayout(eightPanes))).toEqual(eightPanes);
  });

  it('rejects malformed JSON, unknown versions, and invalid layout invariants', () => {
    expect(deserializeSplitLayout(null)).toBeNull();
    expect(deserializeSplitLayout('not json')).toBeNull();
    expect(deserializeSplitLayout(JSON.stringify({ version: 999, layout }))).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: { ...layout, root: { ...layout.root, sizes: [0.4, 0.4] } }
        })
      )
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: { ...layout, focusedPaneId: 'missing' }
        })
      )
    ).toBeNull();
    expect(deserializeSplitLayout(serializeSplitLayout(layoutWithPaneCount(9)))).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: {
            root: {
              type: 'pane',
              paneId: 'pane-1',
              content: { kind: 'agent-session', projectId: 'p1' }
            },
            focusedPaneId: 'pane-1'
          }
        })
      )
    ).toBeNull();
  });

  it('migrates a v1 blob into the global scope, carrying the maximized pane', () => {
    const bag = deserializeSplitLayoutBag(serializeSplitLayout(layout), 'pane-2');
    expect(bag.version).toBe(SPLIT_LAYOUT_BAG_VERSION);
    expect(bag.scopes[GLOBAL_SPLIT_SCOPE_KEY]).toEqual({
      layout,
      maximizedPaneId: 'pane-2'
    });
  });

  it('round-trips two scopes in a version-2 bag', () => {
    const projectLayout: SplitLayout = {
      root: {
        type: 'pane',
        paneId: 'pane-p',
        content: { kind: 'project-view', projectId: 'p1', mode: 'explorer' }
      },
      focusedPaneId: 'pane-p'
    };
    const bag = {
      version: SPLIT_LAYOUT_BAG_VERSION,
      scopes: {
        [GLOBAL_SPLIT_SCOPE_KEY]: { layout, maximizedPaneId: 'pane-1' },
        [projectSplitScopeKey('p1')]: { layout: projectLayout, maximizedPaneId: null }
      }
    } as const;
    expect(deserializeSplitLayoutBag(serializeSplitLayoutBag(bag))).toEqual(bag);
  });

  it('treats missing, empty, and unknown-version blobs as an empty bag', () => {
    expect(deserializeSplitLayoutBag(null)).toEqual({ version: SPLIT_LAYOUT_BAG_VERSION, scopes: {} });
    expect(deserializeSplitLayoutBag('')).toEqual({ version: SPLIT_LAYOUT_BAG_VERSION, scopes: {} });
    expect(deserializeSplitLayoutBag(JSON.stringify({ version: 999, scopes: {} }))).toEqual({
      version: SPLIT_LAYOUT_BAG_VERSION,
      scopes: {}
    });
  });
});
