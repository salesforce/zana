import { describe, expect, it } from 'vitest';
import type { AgentCard } from './AgentBoard.js';
import type { ThreadListItem } from '../thread-store.js';
import { agentFleetItem, threadFleetItem, type FleetItem } from './fleet-item.js';
import {
  OTHER_PROJECTS_KEY,
  applyMonitorFilter,
  fleetItemActivityAt,
  formatAge,
  isUnreadFleetItem,
  sectionByProject,
  sortByRecent
} from './agent-monitor-list.js';

function thread(id: string, projectId: string, extra: Partial<ThreadListItem> = {}): FleetItem {
  return threadFleetItem(
    { id, projectId, title: id, status: 'idle', providerId: 'fake', createdAt: 1, ...extra } as ThreadListItem,
    { name: `Project ${projectId}`, color: `#${projectId}` }
  );
}

function agent(id: string, projectId: string, session: Record<string, unknown> = {}): FleetItem {
  return agentFleetItem({
    projectId,
    projectName: `Project ${projectId}`,
    state: 'idle',
    session: { id, projectId, profile: 'claude', title: id, status: 'running', cwd: '/tmp', createdAt: 10, ...session }
  } as unknown as AgentCard);
}

const schedule = { kind: 'schedule', id: 's', state: 'idle', title: 's', projectId: 'a', projectName: 'A' } as FleetItem;

describe('isUnreadFleetItem / applyMonitorFilter', () => {
  it('only counts threads with unseen sequence numbers', () => {
    const unread = thread('u', 'a', { lastReadSeq: 1, maxSeq: 3 });
    const read = thread('r', 'a', { lastReadSeq: 3, maxSeq: 3 });
    expect(isUnreadFleetItem(unread)).toBe(true);
    expect(isUnreadFleetItem(read)).toBe(false);
    expect(isUnreadFleetItem(agent('x', 'a'))).toBe(false);
    expect(isUnreadFleetItem(schedule)).toBe(false);
    expect(applyMonitorFilter([unread, read, agent('x', 'a')], 'unread').map((i) => i.id)).toEqual(['u']);
    expect(applyMonitorFilter([unread, read], 'all').map((i) => i.id)).toEqual(['u', 'r']);
  });
});

describe('fleetItemActivityAt', () => {
  it('uses thread updatedAt, falling back to createdAt', () => {
    expect(fleetItemActivityAt(thread('t', 'a', { updatedAt: 50 }))).toBe(50);
    expect(fleetItemActivityAt(thread('t', 'a'))).toBe(1);
  });

  it('uses the latest keystroke for live agents and finish time for exited ones', () => {
    expect(fleetItemActivityAt(agent('a', 'a', { lastInputAt: 99 }))).toBe(99);
    expect(fleetItemActivityAt(agent('a', 'a'))).toBe(10);
    expect(fleetItemActivityAt(agent('a', 'a', { status: 'exited', finishedAt: 70 }))).toBe(70);
    expect(fleetItemActivityAt(agent('a', 'a', { status: 'exited' }))).toBe(10);
  });

  it('has no activity time for schedules', () => {
    expect(fleetItemActivityAt(schedule)).toBeUndefined();
  });
});

describe('formatAge', () => {
  it('renders compact relative ages', () => {
    expect(formatAge(-5)).toBe('now');
    expect(formatAge(59_000)).toBe('now');
    expect(formatAge(4 * 60_000)).toBe('4m');
    expect(formatAge(2 * 3_600_000 + 5 * 60_000)).toBe('2h');
    expect(formatAge(3 * 86_400_000)).toBe('3d');
  });
});

describe('sortByRecent', () => {
  it('orders newest first, sinks undated items and keeps ties stable', () => {
    const items = [
      thread('old', 'a', { updatedAt: 10 }),
      schedule,
      thread('new', 'b', { updatedAt: 30 }),
      thread('tie1', 'a', { updatedAt: 20 }),
      thread('tie2', 'b', { updatedAt: 20 })
    ];
    expect(sortByRecent(items).map((i) => i.id)).toEqual(['new', 'tie1', 'tie2', 'old', 's']);
  });
});

describe('sectionByProject', () => {
  it('needs no sub-headers for a single project', () => {
    expect(sectionByProject([thread('1', 'a'), thread('2', 'a')])).toBeNull();
    expect(sectionByProject([])).toBeNull();
  });

  it('needs no sub-headers when every project has one item', () => {
    expect(sectionByProject([thread('1', 'a'), thread('2', 'b'), thread('3', 'c')])).toBeNull();
  });

  it('keeps a lone singleton under its own header', () => {
    const sections = sectionByProject([thread('1', 'a'), thread('2', 'b'), thread('3', 'a')]);
    expect(sections?.map((s) => [s.key, s.label, s.color, s.items.map((i) => i.id)])).toEqual([
      ['a', 'Project a', '#a', ['1', '3']],
      ['b', 'Project b', '#b', ['2']]
    ]);
  });

  it('folds two or more singletons into a trailing Other projects bucket', () => {
    const sections = sectionByProject([
      thread('1', 'c'),
      thread('2', 'a'),
      thread('3', 'b'),
      thread('4', 'a'),
      thread('5', 'd')
    ]);
    expect(sections?.map((s) => [s.key, s.projectId, s.items.map((i) => i.id)])).toEqual([
      ['a', 'a', ['2', '4']],
      [OTHER_PROJECTS_KEY, null, ['1', '3', '5']]
    ]);
    expect(sections?.[1].label).toBe('Other projects');
  });
});
