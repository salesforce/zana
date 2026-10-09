// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  setSettingsAnchor: vi.fn(),
  navigate: vi.fn(), close: vi.fn(), selectTab: vi.fn(), projectView: vi.fn(), setNav: vi.fn(), exitProjectFocus: vi.fn(),
  createTerminal: vi.fn(async () => null), focusedProjectId: null as string | null,
  project: { id: 'p1', name: 'Design system', path: '/design', tag: 'design', favorite: false },
  favoriteIds: {} as Record<string, true>,
  selectedProjectId: 'p1' as string | null,
  threads: [{ id: 't1', projectId: 'p1', title: 'Review component spacing', providerId: 'codex', createdAt: 1 }],
  commands: [{ id: 'review', invocation: '/review', description: 'Review changes' }],
  files: [{ path: '/design/notes.md', rel: 'notes.md' }],
  actions: []
}));
vi.mock('../../../lib/product-client.js', () => ({ product: {
  commands: { list: async () => h.commands }, fs: { walkFiles: async () => h.files },
  ssh: { listHosts: async () => [] },
  config: { get: async () => ({}), onChanged: () => () => {} },
  hosts: { list: async () => [] },
  projectSettings: { get: async () => ({}), onChanged: () => () => {} }
} }));
vi.mock('../../../store.js', () => ({
  // Same shape as the zustand store: Settings search runtime providers read and subscribe to it.
  useData: Object.assign((selector: (state: unknown) => unknown) => selector({
    projects: [h.project], terminals: {}, createTerminal: h.createTerminal
  }), { getState: () => ({ projects: [h.project], harnessStatus: [] }), subscribe: () => () => {} }),
  useUi: Object.assign((selector: (state: unknown) => unknown) => selector({
    selectedProjectId: h.selectedProjectId, selectedTabId: {}, projectView: {}, recentFiles: {},
    selectTab: h.selectTab, setProjectView: h.projectView, setNav: h.setNav, nav: 'inbox',
    setSettingsAnchor: h.setSettingsAnchor
  }), { getState: () => ({ enterProjectFocus: vi.fn(), exitProjectFocus: h.exitProjectFocus }) }),
  useScheduler: (selector: (state: unknown) => unknown) => selector({ tasks: [] }),
  usePersonas: (selector: (state: unknown) => unknown) => selector({ personas: [] }),
  useFavoriteAgents: (selector: (state: unknown) => unknown) => selector({ favoriteIds: h.favoriteIds }),
  favoriteKey: (session: { id: string; claudeSessionId?: string }) => session.claudeSessionId ?? session.id,
  isThreadFavoriteKey: (key: string) => key.startsWith('thread:'),
  visibleTerminals: (list: unknown[]) => list ?? []
}));
vi.mock('../../../thread-store.js', () => ({ useThreads: (selector: (state: unknown) => unknown) => selector({ threads: h.threads }) }));
vi.mock('../../../hooks/useEnsureThreads.js', () => ({ useEnsureThreads: () => {} }));
vi.mock('../../../hooks/useRouteState.js', () => ({ useRouteState: () => ({ threadId: null, focusedProjectId: h.focusedProjectId }) }));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => h.navigate }));
vi.mock('../../../modules/index.js', () => ({ useMergedModules: () => [] }));
vi.mock('../../../modules/ModulePanelHost.js', () => ({ getHost: vi.fn() }));
vi.mock('../../../plugins/plugin-slots.js', () => ({ listCommandPaletteActions: () => h.actions, subscribePluginSlots: () => () => {} }));

