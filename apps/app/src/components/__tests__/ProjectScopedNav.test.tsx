import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { Project } from '@zana-ai/zcc-domain/product';

const project: Project = {
  id: 'proj-1',
  name: 'zana-command-center',
  path: '/tmp/zana-command-center',
  createdAt: 0,
  lastActiveAt: 0
};

const h = vi.hoisted(() => {
  const state = {
    nav: 'projects',
    setNav: vi.fn(),
    sidebarCollapsed: false,
    workspaceMode: {} as Record<string, string>,
    setWorkspaceMode: vi.fn(),
    collapsedSections: {},
    toggleSection: vi.fn(),
    setLauncherOpen: vi.fn()
  };
  const data = {
    goalsEnabled: false,
    followUpsEnabled: false,
    suggestionsEnabled: false
  };
  return {
    state,
    data,
    modules: [] as AppModule[],
    unreadInbox: 15,
    agentCounts: { active: 0, blocked: 0 },
    scheduleCount: 6
  };
});

vi.mock('../../store', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  }),
  useData: (selector: (state: typeof h.data) => unknown) => selector(h.data),
  useUnreadInboxCount: () => h.unreadInbox,
  useAgentNavCounts: () => h.agentCounts,
  useProjectActiveGoalCount: () => 0,
  useProjectOpenFollowUpCount: () => 0,
  useProjectScheduleCount: () => h.scheduleCount,
  useProjectRunningTerminalCount: () => 0,
  applySidebarWidth: vi.fn(),
  SIDEBAR_MIN: 256,
  SIDEBAR_MAX: 480
}));
vi.mock('../../modules', () => ({
  useProjectTabModules: () => h.modules
}));
vi.mock('../../plugins/plugin-slots', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listSidebarFooterActions: () => [],
  listProjectTabs: () => []
}));
vi.mock('../../lib/resolveIcon', () => ({
  resolveIcon: () => () => null
}));
vi.mock('../../lib/libraryPlugin', () => ({
  resolveProjectTabModule: () => undefined
}));

import { ProjectScopedNav } from '../ProjectScopedNav.js';

