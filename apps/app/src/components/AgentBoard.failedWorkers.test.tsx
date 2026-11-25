// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';

vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {}, threads: {} } }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes } from './AgentBoard.js';

const base = {
  executionId: 'exec-1', projectId: 'p', jobTitle: 'Ship it', state: 'RUNNING', stateVersion: 3, createdAt: 1, updatedAt: 2
} as unknown as ExecutionBoardProjection;

function renderBoard(execution: ExecutionBoardProjection) {
  render(<MemoryRouter><AgentBoardLanes cards={[]} executions={[execution]} onInspect={vi.fn()} /></MemoryRouter>);
}

describe('AgentBoard failed worker slots', () => {
  afterEach(cleanup);

  it('shows each spawn-failed slot with its reason on the Squad card', () => {
    renderBoard({ ...base, failedWorkers: [{ slotId: 'e2e-worker:1', reason: 'injected worker spawn fault' }] });
    expect(screen.getByTestId('squad-failed-workers-exec-1')).toBeTruthy();
    expect(screen.getByTestId('squad-failed-worker-e2e-worker:1')).toBeTruthy();
    expect(screen.getByTestId('squad-failed-worker-reason-e2e-worker:1').textContent).toContain('injected worker spawn fault');
  });

  it('caps the visible rows and counts the rest', () => {
    renderBoard({ ...base, failedWorkers: Array.from({ length: 8 }, (_, i) => ({ slotId: `w${i}`, reason: 'boom' })) });
    expect(screen.getAllByTestId(/^squad-failed-worker-w\d$/)).toHaveLength(5);
    expect(screen.getByText('+3 more failed')).toBeTruthy();
  });

  it('renders nothing when no slot failed', () => {
    renderBoard(base);
    expect(screen.queryByTestId('squad-failed-workers-exec-1')).toBeNull();
  });
});
