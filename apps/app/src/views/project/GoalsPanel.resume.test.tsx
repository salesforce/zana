// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalIteration } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ resumeIteration: vi.fn(), pushToast: vi.fn(), enterProjectFocus: vi.fn(), navigate: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { goals: { resumeIteration: h.resumeIteration }, teams: { list: vi.fn(async () => []) } } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));

import { useData, useGoals, useUi } from '@/store';
import { GoalsPanel } from './GoalsPanel';

const at = '2026-10-10T00:00:00.000Z';
const conversation = { profile: 'claude', id: 'conv-1', cwd: '/tmp/p1', startedAt: at } as const;
const iteration = (over: Partial<GoalIteration> = {}): GoalIteration =>
  ({ id: 'i1', at, sessionId: 's1', launchState: 'running', verdict: 'pass', finishedAt: at, conversation, ...over });
const goal = (iterations: GoalIteration[], over: Partial<Goal> = {}): Goal => ({
  id: 'g1', projectId: 'p1', title: 'Ship the fix', statement: 'Ship it', successCriteria: [],
  cadence: { mode: 'manual-approve' }, assignment: { kind: 'profile', profile: 'claude' }, maxIterations: 5, iteration: 1, noProgressLimit: 3,
  status: 'paused', history: { retain: 10, iterations }, createdAt: at, updatedAt: at, ...over
}) as unknown as Goal;

function show(g: Goal) {
  useData.setState({ projects: [{ id: 'p1', name: 'Project', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0 }] as never });
  useGoals.setState({ goals: [g], loading: false });
  render(<GoalsPanel />);
  fireEvent.click(screen.getByText('Ship the fix'));
}

beforeEach(() => {
  h.resumeIteration.mockReset(); h.navigate.mockReset();
  useUi.setState({ pushToast: h.pushToast, enterProjectFocus: h.enterProjectFocus } as never);
});
afterEach(() => cleanup());

describe('REQ-10 Resume on the Goals view', () => {
  it('shows exactly one Resume button, on the latest finished resumable iteration, and clicking reopens it', async () => {
    h.resumeIteration.mockResolvedValue({ ok: true, value: { session: { id: 'new-pty', projectId: 'p1' }, reused: false } });
    show(goal([iteration({ id: 'new' }), iteration({ id: 'old', conversation: { ...conversation, id: 'conv-0' } })]));
    const buttons = screen.getAllByRole('button', { name: 'Resume this run' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    await vi.waitFor(() => expect(h.resumeIteration).toHaveBeenCalledWith({ goalId: 'g1', iterationId: 'new' }));
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith(expect.stringContaining('new-pty')));
  });
  it('skips a newer iteration that is not finished or recorded no conversation', () => {
    show(goal([iteration({ id: 'running', finishedAt: undefined, verdict: undefined }), iteration({ id: 'old-format', conversation: undefined }), iteration({ id: 'good' })]));
    expect(screen.getAllByRole('button', { name: 'Resume this run' })).toHaveLength(1);
  });
  it('offers nothing for a Squad goal', () => {
    show(goal([iteration()], { assignment: { kind: 'team', teamId: 't1' } as never }));
    expect(screen.queryByRole('button', { name: 'Resume this run' })).toBeNull();
  });
  it('offers nothing for an old iteration without a conversation (REQ-12)', () => {
    show(goal([iteration({ conversation: undefined })]));
    expect(screen.queryByRole('button', { name: 'Resume this run' })).toBeNull();
  });
});
