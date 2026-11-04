// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {}, threads: {} } }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes } from './AgentBoard.js';
import { scheduleFleetItem } from './fleet-item.js';
import { useData } from '../store.js';

const sched = (enabled: boolean, nextRunAt?: string) => scheduleFleetItem(
  { id: 's1', name: 'Nightly digest', projectId: 'p', enabled, schedule: { every: '1h' }, status: { runCount: 0, runs: [], nextRunAt } } as unknown as ScheduledTask,
  { name: 'proj' }
);

describe('AgentBoard schedule card', () => {
  beforeEach(() => { useData.setState({ projects: [], terminals: {}, includeScheduledAgentsInAgentView: true }); });
  afterEach(cleanup);

  it('badges a disabled schedule Off', () => {
    render(<MemoryRouter><AgentBoardLanes cards={[sched(false)]} onInspect={vi.fn()} /></MemoryRouter>);
    const card = screen.getByText('Nightly digest').closest('.agent-card') as HTMLElement;
    expect(card.querySelector('.agent-card-badge')?.textContent).toBe('Off');
    expect(card.textContent).not.toContain('Paused');
  });

  it('shows the next run, not Off, for an enabled schedule', () => {
    render(<MemoryRouter><AgentBoardLanes cards={[sched(true, new Date(Date.now() + 3_600_000).toISOString())]} onInspect={vi.fn()} /></MemoryRouter>);
    const card = screen.getByText('Nightly digest').closest('.agent-card') as HTMLElement;
    expect(card.querySelector('.sched-next')?.textContent).toContain('next');
    expect(card.textContent).not.toContain('Off');
  });

  it('shows no badge for an enabled schedule without a next run', () => {
    render(<MemoryRouter><AgentBoardLanes cards={[sched(true)]} onInspect={vi.fn()} /></MemoryRouter>);
    const card = screen.getByText('Nightly digest').closest('.agent-card') as HTMLElement;
    expect(card.querySelector('.agent-card-badge')).toBeNull();
  });
});
