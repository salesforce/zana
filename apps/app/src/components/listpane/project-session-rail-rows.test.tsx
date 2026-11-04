import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ThreadListItem } from '../../thread-store.js';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { ProjectAgentRailRow, ProjectThreadRailRow } from './project-session-rail-rows.js';

const thread: ThreadListItem = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'p1',
  hostId: 'h1',
  environmentId: null,
  providerId: 'claude-code',
  status: 'idle',
  title: 'Dev server',
  createdAt: 1,
  cwd: null,
  branchName: null,
  isWorktree: false
};

function render(row: ThreadListItem) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ProjectThreadRailRow thread={row} active={false} projectId="p1" routeProjectId="p1" onOpen={() => undefined} onContextMenu={() => undefined} />
    </MemoryRouter>
  );
}

describe('ProjectThreadRailRow', () => {
  it('shows the running-process badge in the detail line', () => {
    const html = render({
      ...thread,
      activity: {
        activeWorkflowCount: 0,
        activeBackgroundAgentCount: 0,
        activeBackgroundCommandCount: 1,
        activeGoalCount: 0,
        activePlanModeCount: 0
      }
    });
    expect(html).toMatch(/project-terminal-detail"><span class="thread-process-badge"/);
    expect(html).toContain('1 background process running');
  });

  it('omits the badge when nothing is running', () => {
    expect(render(thread)).not.toContain('thread-process-badge');
  });

  it('gives a Modern squad member thread the dotted modifier and Thread label', () => {
    const html = render({ ...thread, originPluginId: 'host-modern-squad' });
    expect(html).toContain('class="project-terminal-row is-thread is-modern"');
    expect(html).toContain('data-squad-transport="MODERN"');
    expect(html).toContain(' · Thread');
    expect(render(thread)).not.toContain('is-modern');
  });
});

describe('ProjectAgentRailRow squad titles', () => {
  const base = { id: 's1', title: 'Engineer', status: 'running', profile: 'claude', createdAt: 1 } as TerminalSession;
  const cohortBase = { cohortId: 'c', teamId: 't', teamName: 'Squad', executionId: 'e', executionJobTitle: 'Run Aida Plan' };
  function renderAgent(session: TerminalSession) {
    return renderToStaticMarkup(
      <MemoryRouter>
        <ProjectAgentRailRow session={session} projectId="p1" routeProjectId="p1" isUnread={false} active={false} onOpen={() => undefined} onContextMenu={() => undefined} />
      </MemoryRouter>
    );
  }

  it('shows the worker own title and the orchestrator job title', () => {
    const worker = renderAgent({ ...base, cohort: { ...cohortBase, role: 'worker' } } as TerminalSession);
    expect(worker).toContain('class="project-terminal-name">Engineer<');
    expect(worker).not.toContain('Run Aida Plan');
    const orch = renderAgent({ ...base, title: 'Claude Code', cohort: { ...cohortBase, role: 'orchestrator' } } as TerminalSession);
    expect(orch).toContain('class="project-terminal-name">Run Aida Plan<');
  });
});
