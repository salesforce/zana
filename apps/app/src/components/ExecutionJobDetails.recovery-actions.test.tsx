/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionJobDetails } from './ExecutionJobDetails.js';

// MT-5 (1), (6): Recover orchestrator and Retry Squad run availability, driven by main's projection.
const base: ExecutionBoardSnapshot = {
  execution: {
    executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'RUNNING', attempt: 1,
    stateVersion: 4, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
    coordinator: { status: 'live', sessionId: 'session-1' },
    work: { total: 1, completed: 1, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 1, FAILED: 0, SKIPPED: 0 }, assignments: [], rosterSlotIds: [] }
  },
  events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
};

function load(mutate: (e: ExecutionBoardSnapshot['execution']) => void) {
  const snap = structuredClone(base);
  mutate(snap.execution);
  (window.cc.executionBoard.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue(snap);
  return render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
}

beforeEach(() => {
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: {
    snapshot: vi.fn(), stop: vi.fn(), retry: vi.fn(), retryWork: vi.fn(), releaseWork: vi.fn(), reassignWork: vi.fn(), respond: vi.fn(),
    retryDelivery: vi.fn(), recoverTimedOut: vi.fn(), recoverRetainedSquad: vi.fn(), resumeRun: vi.fn(), readArtifact: vi.fn(), relaunchMonitor: vi.fn()
  }, clipboard: { writeText: vi.fn() } } });
});
afterEach(() => cleanup());

describe('Recover orchestrator', () => {
  it('is offered for the same run when orchestrator is lost and recovery is available, and calls relaunchMonitor', async () => {
    load((e) => { e.coordinator = { status: 'lost' }; e.recoveryAttention = true; e.recovery = { status: 'available', deadlineAt: Date.now() + 10_000 } as never; });
    fireEvent.click(await screen.findByRole('button', { name: 'Recover orchestrator' }));
    await waitFor(() => expect(window.cc.executionBoard.relaunchMonitor).toHaveBeenCalledWith('project-1', 'execution-1'));
  });

  it('is absent when the orchestrator is live', async () => {
    load(() => {});
    await screen.findByRole('button', { name: 'Stop Squad run' });
    expect(screen.queryByRole('button', { name: 'Recover orchestrator' })).toBeNull();
  });

  it('is absent once the recovery deadline expired', async () => {
    load((e) => { e.coordinator = { status: 'lost' }; e.recoveryAttention = true; e.recovery = { status: 'expired' } as never; });
    expect(await screen.findByText(/Recovery deadline expired/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Recover orchestrator' })).toBeNull();
  });
});

describe('Retry Squad run eligibility', () => {
  const blockedNoBlocker = (e: ExecutionBoardSnapshot['execution']) => { e.state = 'BLOCKED'; e.currentBlocker = undefined; e.resourceBlock = undefined; };

  it('shows for a BLOCKED run without a pending blocker or resource block and passes stateVersion', async () => {
    load(blockedNoBlocker);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Squad run' }));
    await waitFor(() => expect(window.cc.executionBoard.retry).toHaveBeenCalledWith('project-1', 'execution-1', 4));
  });

  it.each([
    ['RUNNING', (e: ExecutionBoardSnapshot['execution']) => { e.state = 'RUNNING'; }],
    ['STOPPED', (e: ExecutionBoardSnapshot['execution']) => { e.state = 'STOPPED'; }],
    ['FAILED', (e: ExecutionBoardSnapshot['execution']) => { e.state = 'FAILED'; }],
    ['BLOCKED with human blocker', (e: ExecutionBoardSnapshot['execution']) => { blockedNoBlocker(e); e.currentBlocker = { id: 'b', workUnitId: 'u', slotId: 's', question: 'q' } as never; }],
    ['BLOCKED by resource block', (e: ExecutionBoardSnapshot['execution']) => { blockedNoBlocker(e); e.resourceBlock = { version: 1, kind: 'usage-budget', reason: 'x', blockedAt: 1 } as never; }]
  ])('is hidden for %s', async (_name, mutate) => {
    load(mutate);
    await waitFor(() => expect(window.cc.executionBoard.snapshot).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Close details' });
    expect(screen.queryByRole('button', { name: 'Retry Squad run' })).toBeNull();
  });
});
