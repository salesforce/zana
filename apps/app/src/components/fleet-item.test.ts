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
  groupFleetByProject,
  resolveMonitorSelection,
  scheduleFleetItem,
  scheduleNextRunAt,
  schedulesForAgentView,
  threadFleetItem,
  RAIL_IDLE_THREAD_LIMIT,
  railThreadsForProject,
  agentCardRuntimeLabel,
  cliHarnessLabel,
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
  it('keeps project order when the leading card closes, without changing within-project recency', () => {
    const items = [
      threadFleetItem(thread({ id: 'a-new', projectId: 'a', status: 'idle', createdAt: 5 }), { name: 'Alpha', color: '#abc' }),
      threadFleetItem(thread({ id: 'b-new', projectId: 'b', status: 'idle', createdAt: 4 }), { name: 'Beta' }),
      threadFleetItem(thread({ id: 'c', projectId: 'c', status: 'idle', createdAt: 3 }), { name: 'Gamma' }),
      threadFleetItem(thread({ id: 'b-old', projectId: 'b', status: 'idle', createdAt: 2 }), { name: 'Beta' }),
      threadFleetItem(thread({ id: 'a-old', projectId: 'a', status: 'idle', createdAt: 1 }), { name: 'Alpha', color: '#abc' })
    ];
    const order = ['a', 'b', 'c'];
    const groups = groupFleetByProject(items, order);
    expect(groups.map((group) => group.projectId)).toEqual(order);
    expect(groups[0]).toMatchObject({ projectName: 'Alpha', projectColor: '#abc' });
    expect(groups[0].cards.map((item) => item.id)).toEqual(['a-new', 'a-old']);
    expect(groupFleetByProject(items.filter((item) => item.id !== 'a-new'), order)
      .map((group) => group.projectId)).toEqual(order);
    expect(groupFleetByProject(items.filter((item) => item.projectId !== 'b'), order)
      .map((group) => group.projectId)).toEqual(['a', 'c']);
    expect(groupFleetByProject(items, ['c', 'b', 'a']).map((group) => group.projectId)).toEqual(['c', 'b', 'a']);
    expect(items.map((item) => item.id)).toEqual(['a-new', 'b-new', 'c', 'b-old', 'a-old']);
  });

  it('groups mixed kinds and gives missing projects a deterministic position after registered projects', () => {
    const cli = agentFleetItem(card());
    const job = scheduleFleetItem({ id: 'job', projectId: 'p1', name: 'Nightly', enabled: true } as import('@zana-ai/zcc-domain/product').ScheduledTask);
    const a = threadFleetItem(thread({ id: 'a', projectId: 'a', status: 'idle' }));
    const z = threadFleetItem(thread({ id: 'z', projectId: 'z', status: 'idle' }));
    const groups = groupFleetByProject([z, cli, a, job], ['empty-project', 'p1']);
    expect(groups.map((group) => group.projectId)).toEqual(['p1', 'a', 'z']);
    expect(groups[0].cards).toEqual([cli, job]);
    expect(groupFleetByProject([z, a], []).map((group) => group.projectId)).toEqual(['a', 'z']);
    expect(groupFleetByProject([], ['p1'])).toEqual([]);
  });

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

  it('treats leftover background commands as Working unless the thread is blocked', () => {
    const running = thread({
      id: 't1',
      status: 'idle',
      activity: {
        activeWorkflowCount: 0,
        activeBackgroundAgentCount: 0,
        activeBackgroundCommandCount: 1,
        activePlanModeCount: 0,
        activeGoalCount: 0
      }
    });
    expect(threadFleetItem(running).state).toBe('working');
    expect(fleetThreadLane(threadFleetItem(running))).toBe('working');
    expect(threadIsLiveForRail(running)).toBe(true);
    expect(threadRailStatus(running)).toBe('Working');
    expect(threadRailDetail(running)).toBe('Working · background command');
    expect(
      threadFleetItem({ ...running, hasPendingInteraction: true }).state
    ).toBe('blocked');
    expect(
      threadFleetItem({ ...running, status: 'error' }).state
    ).toBe('idle');
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
      'Claude Code · Worktree'
    );
    expect(threadCardRuntimeLabel(thread({ id: 't1', status: 'idle' }), true)).toBe(
      'Claude Code · Local agent · remote tools'
    );
    expect(threadCardRuntimeLabel(thread({ id: 't1', status: 'idle' }), false, true)).toBe(
      'Claude Code · Remote host'
    );
    expect(threadCardShowsProject(true, true)).toBe(false);
    expect(threadCardShowsProject(true, false)).toBe(true);
    expect(threadCardShowsProject(false, false)).toBe(false);
  });

  it('labels a CLI agent card with the same family name threads use', () => {
    expect(cliHarnessLabel('claude')).toBe('Claude Code');
    expect(cliHarnessLabel('claude-yolo')).toBe('Claude Code');
    expect(cliHarnessLabel('claude-resume')).toBe('Claude Code');
    expect(cliHarnessLabel('cursor')).toBe('Cursor');
    expect(cliHarnessLabel('codex')).toBe('Codex');
    expect(cliHarnessLabel('pi')).toBe('Pi');
    expect(cliHarnessLabel('opencode')).toBe('OpenCode');
    expect(cliHarnessLabel('grok')).toBe('Grok Build');
    expect(cliHarnessLabel('grok-yolo')).toBe('Grok Build');
    expect(cliHarnessLabel('mastracode')).toBe('Mastra Code');
    expect(cliHarnessLabel('mastracode-yolo')).toBe('Mastra Code');
    expect(agentCardRuntimeLabel({ profile: 'claude' })).toBe('Claude Code · Local');
    expect(agentCardRuntimeLabel({ profile: 'claude-yolo', remote: true })).toBe(
      'Claude Code · Remote host'
    );
    expect(agentCardRuntimeLabel({ profile: 'claude', remote: true, personaName: 'Reviewer' })).toBe(
      'Reviewer · Remote host'
    );
    expect(agentCardRuntimeLabel({ profile: 'claude', remote: true, remoteToolProxy: true })).toBe(
      'Claude Code · Local agent · remote tools'
    );
    expect(agentCardRuntimeLabel({ profile: 'claude', personaName: '  ' })).toBe('Claude Code · Local');
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

  it('keeps a missing picked row empty instead of snapping to the first fleet item', () => {
    const items = [
      agentFleetItem(card()),
      threadFleetItem(thread({ id: 't1', status: 'idle' }))
    ];
    expect(resolveMonitorSelection(items, { sessionId: 's1', projectId: 'p1' }, 'gone')).toBeNull();
    expect(resolveMonitorSelection(items, null, 'gone')).toBeNull();
    expect(resolveMonitorSelection(items, null, null)?.kind).toBe('agent');
  });
});
