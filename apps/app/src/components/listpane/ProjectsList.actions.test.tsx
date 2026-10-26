// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { PluginProjectMenuActionRegistration } from '@zana-ai/zcc-plugin-sdk';

const h = vi.hoisted(() => ({
  hosts: [] as import('@zana-ai/zcc-domain/thread-runtime').Host[],
  projects: [
    { id: 'p1', name: 'First', path: '/tmp/first', createdAt: 1, lastActiveAt: 1 },
    { id: 'p2', name: 'Second', path: '/tmp/second', createdAt: 2, lastActiveAt: 2 }
  ] as Project[],
  actions: [] as PluginProjectMenuActionRegistration[],
  createActions: [],
  run: vi.fn(),
  loadProjects: vi.fn(async () => undefined),
  reorderProjects: vi.fn(),
  updateProject: vi.fn(),
  selectProject: vi.fn(),
  setLauncherOpen: vi.fn()
}));

vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => h.hosts }));
vi.mock('../../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({
    projects: h.projects, terminals: {}, projectNavigationOrganization: 'sessions', loadProjects: h.loadProjects,
    reorderProjects: h.reorderProjects, updateProject: h.updateProject
  }),
  useUi: (select: (state: unknown) => unknown) => select({
    selectedProjectId: null, focusedProjectId: null, selectedTabId: {}, unread: {}, projectExpanded: {},
    hideIdleProjects: false, collapsedSections: {},
    selectProject: h.selectProject, setLauncherOpen: h.setLauncherOpen
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

function renderList(placement: 'sidebar' | 'pane' = 'sidebar') {
  render(<MemoryRouter><ProjectsList placement={placement} /></MemoryRouter>);
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

afterEach(() => {
  cleanup();
  h.hosts = [];
  h.actions = [];
  vi.clearAllMocks();
});

describe('project row new agent', () => {
  it('opens the launcher for the clicked project', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'New agent in Second' }));
    expect(h.selectProject).toHaveBeenCalledWith('p2');
    expect(h.setLauncherOpen).toHaveBeenCalledWith(true, 'p2');
  });
});

describe('project plugin action titles', () => {
  it.each(['sidebar', 'pane'] as const)('closes the project menu and prevents duplicate reloads in the %s until refresh finishes', async placement => {
    const pending = deferred<void>();
    h.loadProjects.mockReturnValueOnce(pending.promise);
    renderList(placement);
    openMenu('First');
    expect(document.querySelector('.project-menu')).not.toBeNull();
    const reload = screen.getByRole('button', { name: 'Reload project list' });
    fireEvent.click(reload);
    expect(document.querySelector('.project-menu')).toBeNull();
    expect(reload.hasAttribute('disabled')).toBe(true);
    expect(reload.querySelector('.spin')).not.toBeNull();
    fireEvent.click(reload);
    expect(h.loadProjects).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(); });
    expect(reload.hasAttribute('disabled')).toBe(false);
    expect(reload.querySelector('.spin')).toBeNull();
    fireEvent.click(reload);
    await waitFor(() => expect(h.loadProjects).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(reload.hasAttribute('disabled')).toBe(false));
  });

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

