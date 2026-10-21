import type {
  AgentState,
  CompanionAgent,
  CompanionRequest,
  CompanionSchedule,
  CompanionSnapshot
} from '@zana-ai/zcc-domain/product';

/**
 * Pure view-model helpers for the Command Center companion. Kept free of React
 * and the app store so the rail/panel windows stay thin and this is unit-tested.
 */

/** Same persist key + envelope `useInboxAnswered` (stores/live.ts) uses, so an
 *  answer given in the companion clears the in-app band (and vice versa) via
 *  the cross-window `storage` event. */
export const ANSWERED_STORAGE_KEY = 'zcc.inbox-answered.v1';

export type AnsweredIds = Record<string, true>;

export function readAnswered(storage: Pick<Storage, 'getItem'> | null | undefined): AnsweredIds {
  try {
    const raw = storage?.getItem(ANSWERED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { state?: { answeredIds?: unknown } };
    const ids = parsed?.state?.answeredIds;
    return ids && typeof ids === 'object' ? (ids as AnsweredIds) : {};
  } catch {
    return {};
  }
}

/** Merge one id into the persisted answered set; returns the new set. */
export function writeAnswered(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
  entryId: string
): AnsweredIds {
  const next = { ...readAnswered(storage), [entryId]: true as const };
  try {
    storage?.setItem(ANSWERED_STORAGE_KEY, JSON.stringify({ state: { answeredIds: next }, version: 1 }));
  } catch {
    // Storage full / disabled: the request still hides for this session.
  }
  return next;
}

/** Requests still waiting on the user: drop answered inbox entries and locally dismissed ids. */
export function pendingRequests(
  requests: CompanionRequest[],
  answered: AnsweredIds,
  dismissed: ReadonlySet<string>
): CompanionRequest[] {
  return requests.filter((r) => !dismissed.has(r.id) && !(r.entryId && answered[r.entryId]));
}

export interface AgentGroups {
  needsYou: CompanionAgent[];
  working: CompanionAgent[];
  idle: CompanionAgent[];
}

/** NEEDS YOU / WORKING / IDLE. An agent with a pending question counts as needing you. */
export function groupAgents(agents: CompanionAgent[], pending: CompanionRequest[]): AgentGroups {
  const asking = new Set(pending.map((r) => r.sessionId).filter(Boolean) as string[]);
  const groups: AgentGroups = { needsYou: [], working: [], idle: [] };
  for (const a of agents) {
    if (a.state === 'blocked' || a.state === 'waiting' || asking.has(a.sessionId)) groups.needsYou.push(a);
    else if (a.state === 'working') groups.working.push(a);
    else groups.idle.push(a);
  }
  return groups;
}

export type Indicator = 'attention' | 'working' | 'done' | null;

/** Rail indicators: red count on Needs You, aggregate dot on Agents / Scheduler. */
export function railIndicators(snapshot: CompanionSnapshot, pendingCount: number) {
  const agents: Indicator =
    pendingCount > 0 || snapshot.counts.blocked > 0
      ? 'attention'
      : snapshot.counts.working > 0
        ? 'working'
        : snapshot.counts.recentlyCompleted > 0
          ? 'done'
          : null;
  const scheduler: Indicator = snapshot.counts.runningSchedules > 0 ? 'working' : null;
  const status: Indicator = pendingCount > 0 ? 'attention' : snapshot.counts.working > 0 ? 'working' : 'done';
  return { needsYou: pendingCount, agents, scheduler, status };
}

/** Dot colour class for an agent row, following the companion legend. */
export function agentDot(a: Pick<CompanionAgent, 'state' | 'recentlyCompleted'>): string {
  if (a.state === 'blocked' || a.state === 'waiting') return 'cc-dot-attention';
  if (a.state === 'working') return 'cc-dot-working';
  if (a.recentlyCompleted) return 'cc-dot-done';
  return 'cc-dot-idle';
}

const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Needs you',
  waiting: 'Waiting',
  working: 'Working',
  done: 'Done',
  idle: 'Idle',
  unknown: 'Idle'
};

export function agentStatusLabel(a: Pick<CompanionAgent, 'state' | 'recentlyCompleted'>): string {
  if (a.recentlyCompleted && a.state !== 'working' && a.state !== 'blocked') return 'Completed';
  return STATE_LABEL[a.state] ?? 'Idle';
}

/** Compact "now / 4m / 2h / 3d" age. */
export function formatAge(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** "in 5m" / "in 2h" / "in 3d" for a schedule's next run. */
export function formatUntil(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const s = Math.floor((at - now) / 1000);
  if (s <= 60) return 'any moment';
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86_400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86_400)}d`;
}

/** One-line schedule status: running / starting / paused / last failure / next run. */
export function scheduleStatus(
  t: Pick<CompanionSchedule, 'running' | 'enabled' | 'nextRunAt' | 'lastResult' | 'lastRunAt'>,
  now: number,
  starting = false
): string {
  if (t.running) return 'Running';
  if (starting) return 'Starting…';
  const next = t.enabled ? formatUntil(t.nextRunAt, now) : null;
  if (t.lastResult === 'error') {
    const at = t.lastRunAt ? Date.parse(t.lastRunAt) : NaN;
    const age = Number.isFinite(at) ? formatAge(at, now) : null;
    const when = age === null ? '' : age === 'now' ? ' just now' : ` ${age} ago`;
    return `Last run failed${when}${next ? ` · next ${next}` : ''}`;
  }
  if (!t.enabled) return 'Paused';
  return next ?? 'Manual';
}

export const UNANSWERABLE_COPY: Record<NonNullable<CompanionRequest['reason']>, string> = {
  ended: 'This agent is no longer running — open it in the app to continue.',
  background: 'Background job — answer it from the app.',
  execution: 'Execution blocker — respond from the app.'
};
