/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
const copy = vi.hoisted(() => ({ copyText: vi.fn(async () => undefined) }));
vi.mock('../lib/copy-text.js', () => copy);
import { ExecutionJobDetails } from './ExecutionJobDetails.js';

function mount(limits?: ExecutionBoardSnapshot['execution']['limits'], failureReason?: string) {
  const snap = {
    execution: {
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'RUNNING', attempt: 1,
      stateVersion: 7, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
      work: { total: 0, completed: 0, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 0, FAILED: 0, SKIPPED: 0 }, assignments: [], rosterSlotIds: [] },
      ...(limits ? { limits } : {}),
      ...(failureReason ? { failureReason } : {})
    },
    events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
  } as ExecutionBoardSnapshot;
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: { snapshot: vi.fn(async () => structuredClone(snap)) }, clipboard: { writeText: vi.fn() } } });
  return render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
}

afterEach(() => { cleanup(); copy.copyText.mockClear(); });

describe('ExecutionJobDetails run limits', () => {
  it('shows concurrency and both claim ceilings', async () => {
    mount({ maxConcurrent: 2, claimWallClockMs: 1_200_000, claimStallMs: 90_000 });
    expect((await screen.findByTestId('execution-limits')).textContent).toBe('Run limits: up to 2 sessions · claim wall-clock 20 min · claim stall 90 s');
  });

  it('shows the failure reason in the body and the copied dump', async () => {
    mount({ maxConcurrent: 1 }, 'claim wall-clock exceeded');
    await screen.findByTestId('execution-limits');
    expect(screen.getByText('Failure reason')).toBeTruthy();
    expect(screen.getByText('claim wall-clock exceeded')).toBeTruthy();
    fireEvent.click(screen.getByText('Diagnostics', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    await vi.waitFor(() => expect(copy.copyText).toHaveBeenCalled());
    const dump = copy.copyText.mock.calls[0][0] as string;
    expect(dump).toContain('Failure reason: claim wall-clock exceeded');
    expect(dump).toContain('Limits: up to 1 sessions');
  });

  it('omits ceilings the run was not given and hides the line without limits', async () => {
    const view = mount({ maxConcurrent: 32 });
    expect((await screen.findByTestId('execution-limits')).textContent).toBe('Run limits: up to 32 sessions');
    view.unmount();
    mount();
    await screen.findByText('Stop Squad run');
    expect(screen.queryByTestId('execution-limits')).toBeNull();
  });
});
