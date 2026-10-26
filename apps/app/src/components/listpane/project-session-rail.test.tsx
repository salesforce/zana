// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../../thread-store.js';
import { RAIL_IDLE_THREAD_LIMIT } from '../fleet-item.js';

const project: Project = {
  id: 'proj-1',
  name: 'zana-command-center',
  path: '/tmp/zana-command-center',
  createdAt: 0,
  lastActiveAt: 0
};

const h = vi.hoisted(() => ({
  data: {
    projects: [] as Project[],
    terminals: {} as Record<string, TerminalSession[]>,
    projectNavigationOrganization: 'sessions' as 'sessions' | 'team-runs',
    closeTerminal: vi.fn(),
    restoreTerminal: vi.fn(),
    updateProject: vi.fn()
  },
  ui: {
    unread: {} as Record<string, boolean>,
    selectedTabId: {} as Record<string, string>,
    collapsedSections: {} as Record<string, boolean>,
    toggleSection: vi.fn(),
    setLauncherOpen: vi.fn(),
    setNav: vi.fn(),
    enterProjectFocus: vi.fn(),
    selectTab: vi.fn(),
    setProjectView: vi.fn(),
    projectExpanded: {} as Record<string, boolean>,
    pushToast: vi.fn()
  },
  status: { byId: {} as Record<string, string> },
  triage: { byId: {} as Record<string, unknown> },
  threads: [] as ThreadListItem[],
  open: vi.fn()
}));

vi.mock('../../store.js', () => ({
  useData: Object.assign((selector: (state: typeof h.data) => unknown) => selector(h.data), {
    getState: () => h.data
  }),
  useUi: Object.assign((selector: (state: typeof h.ui) => unknown) => selector(h.ui), {
    getState: () => h.ui
  }),
  useAgentStatus: Object.assign((selector: (state: typeof h.status) => unknown) => selector(h.status), {
    getState: () => h.status
  }),
  useIdleTriage: Object.assign((selector: (state: typeof h.triage) => unknown) => selector(h.triage), {
    getState: () => h.triage
  }),
  useSubagents: (selector: (state: { byId: Record<string, number> }) => unknown) => selector({ byId: {} }),
  sortProjectsForDisplay: (projects: Project[]) => projects,
  sortProjectsAlphabetically: (projects: Project[]) => projects,
  listedTerminals: (list: TerminalSession[] | undefined) => list ?? [],
  projectRailTerminals: (list: TerminalSession[] | undefined) =>
    (list ?? []).filter((session) => session.status !== 'exited' && !session.scheduled)
}));
vi.mock('../../thread-store.js', () => ({
  useThreads: Object.assign(
    (selector: (state: { threads: ThreadListItem[] }) => unknown) => selector({ threads: h.threads }),
    { getState: () => ({ threads: h.threads, remove: vi.fn() }) }
  )
}));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../../hooks/useEnsureThreads.js', () => ({ useEnsureThreads: () => undefined }));
vi.mock('../../lib/product-client.js', () => ({ product: { openers: { openIn: h.open } } }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../../lib/windowScope.js', () => ({ getScopedProjectId: () => null }));
vi.mock('../ListPaneResizer.js', () => ({ ListPaneResizer: () => null }));
vi.mock('./ProjectRollupDot.js', () => ({ ProjectRollupDot: () => null }));
vi.mock('../agentCardActions.js', () => ({
  useAgentCardActions: () => ({
    menu: null,
    setMenu: vi.fn(),
    actions: {},
    rename: null,
    closeRename: vi.fn(),
    submitRename: vi.fn()
  }),
  AgentCardMenu: () => null,
  AgentDeleteQuickAction: ({ session }: { session: { title: string } }) => (
    <button data-testid="agent-delete-quick">{session.title}</button>
  ),
  clampMenuAnchor: (event: { clientX: number; clientY: number }) => ({ x: event.clientX, y: event.clientY })
}));
vi.mock('../threadCardActions.js', () => ({
  useThreadCardActions: () => ({ menu: null, setMenu: vi.fn() }),
  ThreadCardMenu: () => null,
  ThreadArchiveQuickAction: () => <button data-testid="thread-archive-quick" />,
  openThreadMenu: vi.fn()
}));
vi.mock('../PromptModal.js', () => ({ PromptModal: () => null }));
vi.mock('./FocusedProjectMenu.js', () => ({
  FocusedProjectMenu: ({ project, x, y, onClose }: { project: Project; x: number; y: number; onClose: () => void }) => (
    <div data-testid="focused-project-menu" data-project={project.id} data-x={x} data-y={y}>
      <button onClick={onClose}>Close project menu</button>
    </div>
  )
}));
vi.mock('../sidebar/useThreadRowSplitDrag.js', () => ({
  usePaneContentSplitDrag: () => ({ onPointerDown: undefined, openInSplit: vi.fn(), consumeClick: () => false }),
  useThreadRowSplitDrag: () => ({ onPointerDown: undefined, openInSplit: vi.fn(), consumeClick: () => false })
}));
vi.mock('../sidebar/paneContentSplitIndicator.js', () => ({
  usePaneContentSplitIndicator: () => ({ isOpenInSplit: false, miniMap: null })
}));

import { ProjectSessionRail } from './project-session-rail.js';
import { ProjectsList } from './ProjectsList.js';

function thread(over: Partial<ThreadListItem> & Pick<ThreadListItem, 'id' | 'status'>): ThreadListItem {
  return {
    projectId: 'proj-1',
    hostId: 'h1',
    environmentId: null,
    providerId: 'claude-code',
    title: over.title ?? over.id,
    createdAt: 1,
    cwd: null,
    branchName: null,
    isWorktree: false,
    ...over
  };
}

function session(over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'sess-1',
    title: 'CLI session',
    status: 'running',
    profile: 'claude',
    createdAt: Date.now() - 60_000,
    ...over
  } as TerminalSession;
}

function renderRail() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ProjectSessionRail project={project} />
    </MemoryRouter>
  );
}

