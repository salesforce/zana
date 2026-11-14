// @vitest-environment happy-dom
/**
 * Every return path (Ctrl/Cmd+I, Ctrl/Cmd+, and the Back links) checks that
 * the remembered thread or session still exists. Driven through the real
 * keydown handler, store, thread store and router sync. A removed thread or
 * session falls back to its project's home, or Home outside a project.
 */
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What main lists on the next roster load. */
const listed = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('../lib/product-client.js', () => ({
  product: {
    config: { set: vi.fn(async () => ({})) },
    projects: { touch: vi.fn(async () => {}) },
    terminals: { close: vi.fn(async () => true) },
    threads: { onUpdated: vi.fn(), onEvent: vi.fn(), list: vi.fn(async () => listed.rows) }
  }
}));
vi.mock('../lib/product-ws.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/product-ws.js')>()),
  subscribeProductReconnect: vi.fn(() => () => {})
}));

import { useData, useUi } from '../store.js';
import { useThreads } from '../thread-store.js';
import { installShortcuts } from '../shortcuts.js';
import { useRouteSync } from '../hooks/useRouteSync.js';
import { useAppSettingsRouteMemory } from '../hooks/useAppSettingsRouteMemory.js';
import { resetAppSettingsRouteMemory } from '../lib/route-memory.js';
import { resetRemovedRoutes } from '../lib/removed-routes.js';
import type { AppSettingsRouteMemory } from '../lib/route-memory.js';
import type { ThreadListItem } from '../thread-store.js';

const PROJECT_ID = 'proj-1';
let currentPath = '';
let backLinks: AppSettingsRouteMemory | null = null;

function Shell() {
  useRouteSync();
  // The Sidebar / Settings / Extensions / project-rail Back links read this.
  backLinks = useAppSettingsRouteMemory();
  const location = useLocation();
  currentPath = `${location.pathname}${location.search}${location.hash}`;
  return null;
}

function mountAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]} useTransitions={false}>
      <Shell />
    </MemoryRouter>
  );
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
  });
}

const thread = (id: string, extra: Partial<ThreadListItem> = {}) =>
  ({ id, title: id, projectId: PROJECT_ID, createdAt: 1, ...extra }) as ThreadListItem;

/** The roster's archive paths: a local archive, and another client's archive push. */
const removeThread = {
  'archived here': (id: string) => act(() => useThreads.getState().remove(id)),
  'archived elsewhere': (id: string) => act(() => useThreads.getState().upsert(thread(id, { archivedAt: 2 })))
};
/** The session close paths: closing a CLI agent, and main dismissing it. */
const removeSession = {
  closed: (id: string) => act(() => useData.getState().closeTerminal(id, PROJECT_ID)),
  dismissed: (id: string) => act(() => useData.getState().dismissTerminals([id]))
};

let offShortcuts: () => void = () => {};

beforeEach(() => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
  resetAppSettingsRouteMemory();
  resetRemovedRoutes();
  listed.rows = [];
  backLinks = null;
  useData.setState({ projects: [{ id: PROJECT_ID, name: 'one', path: '/p/one' }] as never, terminals: {} });
  useThreads.setState({ threads: [thread('thread-1'), thread('thread-2')] });
  useUi.setState({ nav: 'home', focusedProjectId: null, settingsAnchor: null });
  offShortcuts = installShortcuts();
});

afterEach(() => {
  offShortcuts();
  cleanup();
  vi.restoreAllMocks();
});

describe('Ctrl+I from the Inbox skips a removed thread or session', () => {
  for (const [how, remove] of Object.entries(removeThread)) {
    it(`goes Home when the thread it came from was ${how}`, () => {
      mountAt('/threads/thread-1');
      press('i');
      expect(currentPath).toBe('/inbox');
      remove('thread-1');

      press('i');
      expect(currentPath).toBe('/');
      expect(useUi.getState().nav).toBe('home');
    });
  }

  it("goes to the project's home when a project thread was archived", () => {
    mountAt(`/projects/${PROJECT_ID}/threads/thread-1`);
    press('i');
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/inbox`);
    removeThread['archived here']('thread-1');

    press('i');
    expect(currentPath).toBe(`/projects/${PROJECT_ID}`);
    expect(useUi.getState().focusedProjectId).toBe(PROJECT_ID);
  });

  for (const [how, remove] of Object.entries(removeSession)) {
    it(`goes to the project's home when the session it came from was ${how}`, async () => {
      mountAt(`/projects/${PROJECT_ID}/sessions/sess-1`);
      press('i');
      expect(currentPath).toBe(`/projects/${PROJECT_ID}/inbox`);
      await remove('sess-1');

      press('i');
      expect(currentPath).toBe(`/projects/${PROJECT_ID}`);
    });
  }

  it('goes Home from a removed global session route', async () => {
    mountAt('/sessions/sess-1');
    press('i');
    await removeSession.dismissed('sess-1');

    press('i');
    expect(currentPath).toBe('/');
  });

  it('still returns to a thread that was restored after being archived', () => {
    mountAt('/threads/thread-1');
    press('i');
    removeThread['archived elsewhere']('thread-1');
    act(() => useThreads.getState().upsert(thread('thread-1', { archivedAt: null })));

    press('i');
    expect(currentPath).toBe('/threads/thread-1');
  });

  it('still returns to a thread that another client restored and the roster relisted', async () => {
    mountAt('/threads/thread-1');
    press('i');
    removeThread['archived here']('thread-1');
    listed.rows = [thread('thread-1')];
    await act(() => useThreads.getState().load());

    press('i');
    expect(currentPath).toBe('/threads/thread-1');
  });

  it('still returns to a live thread when another one was archived', () => {
    mountAt('/threads/thread-1');
    press('i');
    removeThread['archived here']('thread-2');

    press('i');
    expect(currentPath).toBe('/threads/thread-1');
  });
});

