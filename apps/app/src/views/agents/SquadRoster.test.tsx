/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SquadFlowNode } from '@zana-ai/zcc-domain/product';
import { SquadMemberDetails, SquadRoster } from './SquadRoster';

afterEach(cleanup);

function member(overrides: Partial<SquadFlowNode> = {}): SquadFlowNode {
  return {
    sessionId: 'worker', label: 'Build worker', inspectionTarget: { type: 'terminal', id: 'worker' },
    state: 'idle', liveSubagents: 0, exited: false, isOrchestrator: false, ...overrides
  };
}

it('shows time since a claim and passes the selected member and focus target to the inspector', () => {
  const worker = member({ claim: { claimedAt: 1_000 }, stateSince: 2_000 });
  const onSelect = vi.fn();
  render(<SquadRoster nodes={[worker]} now={6_000} selectedId="worker" onSelect={onSelect} />);
  const row = screen.getByRole('button', { name: /Build worker.*5s ago.*Assigned/ });
  expect(row.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(row);
  expect(onSelect).toHaveBeenCalledWith(worker, row);
});

it('offers terminal and close controls for a connected member', () => {
  const worker = member({ liveSubagents: 2, stateSince: 2_000 });
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(<SquadMemberDetails node={worker} now={6_000} onOpen={onOpen} onClose={onClose} onInspectExecution={vi.fn()} />);
  expect(screen.getByText('2 active sub-agents')).toBeTruthy();
  expect(screen.getByText('4s ago')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Squad details' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }));
  expect(onOpen).toHaveBeenCalledWith(worker);
  fireEvent.click(screen.getByRole('button', { name: 'Close agent details' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('shows the question and Squad action for a detached worker whose terminal is unavailable', () => {
  const worker = member({
    state: 'blocked', detached: true, exited: true, stateSince: 2_000, liveSubagents: 1,
    job: { executionId: 'run', needsAttention: true, blockerQuestion: 'Use the release branch?' }
  });
  const onInspectExecution = vi.fn();
  render(<SquadMemberDetails node={worker} now={6_000} onOpen={vi.fn()} onClose={vi.fn()} onInspectExecution={onInspectExecution} />);
  expect(screen.getByText('1 active sub-agent')).toBeTruthy();
  expect(screen.getByText('Use the release branch?')).toBeTruthy();
  expect(screen.queryByText(/ago/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open terminal' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Squad details' }));
  expect(onInspectExecution).toHaveBeenCalledWith('run');
});
