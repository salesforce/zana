// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { PluginProjectMenuActionRegistration } from '@zana-ai/zcc-plugin-sdk';

const h = vi.hoisted(() => ({
  projects: [
    { id: 'p1', name: 'First', path: '/tmp/first', createdAt: 1, lastActiveAt: 1 },
    { id: 'p2', name: 'Second', path: '/tmp/second', createdAt: 2, lastActiveAt: 2 }
  ] as Project[],
  actions: [] as PluginProjectMenuActionRegistration[],
  createActions: [],
  run: vi.fn()
}));

vi.mock('../../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({ projects: h.projects, terminals: {}, projectNavigationOrganization: 'sessions' }),
  useUi: (select: (state: unknown) => unknown) => select({
    selectedProjectId: null, focusedProjectId: null, selectedTabId: {}, unread: {}, projectExpanded: {},
    hideIdleProjects: false, collapsedSections: {}
  }),
  sortProjectsForDisplay: (projects: Project[]) => projects,
  sortProjectsAlphabetically: (projects: Project[]) => projects,
  listedTerminals: () => [],
  projectRailTerminals: () => []
}));
vi.mock('../../thread-store.js', () => ({ useThreads: (select: (state: unknown) => unknown) => select({ threads: [] }) }));
vi.mock('../../hooks/useEnsureThreads.js', () => ({ useEnsureThreads: () => undefined }));
vi.mock('../../lib/windowScope.js', () => ({ getScopedProjectId: () => null }));
vi.mock('../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: () => () => undefined,
  listProjectMenuActions: () => h.actions,
  listCreateProjectActions: () => h.createActions
}));
vi.mock('../agentCardActions.js', () => ({
  useAgentCardActions: () => ({ menu: null, setMenu: vi.fn(), actions: {}, rename: null, closeRename: vi.fn(), submitRename: vi.fn() }),
  AgentCardMenu: () => null
}));
vi.mock('../threadCardActions.js', () => ({ useThreadCardActions: () => ({ menu: null, setMenu: vi.fn() }), ThreadCardMenu: () => null }));
vi.mock('../ListPaneResizer.js', () => ({ ListPaneResizer: () => null }));
vi.mock('./ProjectRollupDot.js', () => ({ ProjectRollupDot: () => null }));
vi.mock('./ProjectOpenActions.js', () => ({ ProjectOpenActions: () => null }));
vi.mock('./ProjectIconPicker.js', () => ({ ProjectIconPicker: () => null }));
vi.mock('../sidebar/useThreadRowSplitDrag.js', () => ({
  usePaneContentSplitDrag: () => ({ onPointerDown: undefined, consumeClick: () => false, openInSplit: vi.fn() })
}));
vi.mock('../sidebar/paneContentSplitIndicator.js', () => ({ usePaneContentSplitIndicator: () => ({ miniMap: null }) }));

import { ProjectsList } from './ProjectsList.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function action(overrides: Partial<PluginProjectMenuActionRegistration> = {}): PluginProjectMenuActionRegistration {
  return {
    pluginId: 'example', id: 'open', generation: 1, placement: 'project', title: 'Open project',
    run: h.run, ...overrides
  } as PluginProjectMenuActionRegistration;
}

function openMenu(projectName: string) {
  fireEvent.click(screen.getByRole('button', { name: `Project actions for ${projectName}` }));
}

function renderList() {
  render(<MemoryRouter><ProjectsList placement="sidebar" /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  h.actions = [];
  vi.clearAllMocks();
});

describe('project plugin action titles', () => {
  it('keeps async action disabled until resolved, truncates title, then runs on selected project', async () => {
    const pending = deferred<string>();
    const titleForProject = vi.fn(() => pending.promise);
    h.actions = [action({ titleForProject })];
    renderList();
    openMenu('First');
    const checking = screen.getByRole('button', { name: 'Checking…' });
    expect(checking.hasAttribute('disabled')).toBe(true);
    fireEvent.click(checking);
    expect(h.run).not.toHaveBeenCalled();
    await waitFor(() => expect(titleForProject).toHaveBeenCalledWith('p1'));

    pending.resolve(`  ${'X'.repeat(110)}  `);
    const resolved = await screen.findByRole('button', { name: 'X'.repeat(100) });
    expect(resolved.hasAttribute('disabled')).toBe(false);
    fireEvent.click(resolved);
    expect(h.run).toHaveBeenCalledOnce();
    expect(document.querySelector('.project-menu')).toBeNull();
  });

  it('uses static title after empty resolution or rejection, while static actions work immediately', async () => {
    const pending = deferred<string>();
    h.actions = [action({ titleForProject: () => pending.promise }), action({ id: 'static', title: 'Static action' })];
    renderList();
    openMenu('First');
    const staticAction = screen.getByRole('button', { name: 'Static action' });
    expect(staticAction.hasAttribute('disabled')).toBe(false);
    pending.resolve('   ');
    expect((await screen.findByRole('button', { name: 'Open project' })).hasAttribute('disabled')).toBe(false);

    fireEvent.keyDown(window, { key: 'Escape' });
    h.actions = [action({ titleForProject: () => Promise.reject(new Error('offline')) })];
    // Reopen with new action snapshot after a fresh mount.
    cleanup();
    renderList();
    openMenu('Second');
    expect((await screen.findByRole('button', { name: 'Open project' })).hasAttribute('disabled')).toBe(false);
  });

  it('ignores an old project response after switching menus', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const titleForProject = vi.fn((id: string) => id === 'p1' ? first.promise : second.promise);
    h.actions = [action({ titleForProject })];
    renderList();
    openMenu('First');
    await waitFor(() => expect(titleForProject).toHaveBeenCalledWith('p1'));
    openMenu('Second');
    await waitFor(() => expect(titleForProject).toHaveBeenCalledWith('p2'));
    await act(async () => { first.resolve('Wrong project title'); });
    expect(screen.queryByText('Wrong project title')).toBeNull();
    expect(screen.getByRole('button', { name: 'Checking…' }).hasAttribute('disabled')).toBe(true);
    second.resolve('Second project title');
    expect((await screen.findByRole('button', { name: 'Second project title' })).hasAttribute('disabled')).toBe(false);
  });
});