describe('ProjectSessionRail', () => {
  afterEach(cleanup);
  it('opens project actions on right-click and from the keyboard-accessible overflow button', () => {
    h.data.terminals = {};
    h.threads = [];
    render(<MemoryRouter><ProjectSessionRail project={project} /></MemoryRouter>);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open zana-command-center' }), { clientX: 90, clientY: 130 });
    const menu = screen.getByTestId('focused-project-menu');
    expect(menu.dataset.project).toBe(project.id);
    expect(menu.dataset.x).toBe('90');
    expect(menu.dataset.y).toBe('130');
    fireEvent.click(screen.getByRole('button', { name: 'Close project menu' }));
    expect(screen.queryByTestId('focused-project-menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Project actions for zana-command-center' }));
    expect(screen.getByTestId('focused-project-menu').dataset.project).toBe(project.id);
  });
  it('opens the launcher for this project from the row "+"', () => {
    h.ui.setLauncherOpen.mockClear();
    render(<MemoryRouter><ProjectSessionRail project={project} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'New agent in zana-command-center' }));
    expect(h.ui.setLauncherOpen).toHaveBeenCalledWith(true, project.id);
  });
  it('drops the project row and becomes a flat Sessions list when the titlebar owns the project', () => {
    h.data.terminals = { 'proj-1': [session({ id: 'live-cli', title: 'Running CLI' })] };
    h.threads = [thread({ id: 'live-thread', status: 'active', title: 'Working review' })];
    render(<MemoryRouter><ProjectSessionRail project={project} projectRow={false} /></MemoryRouter>);
    const heading = screen.getByTestId('project-session-rail-heading');
    expect(heading.textContent).toBe('Sessions');
    expect(heading.getAttribute('aria-label')).toBe('Collapse Sessions section');
    expect(screen.getByTestId('project-session-rail').querySelector('.sidebar-projects-header .project-badge')?.textContent).toBe('2');
    expect(screen.queryByRole('button', { name: 'Open zana-command-center' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project actions for zana-command-center' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New agent in zana-command-center' })).toBeNull();
    const list = screen.getByRole('list', { name: 'Sessions in zana-command-center' });
    expect(list.className).toBe('project-terminals project-terminals--flat');
    expect(list.textContent).toContain('Working review');
    expect(list.textContent).toContain('Running CLI');
  });

  it('shows an empty hint instead of a bare heading when a flat Sessions list has nothing in it', () => {
    h.data.terminals = {};
    h.threads = [];
    const markup = renderToStaticMarkup(
      <MemoryRouter><ProjectSessionRail project={project} projectRow={false} /></MemoryRouter>
    );
    expect(markup).toContain('>Sessions<');
    expect(markup).toContain('class="sidebar-projects-empty">No sessions yet<');
    expect(markup).not.toContain('class="project-item"');
    expect(markup).not.toContain('class="project-badge"');
  });

  it('still renders the Project collection when this project has no nestable sessions', () => {
    h.data.terminals = {};
    h.threads = [];
    const markup = renderRail();
    expect(markup).toContain('data-testid="project-session-rail"');
    expect(markup).toContain('data-testid="project-session-rail-heading"');
    expect(markup).toContain('>Project<');
    expect(markup).toContain('zana-command-center');
    expect(markup).not.toContain('aria-label="Remote SSH project"');
    expect(markup).not.toContain('class="project-terminals"');
    expect(markup).not.toContain('aria-label="Organize projects"');
    expect(markup).not.toContain('aria-label="Add project"');
    expect(markup).not.toContain('Sort by');
  });

  it('renders the current project name as a focus button that navigates like the global row', () => {
    h.data.terminals = {};
    h.threads = [];
    const markup = renderRail();
    // The project-scoped row is now an actionable button (was an inert span), so
    // clicking the current project navigates into it — parity with the global list.
    expect(markup).toContain('class="project-select project-meta project-meta--inline"');
    expect(markup).toContain('aria-label="Open zana-command-center"');
    const source = readFileSync(new NodeURL('./project-session-rail.tsx', import.meta.url), 'utf8');
    expect(source).toContain("ui.setNav('projects')");
    expect(source).toContain('ui.enterProjectFocus(project.id)');
  });

  it('shows the remote network mark next to an SSH or host-bound project name', () => {
    h.data.terminals = {};
    h.threads = [];
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ProjectSessionRail project={{ ...project, name: 'limited-pony', remote: { host: 'limited-pony' } }} />
      </MemoryRouter>
    );
    expect(markup).toContain('limited-pony');
    expect(markup).toContain('aria-label="Remote SSH project"');
    expect(markup).toContain('project-remote-icon');
  });

  it('nests live threads, a bounded idle history, and CLI agents under this project', () => {
    h.data.terminals = {
      'proj-1': [
        session({ id: 'live-cli', title: 'Running CLI' }),
        session({ id: 'done-cli', title: 'Exited CLI', status: 'exited' })
      ],
      'proj-2': [session({ id: 'other-cli', title: 'Other project CLI' })]
    };
    h.status.byId = { 'live-cli': 'working' };
    h.threads = [
      thread({ id: 'live-thread', status: 'active', title: 'Working review' }),
      ...Array.from({ length: RAIL_IDLE_THREAD_LIMIT + 1 }, (_, index) =>
        thread({ id: `idle-${index}`, status: 'idle', title: `Idle ${index}` })
      ),
      thread({ id: 'other-thread', projectId: 'proj-2', status: 'active', title: 'Other project thread' })
    ];

    const markup = renderRail();

    expect(markup).toContain('data-testid="project-session-rail"');
    expect(markup).toContain('>Project<');
    expect(markup).toContain('aria-label="Sessions in zana-command-center"');
    expect(markup).toContain('class="project-badge"');
    expect(markup).toContain('>10<');
    expect(markup).toContain('Working review');
    expect(markup).toContain('data-kind="thread"');
    expect(markup).toContain('>Working</span> · Thread');
    expect(markup).toContain('>Idle</span> · Thread');
    expect(markup).toContain('Running CLI');
    expect(markup).toContain('data-kind="agent"');
    expect(markup).toContain('data-testid="agent-delete-quick"');
    expect(markup).toContain('data-testid="thread-archive-quick"');
    expect(markup).not.toContain('Exited CLI');
    expect(markup).not.toContain('Other project CLI');
    expect(markup).not.toContain('Other project thread');
    expect(markup).toContain('Idle 0');
    expect(markup).toContain(`Idle ${RAIL_IDLE_THREAD_LIMIT - 1}`);
    expect(markup).not.toContain(`Idle ${RAIL_IDLE_THREAD_LIMIT}`);
  });

  it('does not nest scheduled jobs under the project tree', () => {
    h.data.terminals = {
      'proj-1': [
        session({ id: 'live-cli', title: 'Running CLI' }),
        session({
          id: 'sched',
          title: 'Scheduled: Inbox watcher',
          scheduled: true
        })
      ]
    };
    h.status.byId = { 'live-cli': 'idle', sched: 'idle' };
    h.threads = [];

    const markup = renderRail();
    expect(markup).toContain('Running CLI');
    expect(markup).not.toContain('Inbox watcher');
    expect(markup).not.toContain('Scheduled:');
    expect(markup).toContain('>1<');
  });

  it('uses the canonical execution title for a Team-run coordinator', () => {
    h.data.terminals = {
      'proj-1': [session({
        title: 'Claude Code',
        cohort: {
          cohortId: 'run-1',
          teamId: 'team-1',
          teamName: 'Review Squad',
          role: 'orchestrator',
          executionId: 'execution-1',
          executionJobTitle: 'Review Workflow Test Plan'
        }
      })]
    };
    h.threads = [];

    const markup = renderRail();
    expect(markup).toContain('Review Workflow Test Plan');
    expect(markup).not.toContain('class="project-terminal-name">Claude Code<');
  });

  it('opens nested rows on the project-scoped session and thread routes', () => {
    const source = readFileSync(new NodeURL('./project-session-rail.tsx', import.meta.url), 'utf8');
    expect(source).toContain('railThreadsForProject');
    expect(source).toContain('projectRailTerminals');
    expect(source).toContain('navigate(getThreadRoutePath(thread.id, project.id))');
    expect(source).toContain('navigate(getAgentSessionRoutePath(session.id, project.id))');
    expect(source).toContain('routeProjectId={project.id}');
    expect(source).toContain('openThreadMenu(e, thread, setThreadMenu)');
    expect(source).toContain('openAgentCardMenu(e, session)');
    expect(source).toContain('data-testid="project-session-rail"');
    expect(source).toContain('<span>{sectionLabel}</span>');
    expect(source).toContain('isRemoteWorkspaceProject(project)');
    expect(source).toContain('className="project-remote-icon"');
    expect(source).toContain('<ProjectDot project={project} unread={hasUnread} />');
    expect(source).toContain('className="sidebar-projects');
    expect(source).not.toContain('ListFilter');
    expect(source).not.toContain('Organize projects');
    expect(source).not.toContain('Add project');
    expect(source).not.toContain('sidebarProjectSort');
  });
});

describe('global project editor actions', () => {
  afterEach(cleanup);
  it('puts editor actions first and opens the chosen project from right-click and overflow', async () => {
    h.data.projects = [project];
    h.data.terminals = {};
    h.threads = [];
    h.open.mockReset().mockResolvedValue({ ok: true });
    render(<MemoryRouter><ProjectsList placement="sidebar" /></MemoryRouter>);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open zana-command-center' }), { clientX: 80, clientY: 100 });
    const actions = document.querySelector('.project-menu')!;
    expect(actions.querySelector('button')?.textContent).toBe('Open in Cursor');
    fireEvent.click(screen.getByRole('button', { name: 'Open in Cursor' }));
    await waitFor(() => expect(h.open).toHaveBeenCalledWith('cursor', project.path));
    expect(document.querySelector('.project-menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Project actions for zana-command-center' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in VS Code' }));
    await waitFor(() => expect(h.open).toHaveBeenCalledWith('code', project.path));
    expect(document.querySelector('.project-menu')).toBeNull();
  });
});