describe('Ctrl+, from Settings skips a removed thread or session', () => {
  it('goes Home when the thread Settings was opened from was archived', () => {
    mountAt('/threads/thread-1');
    press(',');
    expect(useUi.getState().nav).toBe('settings');
    removeThread['archived here']('thread-1');

    press(',');
    expect(currentPath).toBe('/');
  });

  it('goes Home when the session Settings was opened from was closed', async () => {
    mountAt('/sessions/sess-1');
    press(',');
    await removeSession.closed('sess-1');

    press(',');
    expect(currentPath).toBe('/');
  });

  it("from a project's Settings, goes to the project view when its thread was archived", () => {
    mountAt(`/projects/${PROJECT_ID}/threads/thread-1`);
    press(',');
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/settings`);
    removeThread['archived elsewhere']('thread-1');

    press(',');
    expect(currentPath).toBe(`/projects/${PROJECT_ID}`);
    expect(useUi.getState().focusedProjectId).toBe(PROJECT_ID);
  });

  it("from a project's Settings, goes to the project view when its session was dismissed", async () => {
    mountAt(`/projects/${PROJECT_ID}/sessions/sess-1`);
    press(',');
    await removeSession.dismissed('sess-1');

    press(',');
    expect(currentPath).toBe(`/projects/${PROJECT_ID}`);
  });

  it('still returns to a live thread', () => {
    mountAt('/threads/thread-1');
    press(',');
    press(',');
    expect(currentPath).toBe('/threads/thread-1');
  });
});

describe('Back links skip a removed thread or session', () => {
  it("Settings' Back to app drops an archived thread and updates in place", () => {
    mountAt('/threads/thread-1');
    act(() => useUi.getState().setNav('settings'));
    expect(currentPath).toBe('/settings');
    expect(backLinks?.appRoutePath).toBe('/threads/thread-1');

    removeThread['archived elsewhere']('thread-1');
    expect(backLinks?.appRoutePath).toBe('/');
  });

  it("Settings' Back to app drops a closed session", async () => {
    mountAt(`/projects/${PROJECT_ID}/sessions/sess-1`);
    act(() => useUi.getState().setNav('settings'));
    // Settings' Back already leaves project routes for the Agents list.
    expect(backLinks?.appRoutePath).toBe('/agents');
    act(() => useUi.getState().exitProjectFocus('/sessions/sess-1'));
    act(() => useUi.getState().setNav('settings'));
    expect(backLinks?.appRoutePath).toBe('/sessions/sess-1');

    await removeSession.closed('sess-1');
    expect(backLinks?.appRoutePath).toBe('/');
  });

  it("Extensions' Back to app drops an archived thread", () => {
    mountAt('/threads/thread-1');
    act(() => useUi.getState().setNav('extensions'));
    expect(backLinks?.toolsBackRoutePath).toBe('/threads/thread-1');

    removeThread['archived here']('thread-1');
    expect(backLinks?.toolsBackRoutePath).toBe('/');
  });

  it("Extensions' Back to app drops a dismissed session", async () => {
    mountAt('/sessions/sess-1');
    act(() => useUi.getState().setNav('extensions'));
    await removeSession.dismissed('sess-1');
    expect(backLinks?.toolsBackRoutePath).toBe('/');
  });

  it("the project rail's Back to all projects drops an archived thread for the Agents list", () => {
    mountAt('/threads/thread-1');
    act(() => useUi.getState().enterProjectFocus(PROJECT_ID));
    expect(backLinks?.projectBackRoutePath).toBe('/threads/thread-1');

    removeThread['archived here']('thread-1');
    expect(backLinks?.projectBackRoutePath).toBe('/agents');
    act(() => useUi.getState().exitProjectFocus(backLinks?.projectBackRoutePath));
    expect(currentPath).toBe('/agents');
  });

  it("the project rail's Back to all projects drops a dismissed session", async () => {
    mountAt('/sessions/sess-1');
    act(() => useUi.getState().enterProjectFocus(PROJECT_ID));
    await removeSession.dismissed('sess-1');
    expect(backLinks?.projectBackRoutePath).toBe('/agents');
  });
});
