// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FollowUp } from '@zana-ai/zcc-domain/product';
import { useData, useFollowUps } from '@/store';
import { FollowUpsView } from './FollowUpsView';

const NOW = Date.parse('2026-10-10T00:00:00.000Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps "Nm ago" labels moving without a list change', () => {
  const at = new Date(NOW - 30_000).toISOString();
  const followUp = { id: 'f1', projectId: 'p1', title: 'Pick a deployment path', kind: 'question', status: 'open', origin: { source: 'agent' }, createdAt: at, updatedAt: at } as FollowUp;
  useData.setState({ projects: [{ id: 'p1', name: 'Project', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0 }] as never });
  useFollowUps.setState({ followups: [followUp], loading: false });
  render(<FollowUpsView />);
  expect(screen.getByText('30s ago')).toBeTruthy();
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(screen.getByText('1m ago')).toBeTruthy();
});
