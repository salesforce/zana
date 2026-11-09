/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionJobDetails } from './ExecutionJobDetails.js';

// #583 REQ-10: the job details show "Review round k of N" for a loop unit and nothing for a plain unit.
const base = (assignment: Record<string, unknown>): ExecutionBoardSnapshot => ({
  execution: {
    executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'RUNNING', attempt: 1,
    stateVersion: 4, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
    coordinator: { status: 'live', sessionId: 'session-1' },
    work: { total: 1, completed: 0, counts: { PENDING: 0, READY: 1, CLAIMED: 0, BLOCKED: 0, COMPLETED: 0, FAILED: 0, SKIPPED: 0 }, assignments: [{ workUnitId: 'r', title: 'Review', state: 'READY', ...assignment }] as never, rosterSlotIds: [] }
  },
  events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
});

function load(assignment: Record<string, unknown>) {
  (window.cc.executionBoard.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue(base(assignment));
  return render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
}

beforeEach(() => {
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: {
    snapshot: vi.fn(), stop: vi.fn(), retry: vi.fn(), retryWork: vi.fn(), releaseWork: vi.fn(), reassignWork: vi.fn(), respond: vi.fn(),
    retryDelivery: vi.fn(), recoverTimedOut: vi.fn(), recoverRetainedSquad: vi.fn(), readArtifact: vi.fn(), relaunchMonitor: vi.fn()
  }, clipboard: { writeText: vi.fn() } } });
});
afterEach(() => cleanup());

describe('REQ-10 job details review round', () => {
  it('shows "Review round 2 of 3" for a loop unit', async () => {
    load({ loopRound: 2, loopMax: 3 });
    expect(await screen.findByText(/Review round 2 of 3/)).toBeTruthy();
  });

  it('shows the grown bound after a Retry at the limit', async () => {
    load({ loopRound: 2, loopMax: 2, state: 'COMPLETED' });
    expect(await screen.findByText(/Review round 2 of 2/)).toBeTruthy();
  });

  it('shows no review round text for a unit without a loop', async () => {
    load({});
    await screen.findByText(/Review/);
    expect(screen.queryByText(/Review round/)).toBeNull();
  });
});
