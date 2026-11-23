/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ReactNode } from 'react';

const project: Project = { id: 'proj-1', name: 'demo', path: '/tmp/demo', createdAt: 0, lastActiveAt: 0 };

const h = vi.hoisted(() => ({
  state: {
    nav: 'projects',
    projectView: {} as Record<string, string>,
    setProjectView: vi.fn(),
    collapsedSections: {},
    toggleSection: vi.fn(),
    exitProjectFocus: vi.fn()
  },
  data: { goalsEnabled: false, followUpsEnabled: false, suggestionsEnabled: false },
  showInMainWindow: vi.fn(async () => true),
  noTabs: [] as never[],
  noModules: [] as never[],
  noAvailability: {},
  counts: { active: 0, blocked: 0 }
}));

vi.mock('../../store', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  }),
  useData: (selector: (state: typeof h.data) => unknown) => selector(h.data),
  useUnreadInboxCount: () => 0,
  useAgentNavCounts: () => h.counts,
  useProjectActiveGoalCount: () => 0,
  useProjectOpenFollowUpCount: () => 0,
  useProjectScheduleCount: () => 0,
  useProjectRunningTerminalCount: () => 0,
  applySidebarWidth: vi.fn(),
  SIDEBAR_MIN: 256,
  SIDEBAR_MAX: 480
}));
vi.mock('../../modules', () => ({ useProjectTabModules: () => h.noModules }));
vi.mock('../../plugins/plugin-slots', () => ({
  listThreadLists: () => [],
  subscribePluginSlots: () => () => undefined,
  listSidebarFooterActions: () => [],
  listProjectTabs: () => h.noTabs,
  projectTabView: () => ''
}));
vi.mock('../../plugins/plugin-view-windows', () => ({ showInMainWindow: h.showInMainWindow }));
vi.mock('../../lib/resolveIcon', () => ({ resolveIcon: () => () => null }));
vi.mock('../../hooks/useProjectTabAvailability', () => ({ useProjectTabAvailability: () => h.noAvailability }));
vi.mock('../../hooks/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('../../lib/libraryPlugin', () => ({ resolveProjectTabModule: () => undefined }));
// Only the header slot matters here; the real rail pulls in unrelated stores.
vi.mock('../SidebarRail', () => ({
  SidebarRail: ({ header }: { header?: ReactNode }) => <>{header}</>,
  SidebarCountBadge: () => null
}));
vi.mock('../listpane/project-session-rail', () => ({ ProjectSessionRail: () => null }));
vi.mock('../../plugins/PluginExclusiveThreadList', () => ({
  useActiveThreadList: () => null,
  PluginExclusiveThreadList: () => null
}));

import { ProjectScopedNav } from '../ProjectScopedNav.js';

function renderAt(path: string, variant: 'window' | 'focus', onBack?: () => void) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectScopedNav project={project} variant={variant} onBack={onBack} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByTestId('project-nav-back'));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectScopedNav Back', () => {
  it('shows all projects in the main window from a locked project window', () => {
    renderAt('/projects/proj-1/agents', 'window');
    expect(h.showInMainWindow).toHaveBeenCalledWith('/agents');
    expect(h.state.exitProjectFocus).not.toHaveBeenCalled();
  });

  it('returns to Global settings in the main window from project settings', () => {
    renderAt('/projects/proj-1/settings', 'window');
    expect(h.showInMainWindow).toHaveBeenCalledWith('/settings');
  });

  it('exits project focus in place in the main window', () => {
    const onBack = vi.fn();
    renderAt('/projects/proj-1/agents', 'focus', onBack);
    expect(h.state.exitProjectFocus).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(h.showInMainWindow).not.toHaveBeenCalled();
  });
});
