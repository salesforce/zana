// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Goal } from '@zana-ai/zcc-domain/product';
import { useData, useGoals } from '@/store';
import { GoalsPanel } from './GoalsPanel';

const NOW = Date.parse('2026-10-10T00:00:00.000Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps iteration "Nm ago" labels moving without a list change', () => {
  const at = new Date(NOW - 30_000).toISOString();
  const goal = {
    id: 'g1', projectId: 'p1', title: 'Ship the fix', statement: 'Ship it', successCriteria: [],
    cadence: { mode: 'manual-approve' }, assignment: { kind: 'profile', profile: 'claude' }, maxIterations: 5, iteration: 1, noProgressLimit: 3, status: 'paused',
    history: { retain: 10, iterations: [{ id: 'i1', at, verdict: 'pass' }] }, createdAt: at, updatedAt: at
  } as unknown as Goal;
  useData.setState({ projects: [{ id: 'p1', name: 'Project', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0 }] as never });
  useGoals.setState({ goals: [goal], loading: false });
  render(<GoalsPanel />);
  fireEvent.click(screen.getByText('Ship the fix'));
  expect(screen.getByText('30s ago')).toBeTruthy();
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(screen.getByText('1m ago')).toBeTruthy();
});
