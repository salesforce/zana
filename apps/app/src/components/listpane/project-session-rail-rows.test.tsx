import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ThreadListItem } from '../../thread-store.js';
import { ProjectThreadRailRow } from './project-session-rail-rows.js';

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
});
