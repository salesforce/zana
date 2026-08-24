import type { AgentState } from '@zana-ai/zcc-domain/product';
import type { AgentCard, LaneKey } from './AgentBoard.js';
import type { ThreadListItem } from '../thread-store.js';
import { threadStatusToAgentState } from './thread/thread-timeline-model.js';

export type FleetKind = 'agent' | 'thread';

export type FleetItem =
  | {
      kind: 'agent';
      id: string;
      state: AgentState;
      title: string;
      projectId: string;
      projectName: string;
      projectColor?: string;
      card: AgentCard;
    }
  | {
      kind: 'thread';
      id: string;
      state: AgentState;
      title: string;
      projectId: string;
      projectName: string;
      projectColor?: string;
      thread: ThreadListItem;
    };

export function isVisibleThread(thread: ThreadListItem): boolean {
  return !thread.archivedAt;
}

export function threadTitle(thread: Pick<ThreadListItem, 'title'>): string {
  return thread.title ?? 'Untitled thread';
}

export function agentFleetItem(card: AgentCard): Extract<FleetItem, { kind: 'agent' }> {
  return {
    kind: 'agent',
    id: card.session.id,
    state: card.state,
    title: card.session.title,
    projectId: card.projectId,
    projectName: card.projectName,
    projectColor: card.projectColor,
    card
  };
}

export function threadFleetItem(
  thread: ThreadListItem,
  project?: { name: string; color?: string }
): Extract<FleetItem, { kind: 'thread' }> {
  return {
    kind: 'thread',
    id: thread.id,
    state: threadStatusToAgentState(thread.status),
    title: threadTitle(thread),
    projectId: thread.projectId,
    projectName: project?.name ?? 'Unknown',
    projectColor: project?.color,
    thread
  };
}

export function isAgentFleet(item: FleetItem): item is Extract<FleetItem, { kind: 'agent' }> {
  return item.kind === 'agent';
}

export function isThreadFleet(item: FleetItem): item is Extract<FleetItem, { kind: 'thread' }> {
  return item.kind === 'thread';
}

export function fleetAgentCards(items: FleetItem[]): AgentCard[] {
  return items.filter(isAgentFleet).map((item) => item.card);
}

/** Nested Projects-rail rows: busy or failed threads, matching live PTY sessions. */
export function threadIsLiveForRail(thread: ThreadListItem): boolean {
  if (!isVisibleThread(thread)) return false;
  const state = threadStatusToAgentState(thread.status);
  return state === 'working' || state === 'blocked';
}

/** Recent idle threads to nest under a workspace after live ones. */
export const RAIL_IDLE_THREAD_LIMIT = 8;

/**
 * Workspace-rail thread rows for one project: live (busy/error) first, then a
 * bounded slice of idle conversations so the tree stays a glanceable history
 * after the Agents collection left the sidebar.
 */
export function railThreadsForProject(threads: ThreadListItem[]): ThreadListItem[] {
  const live: ThreadListItem[] = [];
  const idle: ThreadListItem[] = [];
  for (const thread of threads) {
    if (!isVisibleThread(thread)) continue;
    if (threadIsLiveForRail(thread)) live.push(thread);
    else idle.push(thread);
  }
  return [...live, ...idle.slice(0, RAIL_IDLE_THREAD_LIMIT)];
}

export function threadRailDetail(thread: Pick<ThreadListItem, 'status'>): string {
  const state = threadStatusToAgentState(thread.status);
  if (state === 'blocked') return 'Needs you · Thread';
  if (state === 'working') return 'Working · Thread';
  return 'Idle · Thread';
}

export function fleetThreadLane(item: Extract<FleetItem, { kind: 'thread' }>): LaneKey {
  if (item.state === 'blocked') return 'blocked';
  if (item.state === 'working') return 'working';
  return 'idle';
}

export function fleetMatchesLane(
  item: FleetItem,
  lane: LaneKey,
  matchAgent: (card: AgentCard) => boolean
): boolean {
  if (item.kind === 'thread') return fleetThreadLane(item) === lane;
  return matchAgent(item.card);
}

export function groupFleetByProject(items: FleetItem[]): Array<{
  projectId: string;
  projectName: string;
  projectColor?: string;
  cards: FleetItem[];
}> {
  const groups: Array<{
    projectId: string;
    projectName: string;
    projectColor?: string;
    cards: FleetItem[];
  }> = [];
  const byId = new Map<string, (typeof groups)[number]>();
  for (const item of items) {
    let group = byId.get(item.projectId);
    if (!group) {
      group = {
        projectId: item.projectId,
        projectName: item.projectName,
        projectColor: item.projectColor,
        cards: []
      };
      byId.set(item.projectId, group);
      groups.push(group);
    }
    group.cards.push(item);
  }
  return groups;
}

export function resolveMonitorSelection(
  items: FleetItem[],
  storeSelection: { sessionId: string; projectId: string } | null,
  pickedId: string | null
): FleetItem | null {
  if (pickedId) {
    const found = items.find((item) => item.id === pickedId);
    if (found) return found;
  }
  if (storeSelection) {
    const pty = items.find(
      (item) => item.kind === 'agent' && item.card.session.id === storeSelection.sessionId
    );
    if (pty) return pty;
  }
  return items[0] ?? null;
}
