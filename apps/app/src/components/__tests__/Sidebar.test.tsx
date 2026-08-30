import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';

const h = vi.hoisted(() => {
  const cache = new Map<string, unknown>();
  const state = {
    nav: 'projects',
    setNav: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    exitProjectFocus: vi.fn(),
    selectProject: vi.fn(),
    collapsedSections: {},
    toggleSection: vi.fn(),
    setAgentsBoardView: vi.fn(),
    setLauncherOpen: vi.fn()
  };
  const data = { projects: [], suggestionsEnabled: false, followUpsEnabled: false };
  return {
    cache,
    state,
    data,
    modules: [] as AppModule[],
    agentCounts: { active: 0, blocked: 0 },
    enabledSchedules: 0,
    runningSchedules: 0
  };
});

// Sidebar pulls in renderer stores (which close over window.cc / IPC) at module
// load. Stub enough surface to render the rail through React SSR.
vi.mock('../../store', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  }),
  useData: (selector: (state: typeof h.data) => unknown) => selector(h.data),
  useUnreadInboxCount: () => 0,
  useEnabledSchedulerCount: () => h.enabledSchedules,
  useRunningSchedulerCount: () => h.runningSchedules,
  useAgentNavCounts: () => h.agentCounts,
  applySidebarWidth: vi.fn(),
  SIDEBAR_MIN: 256,
  SIDEBAR_MAX: 480
}));
vi.mock('../../modules', () => ({ useMergedModules: () => h.modules }));
vi.mock('../listpane/ProjectsList', () => ({
  ProjectsList: () => <div data-testid="sidebar-projects" />
}));
vi.mock('../../plugins/plugin-slots', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listSidebarFooterActions: () => [],
  listNavPanels: () => []
}));

import { Sidebar } from '../Sidebar.js';

function renderSidebar() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>
  );
}

