/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionJobDetails, freshSessionSlotIds } from './ExecutionJobDetails.js';
import { useTeams } from '../stores/live';

/** #579: the job details view marks a seat that gets a fresh session per unit. */
const snapshot = (): ExecutionBoardSnapshot => ({
  execution: {
    executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'RUNNING', attempt: 1,
    stateVersion: 2, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
    coordinator: { status: 'live', sessionId: 'session-1' },
    work: {
      total: 2, completed: 0, counts: { PENDING: 0, READY: 0, CLAIMED: 2, BLOCKED: 0, COMPLETED: 0, FAILED: 0, SKIPPED: 0 },
      assignments: [
        { workUnitId: 'u1', title: 'Fresh unit', dependencies: [], state: 'CLAIMED', slotId: '0:w:0' },
        { workUnitId: 'u2', title: 'Plain unit', dependencies: [], state: 'CLAIMED', slotId: '1:v:0' },
        { workUnitId: 'u3', title: 'Waiting unit', dependencies: [], state: 'READY' }
      ],
      rosterSlotIds: ['0:w:0', '1:v:0']
    }
  },
  events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
} as never);

beforeEach(() => {
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: { snapshot: vi.fn(async () => snapshot()) }, clipboard: { writeText: vi.fn() } } });
});
afterEach(() => { cleanup(); useTeams.setState({ teams: [] }); });

describe('freshSessionSlotIds', () => {
  const team = { slots: [{ freshContextPerUnit: true }, {}, { freshContextPerUnit: false }] };
  it('picks the seats of rows that opted in', () => {
    expect([...freshSessionSlotIds(team, ['0:w:0', '0:w:1', '1:v:0', '2:x:0'])]).toEqual(['0:w:0', '0:w:1']);
  });
  it('picks nothing for an unknown team, an unknown row or a malformed seat id', () => {
    expect(freshSessionSlotIds(undefined, ['0:w:0']).size).toBe(0);
    expect(freshSessionSlotIds(team, ['9:w:0', 'orchestrator:lead', 'x']).size).toBe(0);
  });
});

describe('REQ-1 the job details mark a fresh-session seat', () => {
  it('shows "Fresh session per unit" next to the unit assigned to such a seat only', async () => {
    useTeams.setState({ teams: [{ id: 'team-1', name: 'T', orchestratorPersonaId: 'o', source: 'user', slots: [{ personaId: 'w', freshContextPerUnit: true }, { personaId: 'v' }] }] as never });
    render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
    await screen.findByText(/Fresh unit/);
    expect(screen.getAllByText('Fresh session per unit')).toHaveLength(1);
    expect(screen.getByText(/Fresh unit/).textContent).toContain('Fresh session per unit');
  });

  it('shows no label for a team without the setting', async () => {
    useTeams.setState({ teams: [{ id: 'team-1', name: 'T', orchestratorPersonaId: 'o', source: 'user', slots: [{ personaId: 'w' }, { personaId: 'v' }] }] as never });
    render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
    await screen.findByText(/Fresh unit/);
    expect(screen.queryByText('Fresh session per unit')).toBeNull();
  });
});
