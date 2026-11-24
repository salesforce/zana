// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardProjection, TerminalSession } from '@zana-ai/zcc-domain/product';

vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {}, threads: {}, config: { set: vi.fn(), dismissWorkerExit: vi.fn() } } }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes } from './AgentBoard.js';
import { agentFleetItem } from './fleet-item.js';
import { useData, useUi } from '../store.js';

const NOW = Date.now();
const member = (id: string, role: 'orchestrator' | 'worker', over: Partial<TerminalSession> & { slotId?: string } = {}) => {
  const { slotId, ...session } = over;
  return agentFleetItem({
    projectId: 'p', projectName: 'proj', state: 'working',
    session: {
      id, title: id, profile: 'claude', status: 'running', createdAt: NOW - 5000,
      cohort: { cohortId: 'c', teamId: 't', teamName: 'Team', role, slotId: slotId ?? id, slotLabel: id, executionId: 'e1' },
      ...session
    } as TerminalSession
  });
};
const execution = (over: Partial<ExecutionBoardProjection> = {}): ExecutionBoardProjection => ({
  executionId: 'e1', projectId: 'p', teamId: 't', teamName: 'Team', jobTitle: 'Build the site', state: 'RUNNING', attempt: 1, createdAt: 1, updatedAt: 2,
  ...over
} as ExecutionBoardProjection);
const board = (executions: ExecutionBoardProjection[], items = [member('lead', 'orchestrator'), member('fresh', 'worker'), member('stale', 'worker'), member('plain', 'worker'), member('gone', 'worker', { status: 'exited', finishedAt: NOW })]) =>
  <MemoryRouter><AgentBoardLanes cards={items} onInspect={vi.fn()} executions={executions} /></MemoryRouter>;
const claim = (slotId: string, at: number) => ({ slotId, state: 'CLAIMED', claimedAt: at, progressAt: at, turnCount: 1 });

describe('Squad card visibility on the Agents board', () => {
  beforeEach(() => {
    useData.setState({ projects: [], terminals: {}, includeScheduledAgentsInAgentView: false });
    useUi.setState({ dismissedWorkerExits: [] });
  });
  afterEach(cleanup);

  it('shows the owner once and each live worker\'s claim liveness, flagging a stale heartbeat', () => {
    render(board([execution({
      startedFrom: { kind: 'thread', id: 't1', title: ' Fix auth ' } as never,
      work: { assignments: [claim('fresh', NOW - 30_000), claim('stale', NOW - 20 * 60_000)] } as never
    })]));
    expect(screen.getAllByTestId('squad-owner')).toHaveLength(1);
    expect(screen.getByTestId('squad-owner').textContent).toBe('Owner Fix auth');
    const rows = screen.getAllByTestId('squad-worker-visibility');
    expect(rows.map((row) => row.getAttribute('data-stale'))).toEqual(['false', 'true']);
    expect(rows[0].className).not.toContain('is-stale');
    expect(rows[1].className).toContain('is-stale');
    expect(rows[1].textContent).toContain('(stale)');
    // A seat with no claim and an exited seat carry no liveness line.
    expect(within(screen.getByText('plain').closest('button')!).queryByTestId('squad-worker-visibility')).toBeNull();
    expect(within(screen.getByText('gone').closest('button')!).queryByTestId('squad-worker-visibility')).toBeNull();
  });

  it('omits the owner line when the run was not started from a conversation', () => {
    render(board([execution()]));
    expect(screen.queryByTestId('squad-owner')).toBeNull();
  });

  it('shows how long a Squad has waited for a human answer on its card', () => {
    render(board([execution({
      state: 'BLOCKED',
      currentBlocker: { id: 'b1', workUnitId: 'w1', slotId: 'fresh', question: 'Which label?', waitingSince: NOW - 4 * 60_000 } as never
    })]));
    expect(screen.getByTestId('agent-card-blocker-wait').textContent).toMatch(/^Needs your answer · waiting /);
  });

  it('shows a plain prompt when the wait start is not known, and nothing for a running Squad', () => {
    const view = render(board([execution({ state: 'BLOCKED', currentBlocker: { id: 'b1', workUnitId: 'w1', slotId: 'fresh', question: 'q?' } as never })]));
    expect(screen.getByTestId('agent-card-blocker-wait').textContent).toBe('Needs your answer');
    view.rerender(board([execution()]));
    expect(screen.queryByTestId('agent-card-blocker-wait')).toBeNull();
  });
});
