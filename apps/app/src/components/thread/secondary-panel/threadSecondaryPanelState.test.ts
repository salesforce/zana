import { afterEach, describe, expect, it } from 'vitest';
import {
  addClosableTab,
  closeClosableTab,
  closeSecondaryPanel,
  emptySecondaryPanelState,
  INFO_PIN_ID,
  loadSecondaryPanelState,
  activateClosableTab,
  openNewTab,
  openSecondaryPanel,
  parseSecondaryPanelState,
  patchClosableTab,
  persistIfThread,
  persistSecondaryPanelState,
  restoreIfThread,
  restoreSecondaryPanel,
  selectPinnedView,
  setSecondaryPanelWidth,
  storageKeyForThread,
  toggleSecondaryPanelMaximized,
  uniqueTabSuffix,
  activePinnedView
} from './threadSecondaryPanelState.js';

describe('thread secondary panel state', () => {
  afterEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('opens onto the Info pin by default', () => {
    const next = openSecondaryPanel(emptySecondaryPanelState());
    expect(next.isOpen).toBe(true);
    expect(next.activeId).toBe(INFO_PIN_ID);
    expect(activePinnedView(next)).toBe('info');
    expect(activePinnedView(selectPinnedView(next, 'diff'))).toBe('diff');
    expect(activePinnedView(selectPinnedView(next, 'plan'))).toBe('plan');
    const withTab = addClosableTab(next, { kind: 'browser', title: 'Browser', url: 'https://example.com' });
    expect(activePinnedView(withTab)).toBeNull();
    expect(toggleSecondaryPanelMaximized(emptySecondaryPanelState())).toMatchObject({
      isOpen: true,
      isMaximized: true
    });
  });

  it('selects the Diff pin and opens the panel', () => {
    const next = selectPinnedView(emptySecondaryPanelState(), 'diff');
    expect(next.isOpen).toBe(true);
    expect(next.activeId).toBe('diff');
  });

  it('restores a persisted Plan pin', () => {
    const parsed = parseSecondaryPanelState({
      version: 1,
      isOpen: true,
      widthPx: 360,
      activeId: 'plan',
      tabs: []
    });
    expect(parsed.activeId).toBe('plan');
    expect(activePinnedView(parsed)).toBe('plan');
  });

  it('restores a persisted Explorer tab', () => {
    const parsed = parseSecondaryPanelState({
      version: 1,
      isOpen: true,
      widthPx: 360,
      activeId: 'explorer:1',
      tabs: [{ id: 'explorer:1', kind: 'explorer', title: 'Explorer' }]
    });
    expect(parsed.activeId).toBe('explorer:1');
    expect(parsed.tabs[0]?.kind).toBe('explorer');
  });

  it('replaces an active New Tab when opening a file preview', () => {
    const withNew = openNewTab(emptySecondaryPanelState());
    const next = addClosableTab(withNew, { kind: 'file-preview', title: 'README.md', path: '/tmp/README.md' });
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0]?.kind).toBe('file-preview');
    expect(next.activeId).toBe(next.tabs[0]?.id);
  });

  it('reuses an existing file preview instead of duplicating it', () => {
    const opened = addClosableTab(emptySecondaryPanelState(), {
      kind: 'file-preview',
      title: 'a.ts',
      path: '/tmp/a.ts'
    });
    const again = addClosableTab(opened, { kind: 'file-preview', title: 'a.ts', path: '/tmp/a.ts' });
    expect(again.tabs).toHaveLength(1);
    expect(again.activeId).toBe(opened.tabs[0]?.id);
  });

  it('falls back to Info after closing the active tab', () => {
    const opened = addClosableTab(emptySecondaryPanelState(), {
      kind: 'browser',
      title: 'Browser',
      url: 'https://example.com'
    });
    const closed = closeClosableTab(opened, opened.tabs[0]!.id);
    expect(closed.tabs).toEqual([]);
    expect(closed.activeId).toBe(INFO_PIN_ID);
  });

  it('clamps persisted width and ignores unknown tabs', () => {
    const parsed = parseSecondaryPanelState({
      version: 1,
      isOpen: true,
      widthPx: 40,
      activeId: 'missing',
      tabs: [{ id: 'x', kind: 'nope', title: 'x' }, { id: 'ok', kind: 'new-tab', title: 'New Tab' }]
    });
    expect(parsed.widthPx).toBeGreaterThanOrEqual(288);
    expect(parsed.activeId).toBe(INFO_PIN_ID);
    expect(parsed.tabs).toHaveLength(1);
  });

  it('round-trips through localStorage', () => {
    const memory = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
      removeItem: (key) => { memory.delete(key); },
      clear: () => memory.clear(),
      key: (index) => [...memory.keys()][index] ?? null,
      get length() { return memory.size; }
    } as Storage;
    const state = setSecondaryPanelWidth(
      toggleSecondaryPanelMaximized(openSecondaryPanel(emptySecondaryPanelState())),
      480
    );
    persistSecondaryPanelState('thread-1', state);
    expect(localStorage.getItem(storageKeyForThread('thread-1'))).toContain('"isOpen":true');
    expect(loadSecondaryPanelState('thread-1')).toMatchObject({
      isOpen: true,
      isMaximized: true,
      widthPx: 480
    });
  });

  it('closes without leaving maximize on', () => {
    const closed = closeSecondaryPanel(toggleSecondaryPanelMaximized(openSecondaryPanel(emptySecondaryPanelState())));
    expect(closed.isOpen).toBe(false);
    expect(closed.isMaximized).toBe(false);
  });

  it('activates an existing closable tab and ignores unknown ids', () => {
    const opened = addClosableTab(emptySecondaryPanelState(), {
      kind: 'browser',
      title: 'Browser',
      url: 'https://example.com'
    });
    const activated = activateClosableTab(opened, opened.tabs[0]!.id);
    expect(activated.activeId).toBe(opened.tabs[0]?.id);
    expect(activated.isOpen).toBe(true);
    expect(activateClosableTab(opened, 'missing')).toBe(opened);
  });

  it('reuses terminal, plugin, and browser tabs by identity', () => {
    const term = addClosableTab(emptySecondaryPanelState(), {
      kind: 'terminal',
      title: 'Terminal',
      sessionId: 's1'
    });
    expect(addClosableTab(term, { kind: 'terminal', title: 'Terminal', sessionId: 's1' }).tabs).toHaveLength(1);
    const plugin = addClosableTab(emptySecondaryPanelState(), {
      kind: 'plugin',
      title: 'Docs',
      moduleId: 'docs'
    });
    expect(addClosableTab(plugin, { kind: 'plugin', title: 'Docs', moduleId: 'docs' }).tabs).toHaveLength(1);
    const panel = addClosableTab(emptySecondaryPanelState(), {
      kind: 'plugin',
      title: 'Tasks',
      moduleId: 'tasks',
      actionId: 'board',
      params: { id: '1' }
    });
    expect(addClosableTab(panel, {
      kind: 'plugin',
      title: 'Tasks',
      moduleId: 'tasks',
      actionId: 'board',
      params: { id: '1' }
    }).tabs).toHaveLength(1);
    expect(addClosableTab(panel, {
      kind: 'plugin',
      title: 'Tasks',
      moduleId: 'tasks',
      actionId: 'board',
      params: { id: '2' }
    }).tabs).toHaveLength(2);
    const browser = addClosableTab(emptySecondaryPanelState(), {
      kind: 'browser',
      title: 'Browser',
      url: 'https://example.com'
    });
    expect(addClosableTab(browser, { kind: 'browser', title: 'Browser', url: 'https://example.com' }).tabs).toHaveLength(1);
    expect(addClosableTab(browser, { kind: 'browser', title: 'Browser', url: 'https://zana.ai' }).tabs).toHaveLength(2);
    const explorer = addClosableTab(emptySecondaryPanelState(), { kind: 'explorer', title: 'Explorer' });
    expect(addClosableTab(explorer, { kind: 'explorer', title: 'Explorer' }).tabs).toHaveLength(1);
  });

  it('leaves inactive tabs in place when closing another tab', () => {
    const first = addClosableTab(emptySecondaryPanelState(), { kind: 'new-tab', title: 'New Tab' });
    const second = addClosableTab(first, { kind: 'new-tab', title: 'New Tab' });
    const closed = closeClosableTab(second, first.tabs[0]!.id);
    expect(closed.tabs).toHaveLength(1);
    expect(closed.activeId).toBe(second.tabs[1]?.id);
  });

  it('patches a closable tab url in place', () => {
    const opened = addClosableTab(emptySecondaryPanelState(), {
      kind: 'browser',
      title: 'Browser',
      url: 'https://example.com'
    });
    const patched = patchClosableTab(opened, opened.tabs[0]!.id, { url: 'https://zana.ai' });
    expect(patched.tabs[0]?.url).toBe('https://zana.ai');
    expect(patched.tabs[0]?.id).toBe(opened.tabs[0]?.id);
  });

  it('falls back when persisted JSON is invalid or storage throws', () => {
    const memory = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key) => {
        if (key.includes('throw-get')) throw new Error('fail');
        return memory.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (key.includes('throw-set')) throw new Error('fail');
        memory.set(key, value);
      },
      removeItem: (key) => { memory.delete(key); },
      clear: () => memory.clear(),
      key: (index) => [...memory.keys()][index] ?? null,
      get length() { return memory.size; }
    } as Storage;
    localStorage.setItem(storageKeyForThread('bad'), '{');
    expect(loadSecondaryPanelState('bad')).toEqual(emptySecondaryPanelState());
    expect(parseSecondaryPanelState(null)).toEqual(emptySecondaryPanelState());
    expect(parseSecondaryPanelState({ version: 2 })).toEqual(emptySecondaryPanelState());
    expect(() => persistSecondaryPanelState('throw-set', emptySecondaryPanelState())).not.toThrow();
    expect(loadSecondaryPanelState('throw-get')).toEqual(emptySecondaryPanelState());
    expect(loadSecondaryPanelState('never-set')).toEqual(emptySecondaryPanelState());
    const opened = addClosableTab(emptySecondaryPanelState(), {
      kind: 'browser',
      title: 'Browser',
      url: 'https://example.com'
    });
    const patchedUnknown = patchClosableTab(opened, 'missing', { title: 'Nope' });
    expect(patchedUnknown.tabs[0]?.url).toBe('https://example.com');
    expect(uniqueTabSuffix(() => 'fixed')).toBe('fixed');
    expect(uniqueTabSuffix(undefined).length).toBeGreaterThan(4);
    expect(restoreIfThread(undefined)).toEqual(emptySecondaryPanelState());
    persistIfThread(undefined, emptySecondaryPanelState());
    persistIfThread('kept', opened);
    expect(loadSecondaryPanelState('kept').tabs).toHaveLength(1);
    expect(restoreSecondaryPanel('missing', { defaultOpen: true }).isOpen).toBe(true);
    expect(restoreSecondaryPanel('kept', { defaultOpen: true }).tabs).toHaveLength(1);
    const originalStorage = globalThis.localStorage;
    // @ts-expect-error -- simulate a worker without storage
    delete globalThis.localStorage;
    expect(loadSecondaryPanelState('x')).toEqual(emptySecondaryPanelState());
    expect(() => persistSecondaryPanelState('x', emptySecondaryPanelState())).not.toThrow();
    persistIfThread('y', emptySecondaryPanelState());
    globalThis.localStorage = originalStorage;
  });

  it('loads a legacy thread storage key and defaults agents open', () => {
    const memory = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
      removeItem: (key) => { memory.delete(key); },
      clear: () => memory.clear(),
      key: (index) => [...memory.keys()][index] ?? null,
      get length() { return memory.size; }
    } as Storage;
    memory.set('zcc.thread.secondaryPanel.legacy-thread', JSON.stringify({
      version: 1,
      isOpen: true,
      isMaximized: false,
      widthPx: 400,
      activeId: 'info',
      tabs: []
    }));
    expect(loadSecondaryPanelState('legacy-thread')).toMatchObject({ isOpen: true, widthPx: 400 });
    persistSecondaryPanelState('legacy-thread', emptySecondaryPanelState({ isOpen: true }));
    expect(localStorage.getItem(storageKeyForThread('legacy-thread'))).toContain('"isOpen":true');
    expect(emptySecondaryPanelState({ isOpen: true }).isOpen).toBe(true);
    expect(emptySecondaryPanelState().isOpen).toBe(false);
  });
});
