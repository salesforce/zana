// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCard } from './AgentBoard.js';
import type { ThreadListItem } from '../thread-store.js';

const api = vi.hoisted(() => ({ write: vi.fn(), clearAgentBlocked: vi.fn(), stop: vi.fn(), archive: vi.fn(), close: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: {
  terminals: { write: api.write, clearAgentBlocked: api.clearAgentBlocked },
  threads: { stop: api.stop, archive: api.archive }
} }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes } from './AgentBoard.js';
import { agentFleetItem, threadFleetItem, type FleetItem } from './fleet-item.js';
import { agentBoardMoves, installAgentBoardMoves } from '../stores/agent-board-moves.js';
import { useData, useIdleTriage } from '../store.js';
import { useThreads } from '../thread-store.js';

const agent: AgentCard = {
  projectId: 'p', projectName: 'Project', state: 'working',
  session: { id: 'cli', projectId: 'p', profile: 'claude', title: 'CLI probe', status: 'running', cwd: '/tmp', createdAt: 1 }
};
const thread = { id: 'thread', projectId: 'p', title: 'Thread probe', status: 'active', providerId: 'codex', createdAt: 1 } as ThreadListItem;
const lane = (id: string) => document.querySelector(`[data-board-column="${id}"]`)!;
const card = (title: string) => screen.getByText(title).closest('button')!;
const transfer = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' });
let uninstall: () => void;
function setup(items: FleetItem[]) {
  return render(<MemoryRouter><AgentBoardLanes cards={items} onInspect={vi.fn()} /></MemoryRouter>);
}
async function drop(title: string, to: string) {
  const dataTransfer = transfer();
  fireEvent.dragStart(card(title), { dataTransfer });
  fireEvent.dragOver(lane(to), { dataTransfer });
  await act(async () => { fireEvent.drop(lane(to), { dataTransfer }); });
  return dataTransfer;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.write.mockResolvedValue(undefined);
  api.clearAgentBlocked.mockResolvedValue(true);
  api.stop.mockResolvedValue(undefined);
  api.archive.mockResolvedValue({ ok: true });
  api.close.mockResolvedValue(undefined);
  useData.setState({ terminals: { p: [agent.session] }, projects: [], closeTerminal: api.close, includeScheduledAgentsInAgentView: false });
  useThreads.setState({ threads: [thread] });
  uninstall = installAgentBoardMoves();
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.useRealTimers();
});

describe('agent board drag/drop', () => {
  it('highlights only a valid drop, interrupts CLI agents and clears triage for Idle', async () => {
    const clearTriage = vi.spyOn(useIdleTriage.getState(), 'clear');
    setup([agentFleetItem(agent)]);
    const dataTransfer = transfer();
    fireEvent.dragStart(card('CLI probe'), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-zcc-agent-card', 'agent:cli');
    expect(fireEvent.dragOver(lane('blocked'), { dataTransfer })).toBe(true);
    fireEvent.dragOver(lane('idle'), { dataTransfer });
    expect(lane('idle').classList.contains('is-drop-target')).toBe(true);
    fireEvent.dragLeave(lane('idle'), { relatedTarget: lane('done') });
    expect(lane('idle').classList.contains('is-drop-target')).toBe(false);
    await act(async () => { fireEvent.drop(lane('idle'), { dataTransfer }); });
    expect(api.write).toHaveBeenCalledExactlyOnceWith('cli', '\x03');
    expect(api.clearAgentBlocked).toHaveBeenCalledWith('p', 'cli');
    expect(clearTriage).toHaveBeenCalledWith('cli');
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.close).not.toHaveBeenCalled();
  });
  it('marks a CLI agent Done and closes it after a minute even after the board unmounts', async () => {
    const view = setup([agentFleetItem(agent)]);
    await drop('CLI probe', 'done');
    expect(lane('done').contains(card('CLI probe'))).toBe(true);
    expect(card('CLI probe').getAttribute('draggable')).toBe('false');
    expect(screen.getByText('Closes in 60s')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByText('Closes in 30s')).toBeTruthy();
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(29_999));
    expect(api.close).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(api.close).toHaveBeenCalledExactlyOnceWith('cli', 'p');
  });
  it('stops modern threads and archives them at the deadline', async () => {
    setup([threadFleetItem(thread)]);
    await drop('Thread probe', 'done');
    expect(api.stop).toHaveBeenCalledExactlyOnceWith('thread');
    expect(lane('done').contains(card('Thread probe'))).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.archive).toHaveBeenCalledExactlyOnceWith('thread');
    expect(useThreads.getState().threads).toEqual([]);
  });
  it('ignores Idle→Working, Idle→Needs you, and external drops', async () => {
    setup([agentFleetItem({ ...agent, state: 'idle' })]);
    for (const to of ['working', 'blocked']) await drop('CLI probe', to);
    fireEvent.drop(lane('done'), { dataTransfer: transfer() });
    expect(api.write).not.toHaveBeenCalled();
    expect(agentBoardMoves.store.getState().done).toEqual({});
  });
  it('ignores a drag that became exited before the drop', async () => {
    const view = setup([agentFleetItem(agent)]);
    fireEvent.dragStart(card('CLI probe'), { dataTransfer: transfer() });
    view.rerender(<MemoryRouter><AgentBoardLanes cards={[agentFleetItem({ ...agent, session: { ...agent.session, status: 'exited' } })]} onInspect={vi.fn()} /></MemoryRouter>);
    fireEvent.drop(lane('idle'), { dataTransfer: transfer() });
    expect(api.write).not.toHaveBeenCalled();
  });
  it('does not close an agent that was removed/restarted during the grace period', async () => {
    setup([agentFleetItem({ ...agent, state: 'idle' })]);
    await drop('CLI probe', 'done');
    expect(api.write).not.toHaveBeenCalled();
    act(() => useData.setState({ terminals: { p: [{ ...agent.session, createdAt: 2 }] } }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.close).not.toHaveBeenCalled();
  });
  it('does not archive a thread that was already removed', async () => {
    setup([threadFleetItem({ ...thread, status: 'idle' })]);
    await drop('Thread probe', 'done');
    act(() => useThreads.setState({ threads: [] }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.archive).not.toHaveBeenCalled();
  });
  it('keeps a thread available if archiving fails', async () => {
    api.archive.mockResolvedValueOnce({ ok: false });
    setup([threadFleetItem(thread)]);
    await drop('Thread probe', 'done');
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(useThreads.getState().threads).toEqual([thread]);
    expect(agentBoardMoves.store.getState().done).toEqual({});
  });
});
