/**
 * `focusInboxEntry` — the shared click-resolution logic both the bell drawer
 * and the native-notification handler call. No jsdom: hand-roll `window.cc`
 * (mirrors `project-focus-navigation.test.ts`) and dynamically import the
 * store + module registry fresh per test so state doesn't leak.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

function makeEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'entry-1',
    ts: 0,
    projectId: 'proj-1',
    comments: 'hi',
    ...overrides
  } as InboxEntry;
}

describe('focusInboxEntry', () => {
  // Every test below dynamically imports store.ts fresh (vi.resetModules() in
  // afterEach forces this, for state isolation). resetModules() only clears
  // the module-INSTANTIATION cache, not Vite's compiled-code transform cache —
  // so whichever test runs first still pays the one-time COLD TRANSFORM of the
  // ~3600-line store.ts (+ transitive deps), measured ~550ms solo vs ~30ms once
  // warm. Under the full parallel `vitest run` (pre-push hook, CI), many worker
  // forks cold-transforming their own large modules at once can push that cost
  // past the default 5s test timeout — a false-flake, not a logic race. Pay it
  // here instead, in a hook with its own generous timeout, before any test's
  // budget starts ticking.
  beforeAll(async () => {
    await import('../../store.js');
  }, 20_000);

  beforeEach(() => {
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k)
    };
    (globalThis as any).localStorage = localStorage;
    globalThis.window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      localStorage,
      cc: {
        config: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => ({})),
          onDidChange: vi.fn(() => vi.fn())
        },
        ipc: {
          on: vi.fn(() => vi.fn()),
          invoke: vi.fn(),
          send: vi.fn()
        },
        projects: {
          touch: vi.fn(async () => {})
        }
      }
    } as any;
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
    vi.resetModules();
  });

  it('with no target: selects the project, navigates to inbox, selects the entry, marks it read', async () => {
    const { useUi, useInboxSelection, useInboxRead } = await import('../../store.js');
    const { focusInboxEntry } = await import('../inboxNavigation.js');

    const entry = makeEntry();
    focusInboxEntry(entry);

    expect(useUi.getState().selectedProjectId).toBe('proj-1');
    expect(useUi.getState().nav).toBe('inbox');
    expect(useInboxSelection.getState().selectedEntryId).toBe('entry-1');
    expect(useInboxRead.getState().readIds['entry-1']).toBe(true);
  });

  it('with a target naming a projectTab module: enters project focus and sets the workspace mode to that module', async () => {
    const { useUi } = await import('../../store.js');
    const { useExtensionModules } = await import('../../modules/loader.js');
    const { focusInboxEntry } = await import('../inboxNavigation.js');

    useExtensionModules.getState().setModules([
      {
        id: 'ext-a',
        title: 'Ext A',
        icon: 'Box',
        panel: () => null,
        projectTab: {}
      } as any
    ]);

    const entry = makeEntry({ target: { moduleId: 'ext-a' } });
    focusInboxEntry(entry);

    expect(useUi.getState().nav).toBe('projects');
    expect(useUi.getState().focusedProjectId).toBe('proj-1');
    expect(useUi.getState().workspaceMode['proj-1']).toBe('ext-a');
  });

  it('with a target naming a non-projectTab module: selects the project and navigates to that module id', async () => {
    const { useUi } = await import('../../store.js');
    const { useExtensionModules } = await import('../../modules/loader.js');
    const { focusInboxEntry } = await import('../inboxNavigation.js');

    useExtensionModules.getState().setModules([
      {
        id: 'ext-b',
        title: 'Ext B',
        icon: 'Box',
        panel: () => null
      } as any
    ]);

    const entry = makeEntry({ target: { moduleId: 'ext-b' } });
    focusInboxEntry(entry);

    expect(useUi.getState().selectedProjectId).toBe('proj-1');
    expect(useUi.getState().nav).toBe('ext-b');
  });

  it('with a target naming a module that is no longer registered: falls back to the default Inbox landing', async () => {
    const { useUi, useInboxSelection } = await import('../../store.js');
    const { focusInboxEntry } = await import('../inboxNavigation.js');

    const entry = makeEntry({ target: { moduleId: 'ghost-ext' } });
    focusInboxEntry(entry);

    expect(useUi.getState().nav).toBe('inbox');
    expect(useInboxSelection.getState().selectedEntryId).toBe('entry-1');
  });

  it('with a target naming a module that has no panel: falls back to the default Inbox landing', async () => {
    const { useUi, useInboxSelection } = await import('../../store.js');
    const { useExtensionModules } = await import('../../modules/loader.js');
    const { focusInboxEntry } = await import('../inboxNavigation.js');

    useExtensionModules.getState().setModules([
      { id: 'ext-c', title: 'Ext C', icon: 'Box' } as any
    ]);

    const entry = makeEntry({ target: { moduleId: 'ext-c' } });
    focusInboxEntry(entry);

    expect(useUi.getState().nav).toBe('inbox');
    expect(useInboxSelection.getState().selectedEntryId).toBe('entry-1');
  });
});
