import { describe, expect, it } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import type { AgentCard } from './AgentBoard.js';
import type { ThreadListItem } from '../thread-store.js';
import {
  agentFleetItem,
  fleetMatchesLane,
  fleetThreadLane,
  resolveMonitorSelection,
  threadFleetItem,
  RAIL_IDLE_THREAD_LIMIT,
  railThreadsForProject,
  threadCardRuntimeLabel,
  threadCardShowsProject,
  threadHarnessLabel,
  threadIsLiveForRail,
  threadRailDetail,
  threadRailStatus
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
