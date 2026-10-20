// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { splitPane } from './ops.js';
import {
  deserializeSplitLayoutBag,
  serializeSplitLayoutBag,
  SPLIT_LAYOUT_BAG_VERSION,
  SPLIT_LAYOUT_STORAGE_KEY
} from './persistence.js';
import { GLOBAL_SPLIT_SCOPE_KEY, projectSplitScopeKey } from './scope.js';
import { createSinglePaneLayout, threadPaneContent } from './splitThreadNavigation.js';
import type { SplitLayout } from './types.js';

const P1 = projectSplitScopeKey('p1');
const P2 = projectSplitScopeKey('p2');

const homeAndInbox: SplitLayout = splitPane(
  createSinglePaneLayout({ kind: 'home' }),
  'pane-1',
  'right',
  { kind: 'inbox' }
);
const agentsOnly = createSinglePaneLayout({ kind: 'agents' });

function bag(scopes: Record<string, SplitLayout>): string {
  return serializeSplitLayoutBag({
    version: SPLIT_LAYOUT_BAG_VERSION,
    scopes: Object.fromEntries(
      Object.entries(scopes).map(([key, layout]) => [key, { layout, maximizedPaneId: null }])
    )
  });
}

function remembered(): Record<string, SplitLayout | null> {
  const scopes = deserializeSplitLayoutBag(localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).scopes;
  return Object.fromEntries(Object.entries(scopes).map(([key, slot]) => [key, slot.layout]));
}

async function loadStore() {
  vi.resetModules();
  return (await import('./store.js')).useSplitWorkspace;
}

describe('split workspace persistence across windows and relaunch', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('restores the last saved layouts in a new window or after relaunch', async () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, bag({ [GLOBAL_SPLIT_SCOPE_KEY]: homeAndInbox, [P1]: agentsOnly }));
    const store = await loadStore();
    expect(store.getState().layout).toEqual(homeAndInbox);
    store.getState().activateScope(P1);
    expect(store.getState().layout).toEqual(agentsOnly);
  });

  it("prefers this window's own layouts over the shared copy", async () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, bag({ [GLOBAL_SPLIT_SCOPE_KEY]: homeAndInbox }));
    sessionStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, bag({ [GLOBAL_SPLIT_SCOPE_KEY]: agentsOnly }));
    const store = await loadStore();
    expect(store.getState().layout).toEqual(agentsOnly);
  });

  it('starts empty when the shared copy is unreadable', async () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, '{not json');
    const store = await loadStore();
    expect(store.getState().layout).toBeNull();
    expect(store.getState().scopes).toEqual({});
  });

  it('saves to both stores and merges only the changed scope into the shared copy', async () => {
    const store = await loadStore();
    // Another window saved P2 after this one loaded; it must survive our save.
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, bag({ [P2]: agentsOnly }));
    store.getState().setLayout(homeAndInbox);
    expect(remembered()).toEqual({ [P2]: agentsOnly, [GLOBAL_SPLIT_SCOPE_KEY]: homeAndInbox });
    expect(deserializeSplitLayoutBag(sessionStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).scopes[GLOBAL_SPLIT_SCOPE_KEY]?.layout)
      .toEqual(homeAndInbox);

    store.getState().setLayout(null);
    expect(remembered()).toEqual({ [P2]: agentsOnly });
  });

  it('saves the scope being left and the scope being entered', async () => {
    const store = await loadStore();
    store.getState().setLayout(homeAndInbox);
    localStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
    store.getState().activateScope(P1);
    expect(remembered()).toEqual({ [GLOBAL_SPLIT_SCOPE_KEY]: homeAndInbox });
  });

  it('keeps only the most recently saved scopes', async () => {
    const store = await loadStore();
    const { MAX_REMEMBERED_SCOPES } = await import('./store.js');
    for (let index = 0; index <= MAX_REMEMBERED_SCOPES; index += 1) {
      store.getState().activateScope(projectSplitScopeKey(`p${index}`));
      store.getState().setLayout(agentsOnly);
    }
    const keys = Object.keys(remembered());
    expect(keys).toHaveLength(MAX_REMEMBERED_SCOPES);
    expect(keys).not.toContain(projectSplitScopeKey('p0'));
    expect(keys.at(-1)).toBe(projectSplitScopeKey(`p${MAX_REMEMBERED_SCOPES}`));
  });

  it('forgets an inactive project scope everywhere', async () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, bag({ [GLOBAL_SPLIT_SCOPE_KEY]: homeAndInbox, [P1]: agentsOnly }));
    const store = await loadStore();
    store.getState().forgetScope(P1);
    expect(store.getState().scopes[P1]).toBeUndefined();
    expect(store.getState().layout).toEqual(homeAndInbox);
    expect(remembered()).toEqual({ [GLOBAL_SPLIT_SCOPE_KEY]: homeAndInbox });
  });

  it('clears the active scope when it is forgotten', async () => {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, bag({ [P1]: agentsOnly }));
    const store = await loadStore();
    store.getState().activateScope(P1);
    store.getState().forgetScope(P1);
    expect(store.getState().layout).toBeNull();
    expect(remembered()).toEqual({});
  });

  it('removes archived thread panes from the shared copy of every scope it changed', async () => {
    const twoThreads = splitPane(
      createSinglePaneLayout(threadPaneContent('t1', 'p1')),
      'pane-1',
      'right',
      threadPaneContent('t2', 'p1')
    );
    localStorage.setItem(
      SPLIT_LAYOUT_STORAGE_KEY,
      bag({ [GLOBAL_SPLIT_SCOPE_KEY]: homeAndInbox, [P1]: createSinglePaneLayout(threadPaneContent('t1', 'p1')) })
    );
    const store = await loadStore();
    store.getState().activateScope(P2);
    store.getState().setLayout(twoThreads);
    store.getState().closePanesForThreads(['t1']);
    const saved = remembered();
    expect(saved[P1]).toBeUndefined();
    expect(saved[GLOBAL_SPLIT_SCOPE_KEY]).toEqual(homeAndInbox);
    expect(saved[P2]?.root).toEqual(store.getState().layout?.root);
  });
});
