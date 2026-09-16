/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionJobDetails } from './ExecutionJobDetails.js';

const baseSnapshot: ExecutionBoardSnapshot = {
  execution: {
    executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'BLOCKED', attempt: 1,
    stateVersion: 2, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
    work: { total: 1, completed: 1, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 1, FAILED: 0, SKIPPED: 0 }, assignments: [{ workUnitId: 'unit-1', title: 'Unit', state: 'COMPLETED' }], rosterSlotIds: [] },
    usage: { version: 1, completeness: 'partial', observationCount: 2, gapCount: 1, byRole: [{ role: 'worker' }] },
    assembledResult: { version: 1, outcome: 'success', summary: 'assembled', units: [{ id: 'unit-1', title: 'Unit', state: 'COMPLETED', result: 'visible result' }], failures: [], artifacts: [], verification: [], usage: { version: 1, completeness: 'complete', observationCount: 1, gapCount: 0, byRole: [] }, digest: `sha256:${'1'.repeat(64)}` },
    routeFitProposal: { version: 1, evaluatorVersion: 'route-fit-v1', active: false, outcome: 'success', fit: 'appropriate', reason: 'legal route', evaluatedAt: 2, samples: 2, selected: [] },
    finalSummary: 'final result', resourceBlock: { version: 1, kind: 'usage-budget', reason: 'budget exhausted', blockedAt: 2 }
  },
  events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
};

beforeEach(() => {
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: {
    snapshot: vi.fn(async () => structuredClone(baseSnapshot)), stop: vi.fn(), retry: vi.fn(), retryWork: vi.fn(),
    releaseWork: vi.fn(), reassignWork: vi.fn(), respond: vi.fn(), retryDelivery: vi.fn(), readArtifact: vi.fn(), relaunchMonitor: vi.fn()
  } } });
});
afterEach(cleanup);

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
    expect(await screen.findByRole('button', { name: 'Stop Team run' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry Team run' })).toBeNull();
  });
});
