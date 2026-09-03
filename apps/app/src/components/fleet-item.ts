import type { AgentState, ScheduledTask } from '@zana-ai/zcc-domain/product';
import type { AgentCard, LaneKey } from './AgentBoard.js';
import type { ThreadListItem } from '../thread-store.js';
import { threadStatusToAgentState } from './thread/thread-timeline-model.js';

export type FleetKind = 'agent' | 'thread' | 'schedule';

/** Compact kind word for rail subtitles and chips. */
export function fleetKindLabel(kind: FleetKind): string {
  if (kind === 'thread') return 'Thread';
  if (kind === 'schedule') return 'Schedule';
  return 'CLI Agent';
}

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
    }
  | {
      kind: 'schedule';
      id: string;
      state: AgentState;
      title: string;
      projectId: string;
      projectName: string;
      projectColor?: string;
      task: ScheduledTask;
    };

export function isVisibleThread(thread: ThreadListItem): boolean {
  return !thread.archivedAt;
}

export function threadTitle(thread: Pick<ThreadListItem, 'title'>): string {
  return thread.title ?? 'Untitled agent';
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
    state: threadStatusToAgentState(thread.status, thread.hasPendingInteraction, thread.activity),
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

export function isScheduleFleet(item: FleetItem): item is Extract<FleetItem, { kind: 'schedule' }> {
  return item.kind === 'schedule';
}

export function fleetAgentCards(items: FleetItem[]): AgentCard[] {
  return items.filter(isAgentFleet).map((item) => item.card);
}

export function scheduleFleetItem(
  task: ScheduledTask,
  project?: { name: string; color?: string }
): Extract<FleetItem, { kind: 'schedule' }> {
  return {
    kind: 'schedule',
    id: task.id,
    state: task.enabled ? 'idle' : 'done',
    title: task.name,
    projectId: task.projectId,
    projectName: project?.name ?? 'Unknown',
    projectColor: project?.color,
    task
  };
}

/**
 * Armed (and paused) jobs for the Agents board Scheduled column. Empty unless
 * the user opted schedules into Agent View — the column is hidden otherwise,
 * and dropping these items would leave them matching no visible lane.
 */
export function schedulesForAgentView(
  tasks: readonly ScheduledTask[],
  projects: readonly { id: string; name: string; color?: string }[],
  includeScheduled: boolean,
  scopedProjectId?: string
): Extract<FleetItem, { kind: 'schedule' }>[] {
  if (!includeScheduled) return [];
  const byProjectId = new Map(projects.map((p) => [p.id, p]));
  const out: Extract<FleetItem, { kind: 'schedule' }>[] = [];
  for (const task of tasks) {
    if (scopedProjectId && task.projectId !== scopedProjectId) continue;
    out.push(scheduleFleetItem(task, byProjectId.get(task.projectId)));
  }
  return out;
}

/** Wall-clock of the next fire, or Infinity when unarmed / unparseable. */
export function scheduleNextRunAt(task: Pick<ScheduledTask, 'enabled' | 'status'>): number {
  if (!task.enabled) return Infinity;
  const ts = task.status?.nextRunAt ? Date.parse(task.status.nextRunAt) : NaN;
  return Number.isNaN(ts) ? Infinity : ts;
}

export function compareScheduleFleet(
  a: Extract<FleetItem, { kind: 'schedule' }>,
  b: Extract<FleetItem, { kind: 'schedule' }>
): number {
  if (a.task.enabled !== b.task.enabled) return a.task.enabled ? -1 : 1;
  const byRun = scheduleNextRunAt(a.task) - scheduleNextRunAt(b.task);
  if (byRun !== 0) return byRun;
  return a.title.localeCompare(b.title);
}

/** Nested Projects-rail rows: busy, waiting, or failed threads. */
export function threadIsLiveForRail(thread: ThreadListItem): boolean {
  if (!isVisibleThread(thread)) return false;
  if (thread.status === 'error') return true;
  const state = threadStatusToAgentState(thread.status, thread.hasPendingInteraction, thread.activity);
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

export type ThreadRailStatus = 'Needs you' | 'Working' | 'Idle' | 'Error';

export function threadRailStatus(
  thread: Pick<ThreadListItem, 'status' | 'hasPendingInteraction' | 'activity'>
): ThreadRailStatus {
  if (thread.status === 'error') return 'Error';
  const state = threadStatusToAgentState(thread.status, thread.hasPendingInteraction, thread.activity);
  if (state === 'blocked') return 'Needs you';
  if (state === 'working') return 'Working';
  return 'Idle';
}

/** Tone class for the rail status word. Idle stays muted; Working pulses gold. */
export function threadRailStatusClass(status: ThreadRailStatus): string | undefined {
  if (status === 'Needs you' || status === 'Error') return 'agents-row-needs-you';
  if (status === 'Working') return 'agents-row-working';
  return undefined;
}

/** Tone class for a PTY agent's rail state word. Mirrors {@link threadRailStatusClass}. */
export function agentRowStateClass(state: AgentState, exited: boolean): string | undefined {
  if (exited) return undefined;
  if (state === 'blocked') return 'agents-row-needs-you';
  if (state === 'working') return 'agents-row-working';
  return undefined;
}

export function threadRailDetail(
  thread: Pick<ThreadListItem, 'status' | 'hasPendingInteraction' | 'activity'>
): string {
  const status = threadRailStatus(thread);
  if (
    status === 'Working'
    && (thread.activity?.activeBackgroundCommandCount ?? 0) > 0
    && thread.status !== 'starting'
    && thread.status !== 'active'
    && thread.status !== 'stopping'
  ) {
    return 'Working · background command';
  }
  return `${status} · ${fleetKindLabel('thread')}`;
}

/** Humanize a thread provider id (`claude-code` → `Claude Code`, `acp-cursor` → `Cursor`). */
export function threadHarnessLabel(providerId: string): string {
  if (providerId === 'acp-opencode' || providerId === 'opencode') return 'OpenCode';
  const trimmed = providerId.replace(/^acp-/, '');
  const label = trimmed
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return label || providerId;
}

/** Runtime + harness line for a board card (replaces the redundant project name). */
export function threadCardRuntimeLabel(
  thread: Pick<ThreadListItem, 'providerId' | 'isWorktree'>,
  remoteToolProxy = false
): string {
  const harness = threadHarnessLabel(thread.providerId);
  const runtime = remoteToolProxy
    ? 'Local agent · remote tools'
    : thread.isWorktree ? 'This checkout' : 'Local';
  return `${harness} · ${runtime}`;
}

export function threadCardShowsProject(showProject: boolean, grouped: boolean): boolean {
  return showProject && !grouped;
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
  if (item.kind === 'schedule') return lane === 'scheduled';
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
    // A picked row that is missing from this snapshot must not fall through to
    // items[0] (usually a WORKING agent) — that remounts ThreadDetail and can
    // re-enter a render loop.
    return items.find((item) => item.id === pickedId) ?? null;
  }
  if (storeSelection) {
    const pty = items.find(
      (item) => item.kind === 'agent' && item.card.session.id === storeSelection.sessionId
    );
    if (pty) return pty;
  }
  return items[0] ?? null;
}