import { CommandPalette } from '../../CommandPalette.js';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.focusedProjectId = null;
  h.selectedProjectId = 'p1';
  h.project.favorite = false;
  h.favoriteIds = {};
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('command palette integration', () => {
  it('uses existing stars in Favorites and updates the results when follows change', () => {
    h.project.favorite = true;
    h.favoriteIds = { 'thread:t1': true };
    const view = render(<CommandPalette onClose={h.close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Favorites', exact: true }));
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(view.container.querySelectorAll('.command-palette-favorite')).toHaveLength(2);
    h.favoriteIds = {};
    view.rerender(<CommandPalette onClose={h.close} />);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option').textContent).toContain('Design system');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'missing' } });
    expect(screen.getByText('No favorites match your search')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All', exact: true }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'component' } });
    expect(screen.getByRole('option').textContent).toContain('Review component spacing');
  });

  it('explains how to populate an empty Favorites filter', () => {
    render(<CommandPalette onClose={h.close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Favorites', exact: true }));
    expect(screen.getByText('No favorites yet')).toBeTruthy();
    expect(screen.getByText('Star a project or follow a thread or CLI agent to find it here.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('0 results');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('filters real items by type, opens a thread, and records its destination', async () => {
    render(<CommandPalette onClose={h.close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Threads', exact: true }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'component' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option').textContent).toContain('Review component spacing');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith('/threads/t1');
    expect(localStorage.getItem('zcc.paletteRecents')).toContain('thread:t1');
  });

  it('opens a destination in its own project when navigating from project focus', () => {
    h.focusedProjectId = 'another-project';
    render(<CommandPalette onClose={h.close} />);
    fireEvent.click(screen.getByRole('option', { name: /Review component spacing/ }));
    expect(h.navigate).toHaveBeenCalledWith('/projects/p1/threads/t1');
  });

  it('restores recently used items once, wraps arrow navigation, and resets selection when filtering', () => {
    localStorage.setItem('zcc.paletteRecents', JSON.stringify({ 'thread:t1': { count: 1, lastUsedAt: Date.now() } }));
    render(<CommandPalette onClose={h.close} />);
    expect(screen.getByText('Recently used')).toBeTruthy();
    expect(screen.getAllByRole('option', { name: /Review component spacing/ })).toHaveLength(1);
    const input = screen.getByRole('combobox');
    const options = screen.getAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(options.at(-1)?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'End' });
    expect(options.at(-1)?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Projects', exact: true }));
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Design system');
  });

  it('does not execute anything from empty results and explains how to broaden the search', () => {
    render(<CommandPalette onClose={h.close} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzzzzzz' } });
    expect(screen.getByText('Try a thread title, project name, or command.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Threads', exact: true }));
    expect(screen.getByText('Try another search or choose All to search every category.')).toBeTruthy();
    for (const key of ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) fireEvent.keyDown(input, { key });
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(h.close).not.toHaveBeenCalled();
  });

  it('preserves file mode and its existing open action', async () => {
    render(<CommandPalette onClose={h.close} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '@notes' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'notes.md' })).toBeTruthy());
    expect(screen.getByText('Files in Design system')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Search categories' })).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('option'));
    expect(screen.getByRole('option').getAttribute('aria-selected')).toBe('true');
  });

  it('preserves slash-command selection and launch-target completion without launching a session', async () => {
    render(<CommandPalette onClose={h.close} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '/review' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /\/review/ })).toBeTruthy());
    fireEvent.change(input, { target: { value: '#des' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /Design system/ })).toBeTruthy());
    fireEvent.keyDown(input, { key: 'Tab' });
    expect((input as HTMLInputElement).value).toBe('#design ');
    expect(screen.getByRole('option').textContent).toContain('Launch in Design system');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.createTerminal).not.toHaveBeenCalled();
  });

  it('narrows Commands and executes the existing Settings navigation', () => {
    h.selectedProjectId = null;
    render(<CommandPalette onClose={h.close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Commands', exact: true }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Open Settings' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.exitProjectFocus).toHaveBeenCalledWith('/settings');
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('appends a capped Settings section for a typed query and keeps recents keyed by entry id', async () => {
    render(<CommandPalette onClose={h.close} />);
    const input = screen.getByRole('combobox');
    expect(screen.queryByText('Settings', { selector: '.palette-section span' })).toBeNull();
    fireEvent.change(input, { target: { value: 'heartbeat' } });
    await waitFor(() => expect(document.querySelector('.palette-section')).toBeTruthy());
    expect(document.querySelector('.palette-section span')?.textContent).toBe('Settings');
    const options = screen.getAllByRole('option');
    expect(options.length).toBeLessThanOrEqual(5);
    const first = options[0];
    fireEvent.click(first);
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/settings\/agents#/));
    expect(localStorage.getItem('zcc.paletteRecents')).toContain('settings:agents.');
  });

  it('switches to the Settings scope from the overflow link and lists more results', async () => {
    render(<CommandPalette onClose={h.close} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'agent' } });
    const more = await screen.findByRole('button', { name: /more in Settings/ });
    const capped = screen.getAllByRole('option').length;
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Settings', exact: true }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(capped);
  });

  it('shows no Settings rows for an empty query, even in the Settings scope', () => {
    render(<CommandPalette onClose={h.close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No results found')).toBeTruthy();
  });
});