describe('machine project context menu', () => {
  function openMachineProjectMenu(projectName: string, keyboard = false) {
    const row = screen.getByRole('button', { name: `Open ${projectName}` }).closest('.project-item');
    if (!row) throw new Error(`Missing project row for ${projectName}`);
    const eventOptions = keyboard
      ? { button: -1, clientX: 0, clientY: 0 }
      : { button: 2, clientX: 40, clientY: 50 };
    fireEvent.contextMenu(row, eventOptions);
  }

  function setupMachineRows(placement: 'sidebar' | 'pane' = 'sidebar') {
    h.hosts = [{ id: 'remote', name: 'Devbox', status: 'connected' }] as typeof h.hosts;
    h.projects = [
      { id: 'p1', name: 'First', path: '/tmp/first', createdAt: 1, lastActiveAt: 1, hostId: 'remote' },
      { id: 'p2', name: 'Second', path: '/tmp/second', createdAt: 2, lastActiveAt: 2, hostId: 'remote' }
    ] as Project[];
    renderList(placement);
  }

  it('opens at pointer location and runs machine project menu item', () => {
    setupMachineRows();
    openMachineProjectMenu('First');

    const menu = document.querySelector('.project-menu');
    expect(menu).not.toBeNull();
    expect((menu as HTMLElement).style.left).toBe('40px');
    expect((menu as HTMLElement).style.top).toBe('50px');
    const moveDown = screen.getByRole('button', { name: 'Move down' });
    expect(moveDown.hasAttribute('disabled')).toBe(false);

    fireEvent.click(moveDown);
    expect(h.reorderProjects).toHaveBeenCalledWith(['p2', 'p1']);
    expect(document.querySelector('.project-menu')).toBeNull();
  });

  it('opens when browser emits keyboard contextmenu event at focused row', () => {
    setupMachineRows();
    openMachineProjectMenu('Second', true);

    expect(document.querySelector('.project-menu')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
  });

  it('dismisses on Escape', () => {
    setupMachineRows();
    openMachineProjectMenu('First');
    expect(document.querySelector('.project-menu')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(document.querySelector('.project-menu')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.project-menu')).toBeNull();
  });

  it('shows the empty projects state', () => {
    h.projects = [];
    renderList();

    expect(document.querySelector('.list-empty')?.textContent).toContain('No projects yet.');
  });

  it('shows no-match state when sidebar filter removes every machine group', () => {
    h.hosts = [{ id: 'remote', name: 'Devbox', status: 'connected' }] as typeof h.hosts;
    h.projects = [
      { id: 'p1', name: 'First', path: '/tmp/first', createdAt: 1, lastActiveAt: 1, hostId: 'remote' }
    ] as Project[];
    renderList();
    fireEvent.change(screen.getByPlaceholderText('Filter machines or projects'), { target: { value: 'missing' } });

    expect(screen.getByRole('status').textContent).toContain('No machines or projects match');
  });

  it('keeps ordinary project menu fallback in pane placement', () => {
    h.hosts = [];
    h.projects = [
      { id: 'p1', name: 'First', path: '/tmp/first', createdAt: 1, lastActiveAt: 1 },
      { id: 'p2', name: 'Second', path: '/tmp/second', createdAt: 2, lastActiveAt: 2 }
    ] as Project[];
    renderList('pane');
    openMachineProjectMenu('First');

    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move down' }).hasAttribute('disabled')).toBe(false);
  });

  it('routes projected Default Project row and New agent to its machine without opening row menu', () => {
    h.hosts = [{ id: 'remote', name: 'Devbox', status: 'connected' }] as typeof h.hosts;
    h.projects = [
      { id: 'default', name: 'Default Project', path: '/tmp/default', quickAgent: true, createdAt: 1, lastActiveAt: 1 }
    ] as Project[];
    render(<MemoryRouter><ProjectsList placement="sidebar" /><LocationProbe /></MemoryRouter>);

    const remoteGroup = document.querySelector('[data-machine-id="remote"]');
    expect(remoteGroup).not.toBeNull();
    const openDefault = within(remoteGroup as HTMLElement).getByRole('button', { name: 'Open Default Project' });
    const row = openDefault.closest('.project-item');
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!, { button: 2, clientX: 40, clientY: 50 });
    expect(document.querySelector('.project-menu')).toBeNull();

    fireEvent.click(openDefault);
    expect(screen.getByTestId('location').textContent).toBe('/threads/new?locationProject=default&host=remote');
    fireEvent.click(within(remoteGroup as HTMLElement).getByRole('button', { name: 'New agent in Default Project' }));
    expect(screen.getByTestId('location').textContent).toBe('/threads/new?locationProject=default&host=remote');
    expect(h.setLauncherOpen).not.toHaveBeenCalled();
  });
});
