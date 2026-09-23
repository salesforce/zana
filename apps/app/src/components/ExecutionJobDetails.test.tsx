/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { buildJobDetailsText, ExecutionJobDetails } from './ExecutionJobDetails.js';
import { useUi } from '../store';

const baseSnapshot: ExecutionBoardSnapshot = {
  execution: {
    executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'BLOCKED', attempt: 1,
    stateVersion: 2, createdAt: 1, updatedAt: 2, sources: [], blockers: [{ id: 'blocker-1', resolved: false, deliveryState: 'DELIVERED' }], recoveryAttention: false,
    coordinator: { status: 'live', sessionId: 'session-1' },
    work: { total: 1, completed: 1, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 1, FAILED: 0, SKIPPED: 0 }, assignments: [{ workUnitId: 'unit-1', title: 'Unit', state: 'COMPLETED', slotId: 'slot-1', claimedAt: 10, progressAt: 20, leaseExpiresAt: 30 }], rosterSlotIds: [] },
    usage: { version: 1, completeness: 'partial', observationCount: 2, gapCount: 1, byRole: [{ role: 'worker' }] },
    assembledResult: { version: 1, outcome: 'success', summary: 'assembled', units: [{ id: 'unit-1', title: 'Unit', state: 'COMPLETED', result: 'visible result' }], failures: [], artifacts: [], verification: [], usage: { version: 1, completeness: 'complete', observationCount: 1, gapCount: 0, byRole: [] }, digest: `sha256:${'1'.repeat(64)}` },
    routeFitProposal: { version: 1, evaluatorVersion: 'route-fit-v1', active: false, outcome: 'success', fit: 'appropriate', reason: 'legal route', evaluatedAt: 2, samples: 2, selected: [] },
    finalSummary: 'final result', resourceBlock: { version: 1, kind: 'usage-budget', reason: 'budget exhausted', blockedAt: 2 }
  },
  events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
};

let clipboardWriteText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clipboardWriteText = vi.fn(async () => ({ ok: true as const }));
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: {
    snapshot: vi.fn(async () => structuredClone(baseSnapshot)), stop: vi.fn(), retry: vi.fn(), retryWork: vi.fn(),
    releaseWork: vi.fn(), reassignWork: vi.fn(), respond: vi.fn(), retryDelivery: vi.fn(), readArtifact: vi.fn(), relaunchMonitor: vi.fn()
  }, clipboard: { writeText: clipboardWriteText } } });
});
afterEach(() => {
  cleanup();
  useUi.setState({ toasts: [] });
});

describe('ExecutionJobDetails phase 5 projection', () => {
  it('renders usage, assembled result, route fit, and final summary from projection', async () => {
    render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
    expect(await screen.findByText(/Attribution: partial · Observations 2 · Gaps 1/)).toBeTruthy();
    expect(screen.getByText(/worker: input unknown · output unknown/)).toBeTruthy();
    expect(screen.getByText('visible result')).toBeTruthy();
    expect(screen.getByText(/appropriate · legal route · inactive proposal/)).toBeTruthy();
    expect(screen.getByText('final result')).toBeTruthy();
  });

  it('keeps stop available and hides generic retry for resource blocks', async () => {
    render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Stop Squad run' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry Squad run' })).toBeNull();
  });
});

describe('ExecutionJobDetails copy job details', () => {
  it('renders a non-destructive Copy details button near the header, above Stop Squad run', async () => {
    render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
    const copyButton = await screen.findByRole('button', { name: 'Copy details' });
    const stopButton = await screen.findByRole('button', { name: 'Stop Squad run' });
    expect(copyButton.className).not.toContain('danger');
    // Copy sits under Close details at the top; Stop lives in the bottom action row — Copy precedes Stop in the DOM.
    expect(copyButton.compareDocumentPosition(stopButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('copies the expected job details text and shows a transient toast (no modal)', async () => {
    render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
    const copyButton = await screen.findByRole('button', { name: 'Copy details' });
    fireEvent.click(copyButton);

    const expectedText = buildJobDetailsText('project-1', baseSnapshot);
    expect(expectedText).toContain('Job: Ship');
    expect(expectedText).toContain('Execution ID: execution-1');
    expect(expectedText).toContain('Team ID: team-1');
    expect(expectedText).toContain('State: BLOCKED (attempt 1)');
    expect(expectedText).toContain('assignedSlotId: slot-1');
    expect(expectedText).toContain('Telemetry gap count: 1');
    expect(expectedText).toContain('blocker-1');

    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith(expectedText));
    await waitFor(() => expect(useUi.getState().toasts.some((toast) => toast.message === 'Job details copied')).toBe(true));
    // The old confirmation Modal is gone.
    expect(screen.queryByRole('dialog', { name: 'Job details copied' })).toBeNull();
  });

  it('dumps full diagnostic parity — per-unit heartbeat and per-role usage', () => {
    const text = buildJobDetailsText('project-1', baseSnapshot);
    expect(text).toContain('heartbeatAt:');
    expect(text).toMatch(/heartbeatAt: [^·]*· progressAt:/);
    expect(text).toContain('worker: input —');
    expect(text).toContain('Assembled result:');
    expect(text).toContain('Final summary: final result');
    expect(text).toMatch(/Events \(last 0 of 0\)/);
    expect(text).toContain('Artifacts (0)');
  });

  it('dumps the claim-churn line and empty delivery/coordinator-wake sections by default', () => {
    const text = buildJobDetailsText('project-1', baseSnapshot);
    // Every assignment gets a churn line even when the fence fields are absent.
    expect(text).toMatch(/attempt: [^·]*· turnCount: [^·]*· claimGeneration: [^·]*· claimId:/);
    expect(text).toContain('Deliveries (0):');
    expect(text).toContain('Coordinator wakes (0):');
  });

  it('dumps delivery strands and coordinator wakes as metadata only — never payload text or wake message', () => {
    const snapshot: ExecutionBoardSnapshot = structuredClone(baseSnapshot);
    snapshot.execution.work!.assignments[0] = {
      ...snapshot.execution.work!.assignments[0],
      attempt: 3, turnCount: 5, claimGeneration: 2, claimId: 'claim-abc'
    };
    snapshot.execution.deliveries = [{
      id: 'delivery-1', blockerId: 'blocker-1', workUnitId: 'unit-1', slotId: 'slot-1',
      state: 'FAILED', attempt: 8, maxAttempts: 8, manualRetryCount: 1, updatedAt: 99, error: 'apply failed'
    }];
    snapshot.execution.coordinatorWakes = {
      total: 4,
      recent: [{ id: 'wake-1', cause: 'HUMAN_BLOCKER', workUnitId: 'unit-1', stateOrClaimGeneration: 'gen-2', createdAt: 50 }]
    };
    const text = buildJobDetailsText('project-1', snapshot);
    expect(text).toContain('attempt: 3 · turnCount: 5 · claimGeneration: 2 · claimId: claim-abc');
    expect(text).toContain('Deliveries (1):');
    expect(text).toContain('delivery-1 · FAILED · attempt 8/8 · manualRetries 1');
    expect(text).toContain('blocker blocker-1 · unit unit-1 · slot slot-1');
    expect(text).toContain('error: apply failed');
    expect(text).toContain('Coordinator wakes (4):');
    expect(text).toContain('HUMAN_BLOCKER · unit unit-1 · stateOrClaimGeneration gen-2');
  });
});
