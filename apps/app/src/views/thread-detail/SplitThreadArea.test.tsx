/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../home/HomeView.js', () => ({ HomeView: () => <div data-testid="home-view" /> }));
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

import { createSinglePaneLayout } from '../../lib/split-layout/splitThreadNavigation.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';
import { SplitThreadArea } from './SplitThreadArea.js';

describe('SplitThreadArea agent-session', () => {
  afterEach(() => {
    cleanup();
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null });
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
    useSplitWorkspace.setState({ layout: null, maximizedPaneId: null });
  });

  it('renders the catalogue for kind scheduler', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'scheduler' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('scheduler-view')).toBeTruthy();
  });

  it('renders the schedule workbench for kind schedule', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea
          routeContent={{ kind: 'schedule', projectId: null, scheduleId: 'sched-1' }}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-schedule')).toBe('sched-1');
  });

  it('renders the create page for kind new-schedule', () => {
    render(
      <MemoryRouter>
        <SplitThreadArea routeContent={{ kind: 'new-schedule', projectId: 'p1' }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-schedule')).toBe('new');
    expect(screen.getByTestId('schedule-detail-page').getAttribute('data-project')).toBe('p1');
  });
});