function renderNav(node: ReactElement) {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe('ProjectScopedNav matches the global sidebar chrome', () => {
  it('uses titlebar history controls, a flat destination list, and the utility dock', () => {
    const markup = renderNav(
      <ProjectScopedNav project={project} variant="focus" onBack={() => undefined} />
    );

    expect(markup).toContain('class="sidebar sidebar--titlebar-controls project-scoped-nav project-focused-nav"');
    expect(markup).toContain('data-testid="sidebar-navigation"');
    expect(markup).not.toContain('class="sidebar-chrome"');
    expect(markup).toContain('aria-label="Back to all projects"');
    expect(markup).toContain('class="settings-app-back"');
    expect(markup).toContain('>Back</button>');
    expect(markup).toContain('class="sidebar-utility-bar"');
    expect(markup).toContain('class="sidebar-resizer"');
    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('aria-label="Report a bug"');
    expect(markup).toContain('aria-label="Open this project in a new window"');
    expect(markup).not.toContain('>Settings<');
    expect(markup).not.toContain('>Open in new window<');
    expect(markup).not.toContain('Project workspace');
    expect(markup).not.toContain('nav-section-label');
    expect(markup).not.toContain('brand-avatar');
    expect(markup).not.toContain('>Project<');
    expect(markup).not.toContain('>Workspace<');
    expect(markup).not.toContain('>System<');
    expect(markup).toContain('data-testid="project-nav-inbox"');
    expect(markup).toContain('href="/inbox"');
    expect(markup).toContain('href="/projects/proj-1"');
    expect(markup).toContain('href="/projects/proj-1/terminals"');
    expect(markup).toContain('href="/projects/proj-1/scheduler"');
    expect(markup).toContain('data-testid="project-nav-agents"');
    expect(markup).not.toContain('data-sortable-nav-id="inbox"');
    expect(markup).toContain('data-sortable-nav-id="agents"');
    expect(markup).toContain('data-sortable-nav-id="feed"');
    expect(markup).toContain('data-sortable-nav-id="terminals"');
    expect(markup).toContain('data-sortable-nav-id="scheduler"');
    expect(markup).toContain('aria-roledescription="sortable"');
    expect(markup).not.toContain('data-sortable-sidebar-section-id="sidebar-section:agents"');
    expect(markup).toContain('class="sidebar-nav sidebar-nav--sortable"');
    expect(markup).toContain('data-testid="project-nav-terminals"');
    expect(markup).toContain('data-testid="project-nav-scheduler"');
    expect(markup).toContain('>Inbox<');
    expect(markup).not.toContain('class="sidebar-agents "');
    expect(markup).not.toContain('data-testid="sidebar-agents-heading"');
    expect(markup).not.toContain('data-testid="sidebar-agents-toggle"');
    expect(markup).not.toContain('aria-label="Collapse Agents section"');
    expect(markup).not.toContain('aria-label="Open Agents dashboard"');
    expect(markup).not.toContain('data-agent-tray-project="proj-1"');
    expect(markup).not.toContain('data-agent-tray-placement="inline"');
    expect(markup).toContain('>Agents<');
    expect(markup).toContain('>Scheduler<');
    expect(markup.indexOf('data-testid="project-nav-inbox"')).toBeLessThan(
      markup.indexOf('data-testid="project-nav-agents"')
    );
    expect(markup.indexOf('data-testid="project-nav-agents"')).toBeLessThan(
      markup.indexOf('data-testid="project-nav-feed"')
    );
  });

  it('badges this project Agents row from the scoped fleet count', () => {
    h.agentCounts = { active: 3, blocked: 0 };
    const markup = renderNav(
      <ProjectScopedNav project={project} variant="focus" onBack={() => undefined} />
    );
    const agentsStart = markup.indexOf('data-testid="project-nav-agents"');
    const agentsChunk = markup.slice(agentsStart, markup.indexOf('</a>', agentsStart));

    expect(agentsChunk).toContain('href="/projects/proj-1"');
    expect(agentsChunk).toContain('class="nav-badge nav-badge--running"');
    expect(agentsChunk).toContain('aria-label="3 active"');
    expect(agentsChunk).toContain('>3<');
    h.agentCounts = { active: 0, blocked: 0 };
  });

  it('omits the pop-out control in a dedicated project window', () => {
    const markup = renderNav(
      <ProjectScopedNav project={project} variant="window" />
    );

    expect(markup).toContain('sidebar--titlebar-controls');
    expect(markup).not.toContain('project-focused-nav');
    expect(markup).not.toContain('aria-label="Open this project in a new window"');
    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('aria-label="Report a bug"');
    expect(markup).not.toContain('aria-label="Go back"');
    expect(markup).not.toContain('class="settings-app-back"');
    expect(markup).not.toContain('>Back</button>');
  });

  it('renders extension project tabs as ordinary destination rows', () => {
    h.modules = [
      {
        id: 'consensus',
        title: 'Consensus',
        icon: 'Layers',
        panel: (() => null) as AppModule['panel'],
        projectTab: { label: 'Consensus' }
      }
    ];

    const markup = renderNav(
      <ProjectScopedNav project={project} variant="focus" onBack={() => undefined} />
    );

    expect(markup).toContain('data-testid="project-nav-consensus"');
    expect(markup).toContain('href="/projects/proj-1/consensus"');
    expect(markup).toContain('data-sortable-nav-id="consensus"');
    expect(markup).toContain('>Consensus<');
    expect(markup).not.toContain('>Extensions</div>');
    h.modules = [];
  });

  it('opens this project Agents board from the Agents destination', () => {
    const source = readFileSync(new URL('../ProjectScopedNav.tsx', import.meta.url), 'utf8');

    expect(source).toContain("mode: 'agents'");
    expect(source).toContain('getProjectWorkspaceRoutePath(project.id, item.mode)');
    expect(source).toContain('testId: `project-nav-${item.mode}`');
    expect(source).toContain('PROJECT_NAV_ORDER_KEY');
    expect(source).toContain('sidebar--titlebar-controls');
    expect(source).not.toContain('AgentsSidebarSection');
    expect(source).not.toContain('onOpenDashboard');
  });
});
