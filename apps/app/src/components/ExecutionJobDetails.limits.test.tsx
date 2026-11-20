/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionJobDetails } from './ExecutionJobDetails.js';

function mount(limits?: ExecutionBoardSnapshot['execution']['limits']) {
  const snap = {
    execution: {
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'RUNNING', attempt: 1,
      stateVersion: 7, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
      work: { total: 0, completed: 0, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 0, FAILED: 0, SKIPPED: 0 }, assignments: [], rosterSlotIds: [] },
      ...(limits ? { limits } : {})
    },
    events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
  } as ExecutionBoardSnapshot;
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: { snapshot: vi.fn(async () => structuredClone(snap)) }, clipboard: { writeText: vi.fn() } } });
  return render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
}

afterEach(cleanup);

describe('ExecutionJobDetails run limits', () => {
  it('shows concurrency and both claim ceilings', async () => {
    mount({ maxConcurrent: 2, claimWallClockMs: 1_200_000, claimStallMs: 90_000 });
    expect((await screen.findByTestId('execution-limits')).textContent).toBe('Run limits: up to 2 workers at once · claim wall-clock 20 min · claim stall 90 s');
  });

  it('omits ceilings the run was not given and hides the line without limits', async () => {
    const view = mount({ maxConcurrent: 32 });
    expect((await screen.findByTestId('execution-limits')).textContent).toBe('Run limits: up to 32 workers at once');
    view.unmount();
    mount();
    await screen.findByText('Stop Squad run');
    expect(screen.queryByTestId('execution-limits')).toBeNull();
  });
});
