// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ configSet: vi.fn(async () => ({})), dismiss: vi.fn(async () => ({})) }));
vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {}, threads: {}, config: { set: h.configSet, dismissWorkerExit: h.dismiss } } }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes } from './AgentBoard.js';
import { agentFleetItem } from './fleet-item.js';
import { useData, useUi } from '../store.js';

const OLD = Date.now() - 10 * 60_000;
const worker = (over: Partial<TerminalSession> = {}) => agentFleetItem({
  projectId: 'p', projectName: 'proj', state: 'idle',
  session: {
    id: 'w1', title: 'Worker One', profile: 'claude', status: 'exited', exitCode: 1, createdAt: OLD - 1000, finishedAt: OLD,
    cohort: { cohortId: 'c', teamId: 't', teamName: 'Team', role: 'worker', slotId: 'slot-1' },
    ...over
  } as TerminalSession
});
const board = (items = [worker()]) => <MemoryRouter><AgentBoardLanes cards={items} onInspect={vi.fn()} /></MemoryRouter>;

describe('exited Squad worker cards', () => {
  beforeEach(() => {
    h.configSet.mockClear();
    h.dismiss.mockClear();
    useData.setState({ projects: [], terminals: {}, includeScheduledAgentsInAgentView: false });
    useUi.setState({ dismissedWorkerExits: [] });
  });
  afterEach(cleanup);

  it('keeps a non-zero exited worker past the finished-linger window until dismissed, and persists the dismissal', () => {
    const view = render(board());
    expect(screen.getByText('Worker One')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss exited worker/ }));
    expect(h.dismiss).toHaveBeenCalledWith('w1');
    expect(h.configSet).not.toHaveBeenCalled();
    view.rerender(board());
    expect(screen.queryByText('Worker One')).toBeNull();
  });

  it('dismissing twice persists once', () => {
    useUi.getState().dismissWorkerExit('w1');
    useUi.getState().dismissWorkerExit('w1');
    expect(h.dismiss).toHaveBeenCalledTimes(1);
    expect(useUi.getState().dismissedWorkerExits).toEqual(['w1']);
  });

  it('caps the persisted list at the newest 200 ids', () => {
    useUi.setState({ dismissedWorkerExits: Array.from({ length: 200 }, (_, i) => `s${i}`) });
    useUi.getState().dismissWorkerExit('new');
    const ids = useUi.getState().dismissedWorkerExits;
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe('s1');
    expect(ids[199]).toBe('new');
    expect(h.dismiss).toHaveBeenCalledExactlyOnceWith('new');
  });

  it('lets a clean exit and a non-Squad exit age out as before', () => {
    render(board([worker({ exitCode: 0 }), worker({ id: 'solo', title: 'Solo', cohort: undefined })]));
    expect(screen.queryByText('Worker One')).toBeNull();
    expect(screen.queryByText('Solo')).toBeNull();
  });

  it('stays hidden when the dismissal was persisted before this render', () => {
    useUi.setState({ dismissedWorkerExits: ['w1'] });
    render(board());
    expect(screen.queryByText('Worker One')).toBeNull();
  });
});
