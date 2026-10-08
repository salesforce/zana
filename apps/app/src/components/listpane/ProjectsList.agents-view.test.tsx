// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../../thread-store.js';

const h = vi.hoisted(() => ({
  projects: [] as Project[],
  terminals: {} as Record<string, TerminalSession[]>,
  threads: [] as ThreadListItem[],
  hideIdleProjects: false,
  noActions: [] as never[]
}));

vi.mock('../../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({
    projects: h.projects, terminals: h.terminals, projectNavigationOrganization: 'sessions', loadProjects: vi.fn()
  }),
  useUi: (select: (state: unknown) => unknown) => select({
    selectedProjectId: null, focusedProjectId: null, selectedTabId: {}, unread: {}, projectExpanded: {},
    hideIdleProjects: h.hideIdleProjects, collapsedSections: {}
  }),
  useAgentStatus: (select: (state: unknown) => unknown) => select({ byId: {} }),
  useSubagents: (select: (state: unknown) => unknown) => select({ byId: {} }),
  sortProjectsForDisplay: (projects: Project[]) => projects,
  sortProjectsAlphabetically: (projects: Project[]) => projects,
  listedTerminals: (list: TerminalSession[] = []) => list,
  projectRailTerminals: (list: TerminalSession[] = []) => list
}));
vi.mock('../../thread-store.js', () => ({ useThreads: (select: (state: unknown) => unknown) => select({ threads: h.threads }) }));
vi.mock('../../hooks/useEnsureThreads.js', () => ({ useEnsureThreads: () => undefined }));
vi.mock('../../lib/windowScope.js', () => ({ getScopedProjectId: () => null }));
vi.mock('../../plugins/plugin-slots.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  subscribePluginSlots: () => () => undefined,
  listProjectMenuActions: () => h.noActions,
  listCreateProjectActions: () => h.noActions
}));
vi.mock('../agentCardActions.js', () => ({
  useAgentCardActions: () => ({ menu: null, setMenu: vi.fn(), actions: {}, rename: null, closeRename: vi.fn(), submitRename: vi.fn() }),
  AgentCardMenu: () => null,
  AgentDeleteQuickAction: () => null
}));
vi.mock('../threadCardActions.js', () => ({
  useThreadCardActions: () => ({ menu: null, setMenu: vi.fn() }),
  ThreadCardMenu: () => null,
  ThreadArchiveQuickAction: () => null,
  openThreadMenu: vi.fn()
}));
vi.mock('../ListPaneResizer.js', () => ({ ListPaneResizer: () => null }));
vi.mock('./ProjectRollupDot.js', () => ({ ProjectRollupDot: () => null }));
vi.mock('./ProjectOpenActions.js', () => ({ ProjectOpenActions: () => null }));
vi.mock('./ProjectIconPicker.js', () => ({ ProjectIconPicker: () => null }));
vi.mock('../sidebar/useThreadRowSplitDrag.js', () => ({
  usePaneContentSplitDrag: () => ({ onPointerDown: undefined, consumeClick: () => false, openInSplit: vi.fn() }),
  useThreadRowSplitDrag: () => ({ onPointerDown: undefined, consumeClick: () => false, openInSplit: vi.fn() })
}));
vi.mock('../sidebar/paneContentSplitIndicator.js', () => ({ usePaneContentSplitIndicator: () => ({ miniMap: null }) }));

import { ProjectsList } from './ProjectsList.js';

function project(id: string, name: string): Project {
  return { id, name, path: `/tmp/${id}`, createdAt: 1, lastActiveAt: 1 } as Project;
}

function thread(id: string, projectId: string, title: string, at: number): ThreadListItem {
  return {
    id, projectId, title, hostId: 'h', environmentId: null, providerId: 'claude-code', status: 'idle',
    createdAt: at, updatedAt: at, cwd: null, branchName: null, isWorktree: false
  };
}

function session(id: string, title: string, at: number): TerminalSession {
  return { id, title, status: 'running', profile: 'claude', createdAt: at } as TerminalSession;
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderList() {
  render(<MemoryRouter><ProjectsList placement="sidebar" /><LocationProbe /></MemoryRouter>);
}

function chooseView(label: 'Projects' | 'Agents only') {
  fireEvent.click(screen.getByRole('button', { name: 'Organize projects' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
}

beforeEach(() => {
  localStorage.clear();
  h.hideIdleProjects = false;
  h.projects = [project('p1', 'local-core'), project('p2', 'zana-builder'), project('p3', 'empty-one')];
  h.threads = [
    thread('t1', 'p1', 'Check my ticket', 1_000),
    thread('t2', 'p2', 'Next steps', 3_000)
  ];
  h.terminals = { p2: [session('s1', 'CLI run', 2_000)] };
});

afterEach(() => cleanup());

describe('ProjectsList agents-only view', () => {
  it('defaults to the project tree', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'Open local-core' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Agents' })).toBeNull();
    expect(screen.getByPlaceholderText('Filter projects')).toBeTruthy();
  });

  it('hides project rows and lists every session newest-first, tagged with its project', () => {
    renderList();
    chooseView('Agents only');
    expect(localStorage.getItem('zcc.sidebarProjectView')).toBe('agents');
    expect(screen.queryByRole('button', { name: 'Open local-core' })).toBeNull();
    const list = screen.getByRole('list', { name: 'Agents' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.project-terminal-name')?.textContent)).toEqual([
      'Next steps', 'CLI run', 'Check my ticket'
    ]);
    expect(rows.map((row) => row.querySelector('.project-terminal-project')?.textContent)).toEqual([
      'zana-builder', 'zana-builder', 'local-core'
    ]);
    expect(rows[0].querySelector('.project-terminal-detail')?.textContent).toBe('Idle · Thread · zana-builder');
    expect(screen.getByRole('button', { name: 'Organize projects' }).className).toContain('on');
  });

  it('restores the persisted view and filters by session title or project name', () => {
    localStorage.setItem('zcc.sidebarProjectView', 'agents');
    renderList();
    const input = screen.getByPlaceholderText('Filter agents');
    fireEvent.change(input, { target: { value: 'local' } });
    expect(within(screen.getByRole('list', { name: 'Agents' })).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'cli' } });
    const rows = within(screen.getByRole('list', { name: 'Agents' })).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.project-terminal-name')?.textContent)).toEqual(['CLI run']);
    fireEvent.change(input, { target: { value: 'nothing' } });
    expect(screen.getByRole('status').textContent).toContain('No agents match');
  });

  it('opens thread and CLI agent rows on their routes', () => {
    localStorage.setItem('zcc.sidebarProjectView', 'agents');
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Check my ticket' }));
    expect(screen.getByTestId('location').textContent).toBe('/threads/t1');
    fireEvent.click(screen.getByRole('button', { name: 'CLI run' }));
    expect(screen.getByTestId('location').textContent).toBe('/sessions/s1');
  });

  it('offers a way back to projects when there are no agents', () => {
    h.threads = [];
    h.terminals = {};
    localStorage.setItem('zcc.sidebarProjectView', 'agents');
    renderList();
    expect(screen.getByRole('status').textContent).toContain('No agents yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Show projects' }));
    expect(localStorage.getItem('zcc.sidebarProjectView')).toBe('projects');
    expect(screen.getByRole('button', { name: 'Open local-core' })).toBeTruthy();
  });

  it('switches back to the tree from the organize menu', () => {
    localStorage.setItem('zcc.sidebarProjectView', 'agents');
    renderList();
    chooseView('Projects');
    expect(screen.queryByRole('list', { name: 'Agents' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open zana-builder' })).toBeTruthy();
  });
});
