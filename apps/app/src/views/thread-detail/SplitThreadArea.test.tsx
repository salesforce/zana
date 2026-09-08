/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../home/HomeView.js', () => ({ HomeView: () => <div data-testid="home-view" /> }));
vi.mock('../inbox/InboxView.js', () => ({ InboxView: () => <div data-testid="inbox-view" /> }));
vi.mock('../agents/AgentsView.js', () => ({ AgentsView: () => <div data-testid="agents-view" /> }));
vi.mock('../agents/AgentSessionPage.js', () => ({
  AgentSessionPage: ({ sessionId, projectId }: { sessionId: string; projectId: string | null }) => (
    <div data-testid="agent-session-page" data-session={sessionId} data-project={projectId ?? ''}>
      session
    </div>
  )
}));
vi.mock('../threads/NewThreadView.js', () => ({ NewThreadView: () => <div data-testid="new-thread" /> }));
vi.mock('../threads/ThreadDetailView.js', () => ({ ThreadDetail: () => <div data-testid="thread-detail" /> }));
vi.mock('./PluginPanelPaneView.js', () => ({ PluginPanelPaneView: () => <div data-testid="plugin-panel" /> }));
vi.mock('../../plugins/plugin-slots.js', () => {
  const panels: unknown[] = [];
  return {
    listNavPanels: () => panels,
    subscribePluginSlots: () => () => undefined
  };
});
vi.mock('../scheduler/SchedulerView.js', () => ({
  SchedulerView: () => <div data-testid="scheduler-view" />
}));
vi.mock('../scheduler/ScheduleDetailPage.js', () => ({
  ScheduleDetailPage: ({
    scheduleId,
    projectId
  }: {
    scheduleId: string | null;
    projectId: string | null;
  }) => (
    <div
      data-testid="schedule-detail-page"
      data-schedule={scheduleId ?? 'new'}
      data-project={projectId ?? ''}
    />
  )
}));
vi.mock('../project/ProjectModePane.js', () => ({
  ProjectModePane: ({
    projectId,
    mode,
    paneId
  }: {
    projectId: string;
    mode: string;
    paneId: string;
  }) => (
    <div
      data-testid="project-mode-pane"
      data-project={projectId}
      data-mode={mode}
      data-pane={paneId}
    />
  )
}));

import { getProjectModeRoutePath } from '../../lib/route-paths.js';
import { splitPane } from '../../lib/split-layout/ops.js';
import { GLOBAL_SPLIT_SCOPE_KEY, projectSplitScopeKey } from '../../lib/split-layout/scope.js';
import { createSinglePaneLayout } from '../../lib/split-layout/splitThreadNavigation.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';
import { SplitThreadArea } from './SplitThreadArea.js';

function resetSplitWorkspace(): void {
  useSplitWorkspace.setState({
    layout: null,
    maximizedPaneId: null,
    dimInactiveSplits: true,
    scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
    scopes: {}
  });
}

describe('SplitThreadArea agent-session', () => {
  afterEach(() => {
    cleanup();
    resetSplitWorkspace();
  });

  it('renders a global session page without an update-depth loop', () => {
    expect(() => {
      render(
        <MemoryRouter>
          <SplitThreadArea
            routeContent={{ kind: 'agent-session', projectId: null, sessionId: 's1' }}
          />
        </MemoryRouter>
      );
    }).not.toThrow();
    expect(screen.getByTestId('agent-session-page').getAttribute('data-session')).toBe('s1');
  });

  it('reuses a project-scoped session pane for the global session URL', () => {
    useSplitWorkspace.setState({
      layout: createSinglePaneLayout({ kind: 'agent-session', projectId: 'p1', sessionId: 's1' }),
      maximizedPaneId: null
    });
    expect(() => {
      render(
        <MemoryRouter>
          <SplitThreadArea
            routeContent={{ kind: 'agent-session', projectId: null, sessionId: 's1' }}
          />
        </MemoryRouter>
      );
    }).not.toThrow();
    expect(screen.getByTestId('agent-session-page').getAttribute('data-session')).toBe('s1');
  });
});

describe('SplitThreadArea scheduler panes', () => {
  afterEach(() => {
    cleanup();
    resetSplitWorkspace();
  });

  it('renders the catalogue for kind scheduler', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'scheduler' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('scheduler-view')).toBeTruthy();
  });

  it('renders the inbox view for kind inbox', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'inbox' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('inbox-view')).toBeTruthy();
  });

  it('renders the schedule page for kind schedule', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'schedule', projectId: null, scheduleId: 'sched-1' }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('scheduler-view')).toBeNull();
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-schedule')).toBe('sched-1');
  });

  it('renders the create page for kind new-schedule', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'new-schedule', projectId: 'p1' }} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('scheduler-view')).toBeNull();
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-schedule')).toBe('new');
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-project')).toBe('p1');
  });
});

