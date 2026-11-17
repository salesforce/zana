/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionJobDetails } from './ExecutionJobDetails.js';

const copyText = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../lib/copy-text.js', () => ({ copyText }));

function snapshot(failureReason?: string): ExecutionBoardSnapshot {
  return {
    execution: {
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'FAILED', attempt: 1,
      stateVersion: 2, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
      ...(failureReason ? { failureReason } : {})
    },
    events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
  } as unknown as ExecutionBoardSnapshot;
}

function mount(value: ExecutionBoardSnapshot) {
  Object.defineProperty(window, 'cc', { configurable: true, value: { executionBoard: { snapshot: vi.fn(async () => value) } } });
  render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
}

describe('ExecutionJobDetails failure reason (REQ-2)', () => {
  afterEach(() => { cleanup(); copyText.mockClear(); });

  it('shows the failure reason of a failed run and includes it in the copied details', async () => {
    mount(snapshot('worker 0:a:0 failed to spawn'));
    await screen.findByText('Failure reason');
    expect(screen.getByText('worker 0:a:0 failed to spawn')).toBeTruthy();
    fireEvent.click(screen.getByText('Copy details'));
    await waitFor(() => expect(copyText).toHaveBeenCalled());
    expect(String((copyText.mock.calls[0] as unknown[])[0])).toContain('Failure reason: worker 0:a:0 failed to spawn');
  });

  it('shows no failure reason section for a run without one (older record)', async () => {
    mount(snapshot());
    await screen.findByText('Run ID');
    expect(screen.queryByText('Failure reason')).toBeNull();
    fireEvent.click(screen.getByText('Copy details'));
    await waitFor(() => expect(copyText).toHaveBeenCalled());
    expect(String((copyText.mock.calls[0] as unknown[])[0])).not.toContain('Failure reason');
  });
});
