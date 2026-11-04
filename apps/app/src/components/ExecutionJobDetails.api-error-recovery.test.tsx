/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { buildJobDetailsText, ExecutionJobDetails } from './ExecutionJobDetails.js';

type Recovery = { step: string; errorKind?: string; since: number };

function snapshot(recovery?: Recovery): ExecutionBoardSnapshot {
  return {
    execution: {
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'RUNNING', attempt: 1,
      stateVersion: 4, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
      coordinator: { status: 'live', sessionId: 'session-1' },
      work: {
        total: 1, completed: 0, counts: { PENDING: 0, READY: 0, CLAIMED: 1, BLOCKED: 0, COMPLETED: 0, FAILED: 0, SKIPPED: 0 },
        assignments: [{ workUnitId: 'unit-1', title: 'Unit', state: 'CLAIMED', slotId: 'slot-1', dependencies: [], ...(recovery ? { recovery } : {}) }],
        rosterSlotIds: []
      }
    },
    events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
  };
}

let writeText: ReturnType<typeof vi.fn>;

function load(recovery?: Recovery) {
  (window.cc.executionBoard.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue(snapshot(recovery));
  return render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
}

beforeEach(() => {
  writeText = vi.fn(async () => ({ ok: true as const }));
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: {
    snapshot: vi.fn(), stop: vi.fn(), retry: vi.fn(), retryWork: vi.fn(), releaseWork: vi.fn(), reassignWork: vi.fn(), respond: vi.fn(),
    retryDelivery: vi.fn(), recoverTimedOut: vi.fn(), recoverRetainedSquad: vi.fn(), readArtifact: vi.fn(), relaunchMonitor: vi.fn()
  }, clipboard: { writeText } } });
});
afterEach(() => cleanup());

describe('API-error recovery in Squad details', () => {
  it.each([
    ['waiting', 'waiting to nudge'],
    ['nudged', 'nudged, waiting for a new turn'],
    ['restarted', 'restarted, waiting for a new turn']
  ])('shows the %s step', async (step, text) => {
    load({ step, errorKind: 'overloaded', since: 1_000 });
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe(`Recovering engineer after API error: ${text}`);
  });

  it('shows nothing without recovery', async () => {
    load();
    await screen.findByText(/Unit → slot-1/);
    expect(screen.queryByRole('status')).toBeNull();
    expect(buildJobDetailsText('project-1', snapshot())).not.toContain('recovery:');
  });

  it('includes the recovery line in the copied details', async () => {
    const recovery = { step: 'nudged', errorKind: 'overloaded', since: 1_000 };
    load(recovery);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy details' }));
    const expected = buildJobDetailsText('project-1', snapshot(recovery));
    expect(expected).toContain('recovery: nudged (overloaded) since 1970-01-01T00:00:01.000Z');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
  });

  it('omits the kind when none was recorded', () => {
    expect(buildJobDetailsText('project-1', snapshot({ step: 'waiting', since: 0 }))).toContain('recovery: waiting since 1970-01-01T00:00:00.000Z');
  });
});