describe('SplitThreadArea project-view panes', () => {
  afterEach(() => {
    cleanup();
    resetSplitWorkspace();
  });

  it('renders explorer and terminals project modes', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'project-view', projectId: 'p1', mode: 'explorer' }}
        />
      </MemoryRouter>
    );
    const pane = screen.getByTestId('project-mode-pane');
    expect(pane.getAttribute('data-mode')).toBe('explorer');
    expect(pane.getAttribute('data-project')).toBe('p1');
  });

  it('renders a terminals project-view pane with the layout pane id', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'project-view', projectId: 'p1', mode: 'terminals' }}
        />
      </MemoryRouter>
    );
    const pane = screen.getByTestId('project-mode-pane');
    expect(pane.getAttribute('data-mode')).toBe('terminals');
    expect(pane.getAttribute('data-pane')).toBe('pane-1');
  });

  it('renders a plugin project tab as a project-view pane', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'project-view', projectId: 'p1', mode: 'consensus' }}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('project-mode-pane').getAttribute('data-mode')).toBe('consensus');
  });

  it('marks the unsplit workspace as a drop target', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'agents' }} />
      </MemoryRouter>
    );
    const workspace = screen.getByTestId('split-workspace');
    expect(workspace.getAttribute('data-split')).toBe('false');
    expect(workspace.querySelector('[data-split-pane-id="pane-1"]')).not.toBeNull();
  });

  it('activates the project scope without carrying global splits into the workspace', () => {
    const globalLayout = splitPane(
      createSinglePaneLayout({ kind: 'home' }),
      'pane-1',
      'right',
      { kind: 'agents' }
    );
    useSplitWorkspace.setState({
      scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
      layout: globalLayout,
      maximizedPaneId: null,
      scopes: {
        [GLOBAL_SPLIT_SCOPE_KEY]: { layout: globalLayout, maximizedPaneId: null }
      }
    });
    render(
      <MemoryRouter initialEntries={[getProjectModeRoutePath('p1', 'explorer')]}>
        <SplitThreadArea
          routeContent={{ kind: 'project-view', projectId: 'p1', mode: 'explorer' }}
        />
      </MemoryRouter>
    );
    expect(useSplitWorkspace.getState().scopeKey).toBe(projectSplitScopeKey('p1'));
    expect(useSplitWorkspace.getState().scopes[GLOBAL_SPLIT_SCOPE_KEY]?.layout).toEqual(globalLayout);
    expect(screen.getByTestId('project-mode-pane').getAttribute('data-mode')).toBe('explorer');
    expect(screen.queryByTestId('home-view')).toBeNull();
    expect(screen.queryByTestId('agents-view')).toBeNull();
  });
});

describe('SplitThreadArea host bar', () => {
  afterEach(() => {
    cleanup();
    resetSplitWorkspace();
  });

  it('shows an always-visible bar on host-header panes when split', () => {
    const seeded = createSinglePaneLayout({ kind: 'agents' });
    useSplitWorkspace.setState({
      layout: splitPane(seeded, seeded.focusedPaneId, 'right', { kind: 'home' }),
      maximizedPaneId: null
    });
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'home' }} />
      </MemoryRouter>
    );
    const bars = screen.getAllByTestId('split-pane-bar');
    expect(bars).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Close pane' })).toHaveLength(2);
    expect(screen.getByTestId('agents-view')).toBeTruthy();
    expect(screen.getByTestId('home-view')).toBeTruthy();
  });

  it('does not add a second bar on thread panes', () => {
    const seeded = createSinglePaneLayout({
      kind: 'thread',
      projectId: 'p1',
      threadId: 't1'
    });
    useSplitWorkspace.setState({
      layout: splitPane(seeded, seeded.focusedPaneId, 'right', { kind: 'agents' }),
      maximizedPaneId: null
    });
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'agents' }} />
      </MemoryRouter>
    );
    expect(screen.getAllByTestId('split-pane-bar')).toHaveLength(1);
    expect(screen.getByTestId('thread-detail')).toBeTruthy();
  });

  it('closes an empty pane from the bar, not an in-well button', () => {
    const seeded = createSinglePaneLayout({ kind: 'agents' });
    useSplitWorkspace.setState({
      layout: splitPane(seeded, seeded.focusedPaneId, 'right', { kind: 'empty' }),
      maximizedPaneId: null
    });
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'agents' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('split-pane-empty')).toBeTruthy();
    expect(screen.queryByTestId('split-pane-empty-close')).toBeNull();
    const closeButtons = screen.getAllByRole('button', { name: 'Close pane' });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    expect(useSplitWorkspace.getState().layout).not.toBeNull();
    expect(screen.queryByTestId('split-pane-empty')).toBeNull();
  });
});
