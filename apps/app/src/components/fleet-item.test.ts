import { describe, expect, it } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import type { AgentCard } from './AgentBoard.js';
import type { ThreadListItem } from '../thread-store.js';
import {
  agentFleetItem,
  agentRowStateClass,
  compareScheduleFleet,
  fleetKindLabel,
  fleetMatchesLane,
  fleetThreadLane,
  resolveMonitorSelection,
  scheduleFleetItem,
  scheduleNextRunAt,
  schedulesForAgentView,
  threadFleetItem,
  RAIL_IDLE_THREAD_LIMIT,
  railThreadsForProject,
  threadCardRuntimeLabel,
  threadCardShowsProject,
  threadHarnessLabel,
  threadIsLiveForRail,
  threadRailDetail,
  threadRailStatus,
  threadRailStatusClass
} from './fleet-item.js';

function thread(over: Partial<ThreadListItem> & Pick<ThreadListItem, 'id' | 'status'>): ThreadListItem {
  return {
    projectId: 'p1',
    hostId: 'h1',
    environmentId: null,
    providerId: 'claude-code',
    title: 'Read README',
    createdAt: 1,
    cwd: null,
    branchName: null,
    isWorktree: false,
    ...over
  };
}

function card(): AgentCard {
  return {
    session: { id: 's1', title: 'PTY agent', status: 'running', profile: 'claude' } as unknown as TerminalSession,
    state: 'working',
    projectId: 'p1',
    projectName: 'Alpha'
  };
}

