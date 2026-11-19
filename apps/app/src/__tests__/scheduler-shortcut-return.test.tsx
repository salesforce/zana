// @vitest-environment happy-dom
/**
 * Ctrl/Cmd+J round trip, driven through the real keydown handler
 * (`installShortcuts`), the real store and the real router sync: the second
 * press returns to the exact route open before the Scheduler, and falls back
 * to Home only when there is nothing (or nothing live) to return to. The
 * Scheduler counterpart of `inbox-shortcut-return.test.tsx` (#730).
 */
import { Suspense } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The project a "per-project window" is locked to; null is the main window. */
const scope = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('../lib/windowScope.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/windowScope.js')>()),
  getScopedProjectId: () => scope.id,
  isScopedWindow: () => scope.id !== null
}));

vi.mock('../lib/product-client.js', () => ({
  product: {
    config: { set: vi.fn(async () => ({})) },
    projects: { touch: vi.fn(async () => {}) }
  }
}));

import { useData, useUi } from '../store.js';
import { installShortcuts } from '../shortcuts.js';
import { useRouteSync } from '../hooks/useRouteSync.js';
import {
  getRouteBeforeScheduler,
  isSchedulerRoutePath,
  resetAppSettingsRouteMemory
} from '../lib/route-memory.js';
import { appNavigate } from '../lib/app-navigate.js';

const PROJECT_ID = 'proj-1';
let currentPath = '';

function Shell() {
  useRouteSync();
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

function pressCtrl(key: 'i' | 'j') {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
  });
}

const pressCtrlJ = () => pressCtrl('j');

let offShortcuts: () => void = () => {};

beforeEach(() => {
  scope.id = null;
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
  resetAppSettingsRouteMemory();
  useData.setState({ projects: [{ id: PROJECT_ID, name: 'one', path: '/p/one' }] as never });
  useUi.setState({ nav: 'home', focusedProjectId: null, settingsAnchor: null });
  offShortcuts = installShortcuts();
});

afterEach(() => {
  offShortcuts();
  cleanup();
  vi.restoreAllMocks();
});