describe('Sidebar structure and compact accessibility', () => {
  it('renders a labelled navigation region that owns the scrollable destinations', () => {
    h.state.sidebarCollapsed = false;
    h.modules = [];
    h.agentCounts = { active: 0, blocked: 0 };
    h.enabledSchedules = 0;
    h.runningSchedules = 0;

    const markup = renderSidebar();

    expect(markup).toContain('class="sidebar sidebar--global"');
    expect(markup).toContain('data-testid="sidebar-navigation"');
    expect(markup).toContain('aria-label="Main navigation"');
    expect(markup).not.toContain('role="group"');
    expect(markup).toContain('data-testid="sidebar-projects"');
    expect(markup).not.toContain('data-sortable-sidebar-section-id="sidebar-section:agents"');
    expect(markup).toContain('data-sortable-sidebar-section-id="sidebar-section:workspaces"');
    expect(markup.indexOf('data-testid="nav-home"')).toBeLessThan(
      markup.indexOf('data-testid="nav-inbox"')
    );
    expect(markup.indexOf('data-testid="nav-inbox"')).toBeLessThan(
      markup.indexOf('data-sortable-nav-id="agents"')
    );
    expect(markup.indexOf('data-sortable-nav-id="agents"')).toBeLessThan(
      markup.indexOf('data-sortable-nav-id="scheduler"')
    );
    expect(markup).not.toContain('data-sortable-nav-id="home"');
    expect(markup).not.toContain('data-sortable-nav-id="inbox"');
    expect(markup).toContain('>New Chat<');
    expect(markup).not.toContain('>Home<');
    expect(markup).toContain('>Agents<');
    expect(markup).toContain('>Scheduler<');
    expect(markup).not.toContain('>Docs<');
    expect(markup).not.toContain('>New thread<');
    expect(markup).not.toContain('aria-label="Search commands"');
    expect(markup).not.toContain('Command center');
    expect(markup).not.toContain('aria-label="Go back"');
    expect(markup).toContain('href="/inbox"');
    expect(markup).toContain('href="/agents"');
    expect(markup).toContain('href="/scheduler"');
    expect(markup).toContain('href="/settings"');
    expect(markup).toContain('data-testid="nav-agents"');
    expect(markup).toContain('data-sortable-nav-id="scheduler"');
    expect(markup).not.toContain('data-sortable-nav-id="personas"');
    expect(markup).not.toContain('data-sortable-nav-id="squads"');
    expect(markup).not.toContain('data-sortable-nav-id="usage"');
    expect(markup).not.toContain('data-sortable-nav-id="settings"');
    expect(markup).toContain('class="sidebar-utility-bar"');
    expect(markup).toContain('class="sidebar-resizer"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('aria-label="Report a bug"');
    expect(markup).not.toContain('>Settings<');
    expect(markup).not.toContain('aria-label="Open Agents dashboard"');
    expect(markup).not.toContain('data-testid="sidebar-agents-heading"');
    expect(markup).not.toContain('data-testid="sidebar-agents-toggle"');
    expect(markup).not.toContain('class="sidebar-agents-resizer"');
    expect(markup).not.toContain('data-agent-tray-placement="inline"');
    expect(markup).not.toContain('class="sidebar-agents ');
  });

  it('badges Agents with the live fleet count and reds it when someone is blocked', () => {
    h.state.sidebarCollapsed = false;
    h.modules = [];
    h.agentCounts = { active: 4, blocked: 2 };

    const markup = renderSidebar();
    const agentsStart = markup.indexOf('data-testid="nav-agents"');
    const agentsChunk = markup.slice(agentsStart, markup.indexOf('</a>', agentsStart));

    expect(agentsChunk).toContain('href="/agents"');
    expect(agentsChunk).toContain('>Agents<');
    expect(agentsChunk).toContain('class="nav-badge nav-badge--blocked"');
    expect(agentsChunk).toContain('aria-label="4 active · 2 need you"');
    expect(agentsChunk).toContain('>4<');
    expect(agentsChunk).toContain('class="nav-running-dot"');

    h.agentCounts = { active: 0, blocked: 0 };
  });

  it('badges Agents with a running count when the fleet is live', () => {
    h.state.sidebarCollapsed = false;
    h.modules = [];
    h.agentCounts = { active: 3, blocked: 0 };

    const markup = renderSidebar();
    const agentsStart = markup.indexOf('data-testid="nav-agents"');
    const agentsChunk = markup.slice(agentsStart, markup.indexOf('</a>', agentsStart));

    expect(agentsChunk).toContain('class="nav-badge nav-badge--running"');
    expect(agentsChunk).toContain('aria-label="3 active"');
    expect(agentsChunk).toContain('>3<');
    expect(agentsChunk).toContain('class="nav-running-dot"');

    h.agentCounts = { active: 0, blocked: 0 };
  });

  it('badges Scheduler with the live run count', () => {
    h.state.sidebarCollapsed = false;
    h.modules = [];
    h.runningSchedules = 2;
    h.enabledSchedules = 5;

    const markup = renderSidebar();
    const start = markup.indexOf('data-testid="nav-scheduler"');
    const chunk = markup.slice(start, markup.indexOf('</a>', start));

    expect(chunk).toContain('href="/scheduler"');
    expect(chunk).toContain('>Scheduler<');
    expect(chunk).toContain('class="nav-badge nav-badge--running"');
    expect(chunk).toContain('aria-label="2 running · 5 scheduled"');
    expect(chunk).toContain('>2<');
    expect(chunk).toContain('class="nav-running-dot"');

    h.runningSchedules = 0;
    h.enabledSchedules = 0;
  });

  it('puts installed extension panels in the movable primary navigation list', () => {
    h.state.sidebarCollapsed = false;
    h.modules = [
      {
        id: 'library-surface',
        title: 'Docs',
        icon: 'Library',
        panel: (() => null) as AppModule['panel']
      }
    ];

    const markup = renderSidebar();
    expect(markup).toContain('data-testid="nav-extensions"');
    expect(markup).toContain('>Plugins<');
    expect(markup).toContain('data-testid="nav-library-surface"');
    expect(markup).toContain('>Docs<');
    expect(markup).toContain('data-sortable-nav-id="library-surface"');
    expect(markup).not.toContain('aria-label="Installed extensions"');
    expect(markup.indexOf('data-sortable-nav-id="library-surface"')).toBeLessThan(
      markup.indexOf('data-testid="sidebar-projects"')
    );
  });

  it('keeps failed, settings-only, and project-only plugin modules off the rail', () => {
    h.state.sidebarCollapsed = false;
    h.modules = [
      {
        id: 'ask-user-question',
        title: 'Ask user question',
        icon: 'CircleHelp',
        panel: (() => null) as AppModule['panel'],
        loadError: 'Failed to fetch dynamically imported module'
      } as AppModule,
      {
        id: 'custom-instructions',
        title: 'Custom instructions',
        icon: 'ScrollText',
        placement: 'settings',
        panel: (() => null) as AppModule['panel']
      },
      {
        id: 'salesforce',
        title: 'Salesforce',
        icon: 'Cloud',
        panel: (() => null) as AppModule['panel'],
        projectTab: { global: false }
      }
    ];

    const markup = renderSidebar();
    expect(markup).not.toContain('Ask user question');
    expect(markup).not.toContain('Custom instructions');
    expect(markup).not.toContain('Salesforce');
    expect(markup).not.toContain('data-testid="nav-ask-user-question"');
    expect(markup).toContain('data-testid="nav-extensions"');
  });

  it('renders no rail when the shell overlay owns sidebar restoration', () => {
    h.state.sidebarCollapsed = true;
    h.modules = [];

    const markup = renderSidebar();

    expect(markup).toBe('');
  });

  it('does not underline destination Links — they are chrome, not hyperlinks', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.sidebar a\s*\{[^}]*text-decoration:\s*none/);
    expect(css).toMatch(/\.nav-item\s*\{[^}]*text-decoration:\s*none/);
    expect(css).toMatch(/\.nav-item-label\s*\{[^}]*flex:\s*1 1 auto/);
  });

  it('uses translation-only transforms when compact rows cross collection sections', () => {
    const source = readFileSync(new URL('../sidebarSortable.tsx', import.meta.url), 'utf8');

    expect(source).toContain('CSS.Translate.toString(transform)');
    expect(source).not.toContain('CSS.Transform.toString(transform)');
  });
});
