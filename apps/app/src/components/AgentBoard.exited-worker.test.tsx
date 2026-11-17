// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {}, threads: { notificationLevel: () => Promise.reject(new Error('unavailable')) } } }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes, type AgentCard } from './AgentBoard.js';
import { agentFleetItem } from './fleet-item.js';
import { useData } from '../store.js';

// REQ-21: an exited non-zero Squad worker keeps its card until dismissed, shows spawn-failed, and the dismissal persists.
const NOW = new Date('2026-11-17T10:00:00Z').getTime();

const worker = (over: Partial<TerminalSession> & { squad?: boolean } = {}): AgentCard => {
  const { squad = true, ...rest } = over;
  const session = {
    id: 'w1', title: 'Builder worker', status: 'exited', profile: 'claude', createdAt: NOW - 600_000, finishedAt: NOW - 300_000, exitCode: 1,
    ...(squad ? { cohort: { cohortId: 'c1', teamId: 'team', teamName: 'Team', role: 'worker', slotLabel: 'Builder worker' } } : {}),
    ...rest
  } as TerminalSession;
  return { session, projectId: 'p', projectName: 'P', state: 'idle', liveSubagents: 0 } as AgentCard;
};

const board = (cards: AgentCard[]) => (
  <MemoryRouter><AgentBoardLanes cards={cards.map((card) => agentFleetItem(card))} onInspect={vi.fn()} /></MemoryRouter>
);

describe('exited Squad worker card (REQ-21)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    useData.setState({ projects: [], terminals: {} } as never);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('keeps a non-zero exited Squad worker card past 60 seconds', () => {
    render(board([worker()]));
    expect(screen.queryByText('Builder worker')).not.toBeNull();
  });

  it('renders the spawn-failed process state on the card', () => {
    render(board([worker({ process: 'spawn-failed' } as never)]));
    expect(screen.getByText('Builder worker').closest('.agent-card')?.textContent).toMatch(/spawn.failed|failed to start/i);
  });

  it('removes the card when dismissed and keeps it removed on re-render', () => {
    const { rerender } = render(board([worker()]));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('Builder worker')).toBeNull();
    rerender(board([worker()]));
    expect(screen.queryByText('Builder worker')).toBeNull();
  });

  it('still auto-dismisses a clean (exit 0) Squad worker after the linger window (existing-user path)', () => {
    render(board([worker({ exitCode: 0 })]));
    expect(screen.queryByText('Builder worker')).toBeNull();
  });

  it('still auto-dismisses a non-zero exit from a session that is not a Squad worker (existing-user path)', () => {
    render(board([worker({ squad: false })]));
    expect(screen.queryByText('Builder worker')).toBeNull();
  });
});