describe('Ctrl+J returns from the Scheduler to where the user was', () => {
  it('returns to the open thread, not Home', () => {
    mountAt('/threads/thread-1');

    pressCtrlJ();
    expect(currentPath).toBe('/scheduler');
    expect(useUi.getState().nav).toBe('scheduler');

    pressCtrlJ();
    expect(currentPath).toBe('/threads/thread-1');
  });

  it('returns to the Settings page it was opened from', () => {
    mountAt('/settings/terminal');

    pressCtrlJ();
    expect(currentPath).toBe('/scheduler');

    pressCtrlJ();
    expect(currentPath).toBe('/settings/terminal');
    expect(useUi.getState().nav).toBe('settings');
    expect(useUi.getState().settingsTab).toBe('terminal');
  });

  it('drilled into a project, returns to that project view', () => {
    mountAt(`/projects/${PROJECT_ID}/explorer`);

    pressCtrlJ();
    expect(useUi.getState().nav).toBe('scheduler');

    pressCtrlJ();
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/explorer`);
    expect(useUi.getState().nav).toBe('projects');
    expect(useUi.getState().focusedProjectId).toBe(PROJECT_ID);
  });

  it("returns to a project's own Scheduler tab, which is a project view", () => {
    mountAt(`/projects/${PROJECT_ID}/scheduler`);

    pressCtrlJ();
    expect(currentPath).toBe('/scheduler');

    pressCtrlJ();
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/scheduler`);
  });

  it('skips moves inside the Scheduler and returns to the view before it', () => {
    mountAt('/agents');
    pressCtrlJ();
    expect(currentPath).toBe('/scheduler');
    // Open a schedule, then a new one: both are still the Scheduler.
    act(() => appNavigate('/schedules/sched-1'));
    expect(useUi.getState().nav).toBe('scheduler');
    act(() => appNavigate('/schedules/new'));
    expect(useUi.getState().nav).toBe('scheduler');

    pressCtrlJ();
    expect(currentPath).toBe('/agents');
  });

  it('keeps its own return target apart from the Inbox one', () => {
    mountAt('/threads/thread-1');
    pressCtrl('i');
    expect(currentPath).toBe('/inbox');
    pressCtrlJ();
    expect(currentPath).toBe('/scheduler');

    // Ctrl+J leaves the Scheduler for the view before it (the Inbox)...
    pressCtrlJ();
    expect(currentPath).toBe('/inbox');
    // ...while Ctrl+I's target is the last non-Inbox view, the Scheduler.
    pressCtrl('i');
    expect(currentPath).toBe('/scheduler');
  });

  it('falls back to Home when the Scheduler is the first view', () => {
    mountAt('/scheduler');

    pressCtrlJ();
    expect(currentPath).toBe('/');
    expect(useUi.getState().nav).toBe('home');
  });

  it('falls back to Home when the route before the Scheduler belongs to a removed project', () => {
    mountAt(`/projects/${PROJECT_ID}/explorer`);
    pressCtrlJ();
    expect(useUi.getState().nav).toBe('scheduler');
    act(() => useData.setState({ projects: [] }));
    act(() => useUi.setState({ focusedProjectId: null }));

    pressCtrlJ();
    expect(currentPath).toBe('/');
    expect(useUi.getState().nav).toBe('home');
  });

  it('still opens the Scheduler from Home and comes back', () => {
    mountAt('/');
    pressCtrlJ();
    expect(currentPath).toBe('/scheduler');
    pressCtrlJ();
    expect(currentPath).toBe('/');
  });

  it('ignores a render React discards: only committed routes become the return target', () => {
    const never = new Promise<never>(() => {});
    function SuspendsAfterSync(): null {
      useRouteSync();
      throw never;
    }
    render(
      <MemoryRouter initialEntries={['/threads/discarded']} useTransitions={false}>
        <Suspense fallback={null}>
          <SuspendsAfterSync />
        </Suspense>
      </MemoryRouter>
    );
    cleanup();
    expect(getRouteBeforeScheduler()).toBeNull();

    mountAt('/scheduler');
    pressCtrlJ();
    expect(currentPath).toBe('/');
  });
});

describe('Ctrl+J in a window locked to one project', () => {
  const LOCK = `?projectId=${PROJECT_ID}`;

  beforeEach(() => {
    scope.id = PROJECT_ID;
  });

  it('stays inside the project and never records an out-of-scope route', () => {
    mountAt(`/projects/${PROJECT_ID}/explorer${LOCK}`);
    const seen: Array<string | null> = [];
    const unsubscribe = useUi.subscribe(() => seen.push(getRouteBeforeScheduler()));

    pressCtrlJ();
    pressCtrlJ();
    unsubscribe();
    expect(currentPath.startsWith(`/projects/${PROJECT_ID}`)).toBe(true);
    expect(currentPath.endsWith(LOCK)).toBe(true);
    expect(seen.every((p) => p === null || p.startsWith(`/projects/${PROJECT_ID}`))).toBe(true);
  });
});

describe('isSchedulerRoutePath', () => {
  it('matches the top-level Scheduler routes only', () => {
    expect(isSchedulerRoutePath('/scheduler')).toBe(true);
    expect(isSchedulerRoutePath('/schedules/new')).toBe(true);
    expect(isSchedulerRoutePath('/schedules/sched-1')).toBe(true);
    expect(isSchedulerRoutePath(`/projects/${PROJECT_ID}/scheduler`)).toBe(false);
    expect(isSchedulerRoutePath(`/projects/${PROJECT_ID}/schedules/sched-1`)).toBe(false);
    expect(isSchedulerRoutePath('/inbox')).toBe(false);
  });
});
