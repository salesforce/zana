// @vitest-environment happy-dom
/**
 * Ctrl/Cmd+I round trip, driven through the real keydown handler
 * (`installShortcuts`), the real store and the real router sync: the second
 * press returns to the exact route open before the Inbox, and falls back to
 * Home only when there is nothing (or nothing live) to return to.
 */
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/product-client.js', () => ({
  product: {
    config: { set: vi.fn(async () => ({})) },
    projects: { touch: vi.fn(async () => {}) }
  }
}));

import { useData, useUi } from '../store.js';
import { installShortcuts } from '../shortcuts.js';
import { useRouteSync } from '../hooks/useRouteSync.js';
import { resetAppSettingsRouteMemory } from '../lib/route-memory.js';

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

function pressCtrlI() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }));
  });
}

let offShortcuts: () => void = () => {};

beforeEach(() => {
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

describe('Ctrl+I returns from the Inbox to where the user was', () => {
  it('returns to the open thread, not Home', () => {
    mountAt('/threads/thread-1');

    pressCtrlI();
    expect(currentPath).toBe('/inbox');
    expect(useUi.getState().nav).toBe('inbox');

    pressCtrlI();
    expect(currentPath).toBe('/threads/thread-1');
  });

  it('returns to the Settings page it was opened from', () => {
    mountAt('/settings/terminal');

    pressCtrlI();
    expect(currentPath).toBe('/inbox');

    pressCtrlI();
    expect(currentPath).toBe('/settings/terminal');
    expect(useUi.getState().nav).toBe('settings');
    expect(useUi.getState().settingsTab).toBe('terminal');
  });

  it("drilled into a project, opens that project's Inbox and returns to the project view", () => {
    mountAt(`/projects/${PROJECT_ID}/explorer`);
    expect(useUi.getState().focusedProjectId).toBe(PROJECT_ID);

    pressCtrlI();
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/inbox`);

    pressCtrlI();
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/explorer`);
    expect(useUi.getState().nav).toBe('projects');
    expect(useUi.getState().focusedProjectId).toBe(PROJECT_ID);
  });

  it("from a project's Inbox opened on the rail, returns to the project route before it", () => {
    mountAt(`/projects/${PROJECT_ID}/sessions/sess-1`);
    // The rail's Inbox link: a plain navigation to the project Inbox route.
    act(() => useUi.getState().setNav('inbox'));
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/inbox`);

    pressCtrlI();
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/sessions/sess-1`);
  });

  it('skips Inbox-to-Inbox moves and returns to the last non-Inbox route', () => {
    mountAt(`/projects/${PROJECT_ID}/scheduler`);
    pressCtrlI();
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/inbox`);
    // The rail's Back from a project's Inbox leaves for the cross-project Inbox (#717).
    act(() => useUi.getState().exitProjectFocus(`/projects/${PROJECT_ID}/inbox`));
    expect(currentPath).toBe('/inbox');

    pressCtrlI();
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/scheduler`);
  });

  it('falls back to Home when the Inbox is the first view', () => {
    mountAt('/inbox');

    pressCtrlI();
    expect(currentPath).toBe('/');
    expect(useUi.getState().nav).toBe('home');
  });

  it("falls back to Home when the route before the Inbox belongs to a removed project", () => {
    mountAt(`/projects/${PROJECT_ID}/explorer`);
    pressCtrlI();
    expect(currentPath).toBe(`/projects/${PROJECT_ID}/inbox`);
    act(() => useData.setState({ projects: [] }));
    act(() => useUi.setState({ focusedProjectId: null }));
    act(() => useUi.getState().setNav('inbox'));

    pressCtrlI();
    expect(currentPath).toBe('/');
    expect(useUi.getState().nav).toBe('home');
  });

  it('still opens the Inbox from Home', () => {
    mountAt('/');
    pressCtrlI();
    expect(currentPath).toBe('/inbox');
    pressCtrlI();
    expect(currentPath).toBe('/');
  });
});