describe('fleet items', () => {
  it('maps an armed schedule into the Scheduled lane and hides it when the setting is off', () => {
    const task = {
      id: 'job-1',
      name: 'Nightly',
      enabled: true,
      projectId: 'p1',
      status: { nextRunAt: new Date(Date.now() + 60_000).toISOString() }
    } as import('@zana-ai/zcc-domain/product').ScheduledTask;
    const item = scheduleFleetItem(task, { name: 'Alpha', color: '#abc' });
    expect(item.kind).toBe('schedule');
    expect(item.title).toBe('Nightly');
    expect(item.projectName).toBe('Alpha');
    expect(fleetKindLabel('schedule')).toBe('Schedule');
    expect(fleetMatchesLane(item, 'scheduled', () => false)).toBe(true);
    expect(fleetMatchesLane(item, 'idle', () => false)).toBe(false);
    expect(schedulesForAgentView([task], [{ id: 'p1', name: 'Alpha' }], false)).toEqual([]);
    expect(schedulesForAgentView([task], [{ id: 'p1', name: 'Alpha' }], true).map((row) => row.id)).toEqual([
      'job-1'
    ]);
    expect(schedulesForAgentView([task], [{ id: 'p1', name: 'Alpha' }], true, 'other')).toEqual([]);
  });

  it('sorts armed schedules before paused, then by next fire', () => {
    const later = scheduleFleetItem({
      id: 'later',
      name: 'B',
      enabled: true,
      projectId: 'p1',
      status: { nextRunAt: '2099-01-02T00:00:00.000Z' }
    } as import('@zana-ai/zcc-domain/product').ScheduledTask);
    const sooner = scheduleFleetItem({
      id: 'sooner',
      name: 'A',
      enabled: true,
      projectId: 'p1',
      status: { nextRunAt: '2099-01-01T00:00:00.000Z' }
    } as import('@zana-ai/zcc-domain/product').ScheduledTask);
    const paused = scheduleFleetItem({
      id: 'off',
      name: 'Z',
      enabled: false,
      projectId: 'p1',
      status: { nextRunAt: '2099-01-01T00:00:00.000Z' }
    } as import('@zana-ai/zcc-domain/product').ScheduledTask);
    expect([paused, later, sooner].sort(compareScheduleFleet).map((row) => row.id)).toEqual([
      'sooner',
      'later',
      'off'
    ]);
    expect(scheduleNextRunAt(paused.task)).toBe(Infinity);
  });
  it('maps an active thread into the Working lane', () => {
    const item = threadFleetItem(thread({ id: 't1', status: 'active' }), { name: 'Alpha' });
    expect(item.kind).toBe('thread');
    expect(item.state).toBe('working');
    expect(fleetThreadLane(item)).toBe('working');
    expect(fleetMatchesLane(item, 'working', () => false)).toBe(true);
    expect(fleetMatchesLane(item, 'idle', () => false)).toBe(false);
  });

  it('maps idle and error threads onto Idle, not Needs you', () => {
    expect(fleetThreadLane(threadFleetItem(thread({ id: 't1', status: 'idle' })))).toBe('idle');
    expect(fleetThreadLane(threadFleetItem(thread({ id: 't1', status: 'error' })))).toBe('idle');
  });

  it('treats busy and failed threads as live for the Projects rail', () => {
    expect(threadIsLiveForRail(thread({ id: 't1', status: 'active' }))).toBe(true);
    expect(threadIsLiveForRail(thread({ id: 't1', status: 'error' }))).toBe(true);
    expect(threadIsLiveForRail(thread({ id: 't1', status: 'idle' }))).toBe(false);
    expect(threadIsLiveForRail(thread({ id: 't1', status: 'active', archivedAt: 9 }))).toBe(false);
  });

  it('nests live threads first, then a bounded idle history, and skips archived', () => {
    const rows = railThreadsForProject([
      thread({ id: 'archived', status: 'idle', archivedAt: 1 }),
      thread({ id: 'idle-a', status: 'idle' }),
      thread({ id: 'live', status: 'active' }),
      thread({ id: 'failed', status: 'error' }),
      ...Array.from({ length: 10 }, (_, i) => thread({ id: `idle-${i}`, status: 'idle' }))
    ]);
    expect(rows.map((row) => row.id).slice(0, 2)).toEqual(['live', 'failed']);
    expect(rows.some((row) => row.id === 'archived')).toBe(false);
    expect(rows.filter((row) => row.status === 'idle')).toHaveLength(RAIL_IDLE_THREAD_LIMIT);
    expect(threadRailDetail(thread({ id: 't1', status: 'error' }))).toBe('Error · Thread');
    expect(threadRailStatus(thread({ id: 't1', status: 'error' }))).toBe('Error');
    expect(threadRailStatus(thread({ id: 't1', status: 'error', hasPendingInteraction: true }))).toBe('Error');
    expect(threadRailDetail(thread({ id: 't1', status: 'active' }))).toBe('Working · Thread');
    expect(threadRailDetail(thread({ id: 't1', status: 'active', hasPendingInteraction: true }))).toBe('Needs you · Thread');
    expect(threadFleetItem(thread({ id: 't1', status: 'active', hasPendingInteraction: true })).state).toBe('blocked');
    expect(threadRailDetail(thread({ id: 't1', status: 'idle' }))).toBe('Idle · Thread');
    expect(fleetKindLabel('thread')).toBe('Thread');
    expect(fleetKindLabel('agent')).toBe('CLI Agent');
    expect(threadRailStatusClass('Working')).toBe('agents-row-working');
    expect(threadRailStatusClass('Error')).toBe('agents-row-needs-you');
    expect(threadRailStatusClass('Needs you')).toBe('agents-row-needs-you');
    expect(threadRailStatusClass('Idle')).toBeUndefined();
    expect(agentRowStateClass('working', false)).toBe('agents-row-working');
    expect(agentRowStateClass('blocked', false)).toBe('agents-row-needs-you');
    expect(agentRowStateClass('idle', false)).toBeUndefined();
    expect(agentRowStateClass('working', true)).toBeUndefined();
  });

  it('labels a thread card with harness and runtime instead of the project slug', () => {
    expect(threadHarnessLabel('claude-code')).toBe('Claude Code');
    expect(threadHarnessLabel('acp-cursor')).toBe('Cursor');
    expect(threadHarnessLabel('acp-opencode')).toBe('OpenCode');
    expect(threadHarnessLabel('codex')).toBe('Codex');
    expect(threadHarnessLabel('pi')).toBe('Pi');
    expect(threadHarnessLabel('custom-agent')).toBe('Custom Agent');
    expect(threadCardRuntimeLabel(thread({ id: 't1', status: 'idle' }))).toBe('Claude Code · Local');
    expect(threadCardRuntimeLabel(thread({ id: 't1', status: 'idle', isWorktree: true }))).toBe(
      'Claude Code · This checkout'
    );
    expect(threadCardRuntimeLabel(thread({ id: 't1', status: 'idle' }), true)).toBe(
      'Claude Code · Local agent · remote tools'
    );
    expect(threadCardShowsProject(true, true)).toBe(false);
    expect(threadCardShowsProject(true, false)).toBe(true);
    expect(threadCardShowsProject(false, false)).toBe(false);
  });

  it('never feeds a thread id to the PTY monitor selection store', () => {
    const items = [
      threadFleetItem(thread({ id: 't1', status: 'active' })),
      agentFleetItem(card())
    ];
    expect(resolveMonitorSelection(items, { sessionId: 's1', projectId: 'p1' }, null)?.kind).toBe('agent');
    expect(resolveMonitorSelection(items, null, 't1')?.kind).toBe('thread');
    expect(resolveMonitorSelection(items, { sessionId: 's1', projectId: 'p1' }, 't1')?.id).toBe('t1');
  });
});
