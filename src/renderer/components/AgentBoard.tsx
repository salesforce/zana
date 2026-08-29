import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bot, AlertCircle, Zap, Moon, CheckCircle2, HelpCircle, CheckCheck, PauseCircle, Network, Crown, Users, Clock, GitBranch, ShieldCheck, ShieldAlert, Boxes, Unplug } from 'lucide-react';
import type { AgentState, ExecutionBoardProjection, IdleResolution, IdleTriageResult, OverseerActivity, Persona, ScheduledTask, TerminalSession } from '@shared/types';
import { scheduleSummary } from '@shared/schedule-spec';
import { profileIcon, personaIcon } from '../util/profileIcon';
import { isRecentlyFinished } from '../util/sessionBuckets';
import { usePersonas, useData, useScheduler, useUi } from '../store';
import { useSessionGit } from '../util/gitInfo';
import { useAgentCardActions, AgentCardMenu, clampMenuAnchor } from './agentCardActions';
import { FavoriteStar } from './FavoriteStar';
import { PromptModal } from './PromptModal';

/**
 * Shared, presentational Kanban-style Agents board. Both the per-project board
 * ({@link ProjectAgentsBoard}) and the cross-project default
 * ({@link GlobalAgentsBoard}) feed it a flat `AgentCard[]` + a click handler;
 * this file owns the lane definitions, the live-timer tick, and the card/lane
 * rendering (pulse/sweep on working, red pulse on blocked).
 *
 * Unlike a classic Kanban, cards aren't dragged — the lane is decided by the
 * agent's own live {@link AgentState}, so cards flow left→right on their own as
 * the agent works / blocks / idles / finishes.
 */

export interface AgentCard {
  session: TerminalSession;
  state: AgentState;
  /** Owning project — only rendered as a chip when `showProject` is set (the
   *  global board). For the per-project board these are present but unused. */
  projectId: string;
  projectName: string;
  projectColor?: string;
  /** Owning project is remote (SSH) → no local git branch to show; the card
   *  omits the branch chip for it (branch is a local-git-only affordance). */
  projectRemote?: boolean;
  /** Idle-triage read (add-on; off by default). Present only while idle and
   *  once the add-on has classified this idle spell. Drives the idle-card badge
   *  that splits the Idle lane into "Waiting on you / Done / Paused". */
  triage?: IdleTriageResult;
  /** Overseer activity rollup (auto-approve cascade; experimental, off by
   *  default). Present once the cascade has decided at least one tool call for
   *  this session. Drives the "auto-approved ×N (overseer)" card badge. */
  overseer?: OverseerActivity;
  /** When this agent entered its current state (ms, renderer clock), from the
   *  status store's `since` map. Undefined until the first state transition is
   *  seen. The Idle lane reads it to show "idle for X" and to order
   *  most-recently-idle first. */
  stateSince?: number;
  /** Live sub-agent (Task spawn) count, from the `useSubagents` slice (0 when
   *  none / untracked). Drives the Delegating lane: an at-rest-looking agent
   *  with children still running is parked awaiting them, not truly idle. */
  liveSubagents?: number;
  /** Board-only job host when an execution outlives its live orchestrator tab. */
  isSyntheticExecutionHost?: boolean;
}

/**
 * The cohort stamp of a card's session, if it was opened by a Team launch.
 * Convenience accessor so the board doesn't reach into `session.cohort`
 * everywhere. Returns null for any non-team agent.
 */
export function cardCohort(c: AgentCard): NonNullable<TerminalSession['cohort']> | null {
  return c.session.cohort ?? null;
}

/** Icon + short label for an idle-triage resolution (badge on idle cards). The
 *  `done` verdict reads as an actionable "Ready to close" (the Close-idle action
 *  already operates on the Idle lane), distinct from the passive waiting/paused
 *  reads — and those cards sink to the bottom of Idle (lowest urgency). */
const TRIAGE_BADGE: Record<IdleResolution, { icon: typeof HelpCircle; label: string } | null> = {
  'awaiting-reply': { icon: HelpCircle, label: 'Waiting on you' },
  done: { icon: CheckCheck, label: 'Ready to close' },
  paused: { icon: PauseCircle, label: 'Paused' },
  unknown: null
};

/**
 * How aggressively a triaged idle agent is promoted into the "Needs you" lane —
 * mirror of `AppConfig.idleAttentionSensitivity`. Named levels (not raw
 * thresholds) per the brainstorm; missing/invalid normalizes to `'medium'` in
 * main, so the renderer treats it as advisory.
 */
export type IdleAttentionSensitivity = 'high' | 'medium' | 'low';

/**
 * Pure mapping: does an idle agent's triage verdict surface it to the "Needs
 * you" lane at the given sensitivity? Exported for unit tests. Drives nothing
 * itself — the lane match below calls it. The three levels (per the brainstorm):
 *
 *  - `high`   → `awaiting-reply` OR `paused`/`unknown` (almost any non-`done`
 *               idle agent surfaces; maximally cautious, more interruptions).
 *  - `medium` → only `awaiting-reply`, any confidence (default; genuine
 *               questions surface, paused/unknown stay Idle).
 *  - `low`    → only `awaiting-reply` AND `confidence >= 0.7` (quietest; only
 *               high-confidence questions surface).
 *
 * `done` never surfaces here (it gets the bottom-sorted "Ready to close" badge
 * in the Idle lane instead). Confidence is the model's self-report (default 0
 * when absent), so a missing confidence never clears the `low` bar.
 */
export function idleSurfacesToNeedsYou(
  verdict: IdleResolution,
  confidence: number,
  sensitivity: IdleAttentionSensitivity
): boolean {
  switch (sensitivity) {
    case 'high':
      return verdict === 'awaiting-reply' || verdict === 'paused' || verdict === 'unknown';
    case 'low':
      return verdict === 'awaiting-reply' && confidence >= 0.7;
    case 'medium':
    default:
      return verdict === 'awaiting-reply';
  }
}

/**
 * A background agent: a scheduled run or a headless team worker. These run
 * unattended and must NEVER request the user's attention — they're excluded
 * from the "Needs you" lane (both the blocked-state and triage paths) and from
 * idle-triage in main. The user fields only foreground agents (e.g. a team's
 * orchestrator); workers report to it. Still listed on the board (the Background
 * badge marks them) — suppressed for attention, not hidden.
 */
export function isBackgroundAgent(c: AgentCard): boolean {
  return !!c.session.headless || !!c.session.scheduled;
}

/**
 * Whether an at-rest idle card should jump to the "Needs you" lane: it must be a
 * genuine idle agent (not delegating/working/exited/background) carrying a
 * triage verdict that {@link idleSurfacesToNeedsYou} promotes at the current
 * sensitivity. Pure; shared by the blocked lane (include) and the idle lane
 * (exclude) so a promoted card can't appear in both.
 */
export function cardNeedsAttention(
  c: AgentCard,
  sensitivity: IdleAttentionSensitivity = 'medium'
): boolean {
  return (
    !isBackgroundAgent(c) &&
    isIdleAgent(c) &&
    !!c.triage &&
    idleSurfacesToNeedsYou(c.triage.resolution, c.triage.confidence ?? 0, sensitivity)
  );
}

export type LaneKey = 'blocked' | 'working' | 'delegating' | 'idle' | 'done';

/**
 * A delegating agent: live, not working/blocked itself, but with sub-agents
 * (Task spawns) still running under it. It LOOKS at-rest but is parked awaiting
 * the work it dispatched, so it's surfaced in its own lane and — crucially —
 * kept OUT of {@link isIdleAgent} so the bulk-close action never kills a parent
 * whose children are still live (that mirrors the main-side close-idle gate).
 * "has live sub-agents" is an orthogonal attribute, not an AgentState, so an
 * agent can be `working` and delegating too — this only fires when it would
 * otherwise fall into the Idle lane.
 */
export function isDelegatingAgent(c: AgentCard): boolean {
  return (
    c.session.status !== 'exited' &&
    c.state !== 'blocked' &&
    c.state !== 'working' &&
    (c.liveSubagents ?? 0) > 0
  );
}

/**
 * An at-rest agent: a live (non-exited) session that is neither working nor
 * blocked AND has no live sub-agents — i.e. it's sitting in the Idle lane (state
 * `idle`/`unknown`). This is the exact target set of the "Close idle" action,
 * kept here so the board's idle lane and the bulk-close button can't drift
 * apart. Note live agents never reach the `done` AgentState (it's vestigial);
 * the Done lane is exited ptys.
 */
export function isIdleAgent(c: AgentCard): boolean {
  return (
    c.session.status !== 'exited' &&
    c.state !== 'blocked' &&
    c.state !== 'working' &&
    !isDelegatingAgent(c)
  );
}

/**
 * An idle agent the "Close & follow up" action may reclaim: a genuine
 * {@link isIdleAgent} that is NOT parked on a question. An agent whose triage
 * verdict is `awaiting-reply` asked the user something and is waiting — closing
 * it would drop a live question on the floor, so it's excluded (the durable
 * idle-triage follow-up already tracks that thread). Background agents are
 * excluded too: they must never surface for attention and shouldn't be swept by
 * a manual reclaim. Pure; shared by the board button and its target-count so the
 * two can't drift. Note this deliberately does NOT consult favorites — the
 * button is a deliberate, confirmed operator action, not the idle timer.
 */
export function isReclaimableIdle(c: AgentCard): boolean {
  return (
    isIdleAgent(c) && !isBackgroundAgent(c) && c.triage?.resolution !== 'awaiting-reply'
  );
}

interface LaneDef {
  key: LaneKey;
  label: string;
  icon: typeof Bot;
  // `sensitivity` is threaded in so the "Needs you" lane can pull up idle agents
  // whose triage verdict surfaces per {@link cardNeedsAttention}; lanes that
  // don't care about triage simply ignore it. Optional (defaults to `'medium'`)
  // so callers classifying a triage-less card can omit it.
  match: (c: AgentCard, sensitivity?: IdleAttentionSensitivity) => boolean;
}

// Lane order = the pipeline, most-urgent first. `done` collects exited sessions
// (success or crash); `idle` collects at-rest live agents (idle/done/unknown
// state but still running). A blocked agent always leads.
export const LANES: LaneDef[] = [
  {
    key: 'blocked',
    label: 'Needs you',
    icon: AlertCircle,
    // Hook-driven permission prompt (`state === 'blocked'`) OR an idle agent the
    // triage add-on says needs you at the current sensitivity. The triage path
    // is advisory (main owns the verdict); it only ever promotes idle cards.
    // Background agents (scheduled runs, team workers) are NEVER surfaced here —
    // they run unattended and report to their orchestrator, not the user. A
    // blocked worker falls through to its normal lane instead of nagging you.
    match: (c, sensitivity) =>
      c.session.status !== 'exited' &&
      (!isBackgroundAgent(c) || c.isSyntheticExecutionHost === true) &&
      (c.state === 'blocked' || cardNeedsAttention(c, sensitivity))
  },
  {
    key: 'working',
    label: 'Working',
    icon: Zap,
    // Actively working, OR a background agent (worker/scheduled) that's `blocked`:
    // since background agents are kept out of the "Needs you" lane, a blocked one
    // would otherwise match no lane and vanish. It's part of the live team, so
    // surface it as working rather than nagging the user.
    match: (c) =>
      c.session.status !== 'exited' &&
      (c.state === 'working' || (isBackgroundAgent(c) && !c.isSyntheticExecutionHost && c.state === 'blocked'))
  },
  {
    key: 'delegating',
    label: 'Delegating',
    icon: Network,
    match: isDelegatingAgent
  },
  {
    key: 'idle',
    label: 'Idle',
    icon: Moon,
    // At-rest agents that AREN'T promoted to "Needs you" — so a surfaced
    // awaiting-reply card lands in exactly one lane. `done` verdicts stay here
    // (bottom-sorted, "Ready to close" badge); paused/unknown stay here too
    // (except at `high`, where they surface above).
    match: (c, sensitivity) => isIdleAgent(c) && !cardNeedsAttention(c, sensitivity)
  },
  {
    key: 'done',
    label: 'Done',
    icon: CheckCircle2,
    match: (c) => c.session.status === 'exited'
  }
];

/**
 * Result of collapsing a launched squad into a single board card: the cards that
 * still get their own lane slot ({@link SquadPartition.laneCards}), plus a map
 * from an orchestrator's sessionId → the worker cards nested UNDER it
 * ({@link SquadPartition.workersByOrchestrator}). See {@link partitionSquads}.
 */
export interface SquadPartition {
  laneCards: AgentCard[];
  workersByOrchestrator: Map<string, AgentCard[]>;
}

/**
 * Collapse each launched team (cohort) into ONE board card so a squad doesn't
 * scatter its workers across every lane. For a cohort that has a live
 * orchestrator card, the orchestrator keeps its own lane slot and every other
 * member (its workers, live or exited) is pulled OUT of the lanes and nested
 * under it. Cohorts with no live orchestrator (and all non-cohort/solo agents)
 * are untouched — their cards flow into the lanes normally, so a headless worker
 * fleet with no driver never silently vanishes.
 *
 * Pure + input-order-preserving (the returned `laneCards` keep their incoming
 * order, and each orchestrator's nested workers keep theirs), so the caller can
 * memoize and the downstream lane sort stays deterministic.
 */
export function partitionSquads(cards: AgentCard[]): SquadPartition {
  const { top, workersByHost } = partitionSquadMembers(cards);
  return { laneCards: top, workersByOrchestrator: workersByHost };
}

/**
 * Execution-managed Team sessions carry a main-stamped execution id. When a
 * retry/recovery leaves more than one cohort, retain one visible host and nest
 * all other members under it. Ordinary Teams keep their existing cohort rules.
 */
export function partitionExecutionMembers(
  items: AgentCard[],
  executions: readonly ExecutionBoardProjection[] = []
): { top: AgentCard[]; workersByHost: Map<string, AgentCard[]> } {
  const executionById = new Map(executions.map((execution) => [execution.executionId, execution]));
  const hostByExecution = new Map<string, AgentCard>();
  for (const item of items) {
    const cohort = item.session.cohort;
    if (!cohort?.executionId || cohort.role !== 'orchestrator' || item.session.status === 'exited') continue;
    const execution = executionById.get(cohort.executionId);
    if (!hostByExecution.has(cohort.executionId)) {
      hostByExecution.set(cohort.executionId, execution ? executionHost(item, execution, false) : item);
    }
  }
  const syntheticByExecution = new Map<string, AgentCard>();
  const top: AgentCard[] = [];
  const workersByHost = new Map<string, AgentCard[]>();
  for (const item of items) {
    const executionId = item.session.cohort?.executionId;
    let host = executionId ? hostByExecution.get(executionId) : undefined;
    if (!host && executionId) {
      const execution = executionById.get(executionId);
      if (execution) {
        host = syntheticByExecution.get(executionId);
        if (!host) {
          host = executionHost(item, execution, true);
          syntheticByExecution.set(executionId, host);
          top.push(host);
        }
      }
    }
    if (host && item.session.id !== host.session.id) {
      const members = workersByHost.get(host.session.id) ?? [];
      members.push(item);
      workersByHost.set(host.session.id, members);
    } else top.push(host ?? item);
  }
  for (const execution of executions) {
    if (hostByExecution.has(execution.executionId) || syntheticByExecution.has(execution.executionId)) continue;
    const template = items.find((item) => item.projectId === execution.projectId);
    const host = executionHost(template, execution);
    syntheticByExecution.set(execution.executionId, host);
    top.push(host);
  }
  return { top, workersByHost };
}

/** A Job needs attention only while its details expose an answer the user can act on. */
export function executionNeedsAttention(execution: ExecutionBoardProjection): boolean {
  const blocker = execution.currentBlocker;
  if (
    !blocker ||
    execution.state === 'COMPLETED' ||
    execution.state === 'FAILED' ||
    execution.state === 'STOPPED'
  ) return false;
  return blocker.delivery?.state !== 'PENDING' && blocker.delivery?.state !== 'LEASED';
}

/** Board-only job host for retained execution workers after their real lead exits. */
function executionHost(member: AgentCard | undefined, execution: ExecutionBoardProjection, synthetic = !member): AgentCard {
  const terminal = execution.state === 'COMPLETED' || execution.state === 'FAILED' || execution.state === 'STOPPED';
  const session = member?.session ?? {
    id: `execution:${execution.executionId}`,
    title: execution.jobTitle,
    status: terminal ? 'exited' : 'running',
    profile: 'claude'
  } as TerminalSession;
  return {
    ...(member ?? { projectId: execution.projectId, projectName: 'Project', liveSubagents: 0 }),
    session: {
      ...session,
      id: synthetic ? `execution:${execution.executionId}` : session.id,
      title: execution.jobTitle,
      status: terminal ? 'exited' : 'running',
      headless: synthetic || session.headless,
      cohort: {
        ...(session.cohort ?? { cohortId: execution.executionId, teamId: 'execution', teamName: 'Execution', role: 'orchestrator' }),
        executionId: execution.executionId,
        executionJobTitle: execution.jobTitle,
        role: 'orchestrator'
      }
    },
    // A live execution can still report RUNNING while a worker waits for a human
    // answer. The actionable Details prompt wins until delivery is in flight.
    state: terminal ? 'done' : executionNeedsAttention(execution) ? 'blocked'
      : execution.state === 'RUNNING' || execution.state === 'STARTING' ? 'working' : 'idle',
    stateSince: execution.updatedAt,
    liveSubagents: 0,
    ...(synthetic ? { isSyntheticExecutionHost: true } : {})
  };
}

/**
 * The generic core of {@link partitionSquads}, over anything carrying a
 * `.session` — so the sidebar Agents list (which works with `AgentRow`, not
 * `AgentCard`) can collapse squads the exact same way the board does. For each
 * cohort with a LIVE orchestrator, that orchestrator stays in `top` and every
 * other member (workers, live or exited) is pulled into `workersByHost` keyed by
 * the orchestrator's sessionId. Cohorts with no live orchestrator, and all
 * solo/non-cohort items, pass through into `top` untouched (a driverless worker
 * fleet never vanishes). Pure + input-order-preserving.
 */
export function partitionSquadMembers<T extends { session: TerminalSession }>(
  items: T[]
): { top: T[]; workersByHost: Map<string, T[]> } {
  // First pass: find the live orchestrator (if any) for each cohort.
  const orchestratorByCohort = new Map<string, T>();
  for (const it of items) {
    const co = it.session.cohort;
    if (!co || co.role !== 'orchestrator') continue;
    if (it.session.status === 'exited') continue; // a dead driver can't host
    if (!orchestratorByCohort.has(co.cohortId)) orchestratorByCohort.set(co.cohortId, it);
  }

  const top: T[] = [];
  const workersByHost = new Map<string, T[]>();
  for (const it of items) {
    const co = it.session.cohort;
    const host = co ? orchestratorByCohort.get(co.cohortId) : undefined;
    // Nest an item only when its cohort has a live orchestrator AND it is not
    // that orchestrator itself. Everything else keeps its own top-level slot.
    if (host && it.session.id !== host.session.id) {
      const list = workersByHost.get(host.session.id) ?? [];
      list.push(it);
      workersByHost.set(host.session.id, list);
    } else {
      top.push(it);
    }
  }
  return { top, workersByHost };
}

interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectColor?: string;
  cards: AgentCard[];
}

/**
 * Group a lane's cards by owning project for the global board, preserving the
 * incoming card order: a project's group lands at the position of its first
 * card, so a lane that pre-sorted (e.g. idle = most-recently-idle first) keeps
 * that ordering across the groups.
 */
export function groupCardsByProject(cards: AgentCard[]): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  const byId = new Map<string, ProjectGroup>();
  for (const c of cards) {
    let g = byId.get(c.projectId);
    if (!g) {
      g = {
        projectId: c.projectId,
        projectName: c.projectName,
        projectColor: c.projectColor,
        cards: []
      };
      byId.set(c.projectId, g);
      groups.push(g);
    }
    g.cards.push(c);
  }
  return groups;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Time-until, the countdown twin of {@link formatDuration} — for "next run in
 * X". Clamps a past/now target to "now" (a fire that's due but hasn't been
 * re-armed yet shouldn't read as a stale negative). Same units as the scheduler
 * panel's own countdown so the two views agree.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Index every schedule by the session ids it has spawned, so a card can find
 * the schedule that owns it. The link is implicit: a fire stamps the run with
 * its `sessionId` (there's no `scheduleId` on the session — see scheduler.ts),
 * so we invert the run history here. A read-only Claude `/loop` row (no run
 * history, `external` set) contributes nothing — those fires aren't owned by
 * the app — but its session, were one tracked, would still resolve like any
 * other. Newest run wins if a session id somehow appears twice. Pure.
 */
export function scheduleBySessionId(tasks: ScheduledTask[]): Map<string, ScheduledTask> {
  const out = new Map<string, ScheduledTask>();
  for (const t of tasks) {
    for (const run of t.status?.runs ?? []) {
      if (run.sessionId && !out.has(run.sessionId)) out.set(run.sessionId, t);
    }
  }
  return out;
}

/**
 * The git-branch chip on a board card — the branch of the agent's OWN cwd (a
 * worktree can differ from the project root). Reads the shared cwd-keyed cache
 * (deduped/throttled, off the render path). Renders nothing for a remote project
 * (no local git), a non-repo cwd, or before the first read resolves — so it only
 * ever adds signal, never an empty slot.
 */
function BranchChip({ cwd, isRemote }: { cwd: string; isRemote: boolean }) {
  const git = useSessionGit(cwd, isRemote);
  if (isRemote || !git || git.notRepo) return null;
  const label = git.detached ? 'detached' : git.branch;
  if (!label) return null;
  return (
    <span className="agent-card-branch" title={`On branch ${label}`}>
      <GitBranch size={9} aria-hidden="true" />
      <span className="agent-card-branch-name">{label}</span>
    </span>
  );
}

/**
 * Isolation-posture chip. `{isolated:true}` → a green shield ("sandboxed"), or a
 * "microVM" box chip when the session ran in the microVM environment.
 * `{isolated:false, reason}` → an amber warning shield: isolation was REQUESTED
 * but couldn't be enforced, so the agent runs unconfined (warn-and-run) — the
 * tooltip carries the reason so the posture is never silently assumed. Absent
 * status (a plain local launch) → nothing.
 */
function SandboxChip({
  status,
  environment
}: {
  status?: TerminalSession['isolationStatus'];
  environment?: TerminalSession['environment'];
}) {
  if (!status) return null;
  if (status.isolated) {
    if (environment === 'microvm') {
      return (
        <span className="agent-card-branch" title="Runs in a hardware-isolated microVM (microsandbox) — the workspace is bind-mounted into a separate guest OS">
          <Boxes size={9} aria-hidden="true" />
          <span className="agent-card-branch-name">microVM</span>
        </span>
      );
    }
    return (
      <span className="agent-card-branch" title="Kernel-sandboxed — writes confined to the workspace, sensitive reads denied">
        <ShieldCheck size={9} aria-hidden="true" />
        <span className="agent-card-branch-name">sandboxed</span>
      </span>
    );
  }
  return (
    <span
      className="agent-card-branch agent-card-branch-warn"
      title={`Isolation requested but not enforced — running unconfined${status.reason ? ` (${status.reason})` : ''}`}
    >
      <ShieldAlert size={9} aria-hidden="true" />
      <span className="agent-card-branch-name">unconfined</span>
    </span>
  );
}

/**
 * Reverse-tunnel posture chip for a REMOTE (SSH) agent. Renders ONLY the failure
 * case (an amber "no callback" chip): the optimistic `{ ok: true }` posture — and
 * the absent-tunnel case (plain remote shell / local session) — are the silent
 * norm, so surfacing them would be noise. `{ ok: false }` means ssh couldn't bind
 * the remote forward, so the agent's hooks and any forwarded MCP won't reach the
 * app; the tooltip carries the reason. Same warn-and-run treatment as the
 * unconfined isolation chip.
 */
function TunnelChip({ status }: { status?: TerminalSession['remoteTunnel'] }) {
  if (!status || status.ok) return null;
  return (
    <span
      className="agent-card-branch agent-card-branch-warn"
      title={`Remote callback tunnel down — this agent can't reach the app${status.reason ? ` (${status.reason})` : ''}`}
    >
      <Unplug size={9} aria-hidden="true" />
      <span className="agent-card-branch-name">no callback</span>
    </span>
  );
}

/** Max worker rows shown under an orchestrator card before "+N more". */
const MAX_VISIBLE_WORKERS = 5;

/**
 * The compact worker rows nested under a squad's orchestrator card (see
 * {@link partitionSquads}). Each row is a status dot + label + duration and is
 * itself clickable (peeks that worker), so the squad collapses to one board
 * card without losing the ability to inspect any member. A "+N more" chip
 * caps the list so a large fleet can't re-inflate the card. Rendered inside the
 * squad shell `<div>`, NOT inside the orchestrator's `<button>` (nested buttons
 * are invalid HTML).
 */
function SquadWorkers({
  workers,
  now,
  onInspect,
  personas,
  execution
}: {
  workers: AgentCard[];
  now: number;
  onInspect: (c: AgentCard) => void;
  personas: Persona[];
  execution?: ExecutionBoardProjection;
}) {
  const visible = workers.slice(0, MAX_VISIBLE_WORKERS);
  const hidden = workers.length - visible.length;
  return (
    <div className="agent-squad-workers">
      {visible.map((w) => {
        const { session: t } = w;
        const exited = t.status === 'exited';
        const persona = t.personaId ? personas.find((p) => p.id === t.personaId) : undefined;
        const slotLabel = w.session.cohort?.slotLabel || persona?.name || 'Worker';
        const slotId = w.session.cohort?.slotId;
        const assignment = slotId
          ? execution?.work?.assignments.find((candidate) => candidate.slotId === slotId && !['COMPLETED', 'FAILED'].includes(candidate.state))
          : undefined;
        const activity = assignment ? assignment.title : exited ? 'Exited' : 'Waiting for assignment';
        const dur = formatDuration((exited ? t.finishedAt ?? t.createdAt : now) - t.createdAt);
        return (
          <button
            key={t.id}
            type="button"
            className={`agent-squad-worker ${exited ? 'exited' : ''}`}
            onClick={() => onInspect(w)}
            title={`${slotLabel} · ${activity} · ${exited ? `ran ${dur}` : dur}`}
          >
            <span className={`tab-agent-dot agent-${exited ? 'done' : w.state}`} aria-hidden="true" />
            <span className="agent-squad-worker-label">{slotLabel}</span>
            <span className="agent-squad-worker-activity">{activity}</span>
            <span className="agent-squad-worker-dur">{exited ? `ran ${dur}` : dur}</span>
          </button>
        );
      })}
      {hidden > 0 && (
        <span className="agent-squad-worker-more" title={`${hidden} more worker${hidden === 1 ? '' : 's'} in this squad`}>
          +{hidden} more
        </span>
      )}
    </div>
  );
}

interface AgentBoardLanesProps {
  cards: AgentCard[];
  /** Which session id is the active tab (highlighted). */
  activeId?: string;
  /**
   * Card click — peek at the agent (opens the inspector modal). The
   * context-menu "Open"/"View" item uses {@link onPick} for the heavier
   * navigate-to-workspace path instead, so a glance and a jump stay distinct.
   */
  onInspect: (c: AgentCard) => void;
  /** Navigate to the agent's workspace tab (context-menu "Open"/"View"). */
  onPick: (c: AgentCard) => void;
  showProject?: boolean;
  executions?: ExecutionBoardProjection[];
  hasMoreExecutions?: boolean;
  onLoadMoreExecutions?: () => void;
  onDismissExecution?: (executionId: string) => void;
}

/**
 * The four lanes + their cards. Owns the 1s tick that advances the live
 * "running for X" timers. Caller computes `cards` behind a memo so a status
 * tick doesn't rebuild the world (render-storm guard).
 */
export function AgentBoardLanes({ cards, activeId, onInspect, onPick, showProject, executions, hasMoreExecutions, onLoadMoreExecutions, onDismissExecution }: AgentBoardLanesProps) {
  const personas = usePersonas((s) => s.personas);
  // Idle-attention sensitivity (mirror of AppConfig, hydrated in the data
  // store): governs which triaged idle agents the "Needs you" lane pulls up.
  // Advisory per CLAUDE.md rule 1 — main owns/normalizes the value.
  const sensitivity = useData((s) => s.idleAttentionSensitivity);
  // Schedules, indexed by the session ids they've fired, so a scheduled card
  // can surface its next-run countdown. Memoized off the raw list so the 1s
  // tick below doesn't re-invert it every second.
  const schedules = useScheduler((s) => s.tasks);
  const scheduleForSession = useMemo(() => scheduleBySessionId(schedules), [schedules]);
  // Lifecycle actions + right-click menu state, shared with the list view so
  // both layouts drive the same pty and expose the same menu.
  const { menu, setMenu, actions, rename, closeRename, submitRename } = useAgentCardActions();
  const [relaunchingExecutionId, setRelaunchingExecutionId] = useState<string | null>(null);
  const [controllingExecutionId, setControllingExecutionId] = useState<string | null>(null);
  const [executionMenu, setExecutionMenu] = useState<{ card: AgentCard; execution: ExecutionBoardProjection; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!executionMenu) return;
    const close = () => setExecutionMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
    };
  }, [executionMenu]);

  // One timer drives every live "running for X". Recomputed at render from
  // createdAt vs. now; only mounted while a board is shown.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  // Collapse each launched squad into a single board card: a cohort with a live
  // orchestrator keeps only that card in the lanes, with its workers nested
  // underneath — so a team reads as one unit instead of spraying worker cards
  // across every lane. Solo agents + driverless worker fleets are untouched.
  // Memoized on `cards` alone; the nested rows re-render with the parent.
  const { laneCards: boardCards, workersByOrchestrator } = useMemo(
    () => {
      const executionMembers = partitionExecutionMembers(cards, executions);
      const squads = partitionSquads(executionMembers.top);
      const nested = new Map(squads.workersByOrchestrator);
      for (const [hostId, members] of executionMembers.workersByHost) {
        nested.set(hostId, [...(nested.get(hostId) ?? []), ...members]);
      }
      return { laneCards: squads.laneCards, workersByOrchestrator: nested };
    },
    [cards, executions]
  );
  // The expensive part — filtering every card into its lane and sorting the
  // idle/delegating lanes — depends ONLY on `boardCards` + `sensitivity`, not on
  // the 1s tick. Memoize it so a bare tick (which fires purely to advance the
  // live "running for X" labels) doesn't re-filter+re-sort the whole board every
  // second. The `done` lane's time-based auto-dismiss is applied fresh below,
  // outside the memo, because it genuinely needs `now`.
  const sortedLanes = useMemo(
    () =>
      LANES.map((lane) => {
        const laneCards = boardCards.filter((c) => lane.match(c, sensitivity));
        // In the Idle/Delegating lanes, order most-recent first — the agent that
        // just settled leads, so the latest is easiest to find. Cards missing a
        // `stateSince` (never transitioned this session) sort last.
        if (lane.key === 'delegating') {
          laneCards.sort((a, b) => (b.stateSince ?? 0) - (a.stateSince ?? 0));
        } else if (lane.key === 'idle') {
          // Idle, plus: `done`-verdict cards ("Ready to close") sink to the
          // bottom — they're the lowest-urgency thing in the lane. Within each
          // band, keep the most-recently-idle-first ordering.
          laneCards.sort((a, b) => {
            const aDone = a.triage?.resolution === 'done' ? 1 : 0;
            const bDone = b.triage?.resolution === 'done' ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            return (b.stateSince ?? 0) - (a.stateSince ?? 0);
          });
        }
        return { lane, cards: laneCards };
      }),
    [boardCards, sensitivity]
  );

  const lanes = sortedLanes.map(({ lane, cards: laneCards }) => {
    // The Done lane collects exited sessions, but they auto-dismiss: a finished
    // run older than FINISHED_LINGER_MS drops out (the 1s tick re-renders, so
    // the card disappears ~60s after it ends rather than piling up forever).
    // This filter reads `now`, so it stays OUT of the memo above.
    if (lane.key === 'done') {
      return { ...lane, cards: laneCards.filter((c) => c.isSyntheticExecutionHost || isRecentlyFinished(c.session, now)) };
    }
    return { ...lane, cards: laneCards };
  });

  const renderCard = (c: AgentCard, laneKey: LaneKey, grouped = false) => {
    const { session: t } = c;
    const exited = t.status === 'exited';
    const bad = exited && (t.exitCode ?? 0) !== 0;
    const active = t.id === activeId;
    const dur = formatDuration((exited ? t.finishedAt ?? t.createdAt : now) - t.createdAt);
    // Idle lane shows how long the agent has been at rest (since it entered the
    // idle state), not its total run length — that's the question you're asking
    // when scanning idle agents ("which one just finished?"). Falls back to the
    // run duration if we never saw the transition (no `stateSince`).
    const idleDur = laneKey === 'idle' && c.stateSince ? formatDuration(now - c.stateSince) : null;
    // Live sub-agent count: badge it on any live card carrying one (whether it
    // landed in Delegating or is still Working with children), so the parent
    // never reads as plain at-rest.
    const subagents = !exited ? c.liveSubagents ?? 0 : 0;
    const persona = t.personaId ? personas.find((p) => p.id === t.personaId) : undefined;
    const subtitle = persona?.name ?? t.profile;
    // Idle-triage badge: only in the idle lane, only when the add-on classified
    // this idle spell to something actionable (awaiting-reply / done / paused).
    const triageBadge =
      laneKey === 'idle' && c.triage ? TRIAGE_BADGE[c.triage.resolution] : null;
    // Overseer badge: surface how many tool calls the auto-approve cascade has
    // handled for a live session. In `on` mode that's real auto-approvals
    // (`autoApproved`); in dry-run nothing was acted on, so we show what it
    // WOULD have approved (`wouldApprove`) — the honest dry-run read. Hidden
    // when zero / on an exited card.
    const ov = !exited ? c.overseer : undefined;
    const overseerBadge = ov
      ? ov.autoApproved > 0
        ? { count: ov.autoApproved, dry: false }
        : ov.wouldApprove > 0
          ? { count: ov.wouldApprove, dry: true }
          : null
      : null;
    // Team cohort stamp (set by launchTeam): drives the per-card team chip +
    // a left-accent so a launched team reads as one unit across the lanes.
    const cohort = cardCohort(c);
    const execution = cohort?.executionId ? executions?.find((candidate) => candidate.executionId === cohort.executionId) : undefined;
    const isOrchestrator = cohort?.role === 'orchestrator';
    // Workers of this squad, nested under their orchestrator card (empty for
    // every non-orchestrator card). `partitionSquads` pulled these OUT of the
    // lanes, so they render here or nowhere — the squad reads as one board card.
    const nestedWorkers = isOrchestrator ? workersByOrchestrator.get(t.id) ?? [] : [];
    // If this session was fired by a schedule, surface the schedule's next-run
    // countdown on the card so a recurring agent reads as "this fires again in
    // X" at a glance. Only while the schedule is still enabled and armed
    // (`nextRunAt` in the future) — a disabled/finished one-shot shows nothing.
    const schedule = scheduleForSession.get(t.id);
    const nextRunMs =
      schedule?.enabled && schedule.status?.nextRunAt
        ? Date.parse(schedule.status.nextRunAt) - now
        : null;
    const cardButton = (
      <button
        key={t.id}
        className={`agent-card lane-${laneKey} ${active ? 'active' : ''} ${bad ? 'bad' : ''} ${
          cohort ? `has-cohort ${isOrchestrator ? 'cohort-orch' : 'cohort-worker'}` : ''
        }`}
        onClick={() => {
          onInspect(c);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Both retained synthetic hosts and live coordinators represent one
          // execution. Never expose terminal actions (Open/Delete/Restart) on a
          // Job card: they bypass Job lifecycle controls and obscure its identity.
          if (execution && isOrchestrator) {
            setExecutionMenu({ card: c, execution, ...clampMenuAnchor(e) });
            return;
          }
          setMenu({ card: c, ...clampMenuAnchor(e) });
        }}
        aria-current={active ? 'true' : undefined}
        title={`${t.title} · ${subtitle}${showProject ? ` · ${c.projectName}` : ''}`}
      >
        {laneKey === 'working' && (
          // Animated activity bar — the visible "alive" signal for a working
          // agent. Pure CSS sweep; carries no data, just liveness.
          <span className="agent-card-activity" aria-hidden="true">
            <span className="agent-card-activity-bar" />
          </span>
        )}
        <span className="agent-card-head">
          <span
            className={`agent-card-icon tab-profile-icon profile-${t.profile} ${showProject && c.projectColor ? 'project-tinted' : ''}`}
            style={showProject && c.projectColor ? ({ '--project-color': c.projectColor } as CSSProperties) : undefined}
          >
            {persona ? personaIcon(persona, 14) : profileIcon(t.profile, 14)}
          </span>
          {!!cohort?.executionId && (
            <span className="job-badge" title={`Execution-backed job member (Run ID: ${cohort.executionId})`} style={{ margin: 0, marginRight: 2 }}>
              job
            </span>
          )}
          <span className="agent-card-title">{cohort?.executionJobTitle ?? t.title}</span>
          {!exited && <span className={`tab-agent-dot agent-${c.state}`} aria-hidden="true" />}
          {!c.isSyntheticExecutionHost && <FavoriteStar session={t} className="agent-card-fav" />}
        </span>
        {triageBadge && (
          // Resolution badge with the model's one-line gloss as the tooltip.
          // class carries the resolution so CSS can color it (waiting=amber,
          // done=green, paused=muted).
          <span
            className={`agent-card-triage triage-${c.triage!.resolution}`}
            title={c.triage!.summary || triageBadge.label}
          >
            <triageBadge.icon size={11} aria-hidden="true" />
            <span className="agent-card-triage-label">{c.triage!.summary || triageBadge.label}</span>
          </span>
        )}
        <span className="agent-card-meta">
          {/* When cards are grouped under a project header (global board), the
              project is already named above — show the persona/profile subtitle
              instead of a redundant project chip. */}
          {showProject && !grouped && (
            <span className="agent-card-project" title={c.projectName}>
              {/* No colored project dot here — the project-tinted ring around
                  the agent icon already carries the project's color. */}
              <span className="agent-card-project-name">{c.projectName}</span>
            </span>
          )}
          {(!showProject || grouped) && <span className="agent-card-sub">{subtitle}</span>}
          {/* Branch of the agent's cwd — surfaced so a glance tells you which
              branch/worktree each agent is on. Local git only (remote omits it),
              and only for a repo cwd; renders nothing otherwise. */}
          <BranchChip cwd={t.cwd} isRemote={!!c.projectRemote} />
          {/* Kernel-sandbox posture: a shield when isolation is in force, a warning
              variant when it was requested but the kernel couldn't enforce it
              (warn-and-run) so an "unconfined" agent never reads as sandboxed.
              Renders nothing for a plain local launch. */}
          <SandboxChip status={t.isolationStatus} environment={t.environment} />
          {/* Remote reverse-tunnel posture: an amber "no callback" chip only when
              ssh couldn't bind the forward, so a remote agent that can't reach the
              app never looks healthy. Silent on the ok/absent cases. */}
          <TunnelChip status={t.remoteTunnel} />
          <span className="grow" />
          {subagents > 0 && (
            <span
              className="agent-card-badge agent-card-subagents"
              title={`${subagents} sub-agent${subagents === 1 ? '' : 's'} running`}
            >
              <Network size={10} aria-hidden="true" />
              {subagents}
            </span>
          )}
          {overseerBadge && (
            // Overseer auto-approval tally. `dry` (dry-run) reads "would
            // auto-approve" — nothing was actually acted on — distinct from the
            // live count, so the badge never overstates what happened.
            <span
              className={`agent-card-badge agent-card-overseer${overseerBadge.dry ? ' dry' : ''}`}
              title={
                `Overseer ${overseerBadge.dry ? 'would auto-approve' : 'auto-approved'} ` +
                `${overseerBadge.count} tool call${overseerBadge.count === 1 ? '' : 's'}` +
                (ov?.lastReason ? ` · last: ${ov.lastReason}` : '')
              }
            >
              <Zap size={10} aria-hidden="true" />
              {overseerBadge.dry ? `would ×${overseerBadge.count}` : `×${overseerBadge.count}`}
            </span>
          )}
          {/* Background (headless) sessions are detached from the tab strip but
              still live (scheduled fires, or a tab the user hid). Tag them so
              they read as background on the board, not just a stateless card.
              Distinct from Scheduled: a hidden non-scheduled agent is Background
              too, and a scheduled run shows both. */}
          {cohort && (
            // Team membership chip: the orchestrator gets a crown, workers a
            // group glyph. The shared team name + the card's left accent make a
            // launched team read as one unit wherever its members sit.
            <span
              className={`agent-card-badge cohort ${isOrchestrator ? 'orch' : 'worker'}`}
              title={
                c.isSyntheticExecutionHost
                  ? `${cohort.teamName} — retained job host`
                  : isOrchestrator
                  ? `${cohort.teamName} — team lead (you talk to this one; closing it ends the whole team)`
                  : `${cohort.teamName} — worker${cohort.slotLabel ? ` · ${cohort.slotLabel}` : ''}`
              }
            >
              {isOrchestrator && !c.isSyntheticExecutionHost ? <Crown size={9} aria-hidden="true" /> : <Users size={9} aria-hidden="true" />}
              {cohort.teamName}
            </span>
          )}
          {t.headless && !exited && (
            <span className="agent-card-badge bg">
              <Moon size={9} aria-hidden="true" />
              Background
            </span>
          )}
          {t.scheduled && <span className="agent-card-badge">Scheduled</span>}
          {nextRunMs != null && (
            // Next scheduled fire — the countdown the Scheduler panel shows,
            // mirrored onto the card so a recurring agent reads its own cadence.
            <span
              className="agent-card-badge sched-next"
              title={
                schedule
                  ? `"${schedule.name}" runs again ${formatCountdown(nextRunMs)} from now (${scheduleSummary(schedule.schedule)})`
                  : undefined
              }
            >
              <Clock size={9} aria-hidden="true" />
              next {formatCountdown(nextRunMs)}
            </span>
          )}
          {bad && <span className="agent-card-badge bad">✗{t.exitCode}</span>}
          <span
            className={`agent-card-dur ${laneKey === 'working' ? 'live' : ''}`}
            title={idleDur ? `Running for ${dur}` : undefined}
          >
            {exited ? `ran ${dur}` : idleDur ? `idle for ${idleDur}` : dur}
          </span>
        </span>
      </button>
    );

    // A solo agent (or a worker whose orchestrator is gone) renders as the bare
    // card. An orchestrator with live workers wraps its card in a squad shell and
    // nests compact worker rows beneath it, so the whole team is one board unit.
    const controlAction = execution && c.isSyntheticExecutionHost && !exited ? (
      <span className="agent-squad-worker">
        <button
          type="button"
          disabled={controllingExecutionId === execution.executionId}
          onClick={async () => {
            setControllingExecutionId(execution.executionId);
            try {
              if (execution.stateVersion === undefined) return;
            const retryable = execution.state === 'BLOCKED' && !execution.orchestratorSessionId;
            const result = retryable
                ? await window.cc.executionBoard.retry(execution.projectId, execution.executionId, execution.stateVersion)
                : await window.cc.executionBoard.stop(execution.projectId, execution.executionId, execution.stateVersion);
              if (!result.ok) useUi.getState().pushToast(`Job control failed: ${result.message ?? result.code}`, 'error');
            } finally { setControllingExecutionId(null); }
          }}
        >
          {controllingExecutionId === execution.executionId
            ? 'Updating job...'
            : execution.state === 'BLOCKED' && !execution.orchestratorSessionId ? 'Retry job' : 'Stop job'}
        </button>
      </span>
    ) : null;
    const monitorAction = execution && c.isSyntheticExecutionHost && execution.recovery?.status === 'available' && !exited ? (
      <button
        type="button"
        className="agent-squad-worker"
        disabled={relaunchingExecutionId === execution.executionId}
        onClick={async () => {
          setRelaunchingExecutionId(execution.executionId);
          try {
            const result = await window.cc.executionBoard.relaunchMonitor(execution.projectId, execution.executionId);
            if (!result.ok) useUi.getState().pushToast(`Monitor relaunch failed: ${result.message ?? result.code}`, 'error');
          } finally { setRelaunchingExecutionId(null); }
        }}
      >
        {relaunchingExecutionId === execution.executionId ? 'Launching monitor...' : 'Relaunch monitor'}
      </button>
    ) : null;
    if (nestedWorkers.length === 0 && !monitorAction && !controlAction) return cardButton;
    return (
      <div key={t.id} className="agent-squad">
        {cardButton}
        {controlAction}
        {monitorAction}
        <SquadWorkers workers={nestedWorkers} now={now} onInspect={onInspect} personas={personas} execution={execution} />
      </div>
    );
  };

  return (
    <div className="agents-board-lanes">
      {lanes.map((lane) => {
        const Icon = lane.icon;
        return (
          <section key={lane.key} className={`agents-lane lane-${lane.key}`}>
            <header className="agents-lane-head">
              <Icon size={13} className="agents-lane-icon" aria-hidden="true" />
              <span className="agents-lane-label">{lane.label}</span>
              <span className="agents-lane-count">{lane.cards.length}</span>
            </header>
            <div className="agents-lane-cards">
              {lane.cards.length === 0 ? (
                <div className="agents-lane-empty" aria-hidden="true" />
              ) : showProject ? (
                // Global board: group a lane's cards by project so the fleet
                // reads project-by-project. Preserve the lane's card order
                // (e.g. idle's most-recent-first) when forming groups — the
                // first card seen for a project fixes that project's position.
                groupCardsByProject(lane.cards).map((group) => (
                  <div key={group.projectId} className="agents-lane-group">
                    <div className="agents-lane-group-head" title={group.projectName}>
                      <span
                        className="agents-lane-group-dot"
                        style={group.projectColor ? { background: group.projectColor } : undefined}
                        aria-hidden="true"
                      />
                      <span className="agents-lane-group-name">{group.projectName}</span>
                      <span className="agents-lane-group-count">{group.cards.length}</span>
                    </div>
                    {group.cards.map((c) => renderCard(c, lane.key, true))}
                  </div>
                ))
              ) : (
                lane.cards.map((c) => renderCard(c, lane.key))
              )}
            </div>
          </section>
        );
      })}

      {menu && (
        <AgentCardMenu menu={menu} setMenu={setMenu} actions={actions} onPick={onPick} />
      )}
      {executionMenu && (
        <div
          className="tab-context-menu"
          style={{ top: executionMenu.y, left: executionMenu.x }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button onClick={() => { onInspect(executionMenu.card); setExecutionMenu(null); }}>Inspect details</button>
          {!['COMPLETED', 'FAILED', 'STOPPED'].includes(executionMenu.execution.state) && (
            <button onClick={async () => {
              const { execution } = executionMenu;
              setExecutionMenu(null);
              if (execution.stateVersion === undefined) return;
              const result = await window.cc.executionBoard.stop(execution.projectId, execution.executionId, execution.stateVersion);
              if (!result.ok) useUi.getState().pushToast(`Job control failed: ${result.message ?? result.code}`, 'error');
            }}>Stop job</button>
          )}
          {['COMPLETED', 'FAILED', 'STOPPED'].includes(executionMenu.execution.state) && (
            <>
              <div className="tab-context-sep" />
              <button
                className="tab-context-danger"
                onClick={async () => {
                  const { execution } = executionMenu;
                  setExecutionMenu(null);
                  const result = await window.cc.executionBoard.dismiss(execution.projectId, execution.executionId);
                  if (!result.ok) {
                    useUi.getState().pushToast(`Job dismissal failed: ${result.message ?? result.code}`, 'error');
                    return;
                  }
                  useData.getState().dismissTerminals(result.value.dismissedSessionIds);
                  onDismissExecution?.(execution.executionId);
                }}
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      )}
      {rename && (
        <PromptModal
          title="Rename agent"
          label="Name"
          initialValue={rename.card.session.title}
          confirmLabel="Rename"
          onSubmit={(v) => submitRename(rename.card, v)}
          onClose={closeRename}
        />
      )}
      {hasMoreExecutions && onLoadMoreExecutions && (
        <div style={{ padding: '1rem', textAlign: 'center' }}>
          <button className="btn outline" onClick={onLoadMoreExecutions}>
            Load older history
          </button>
        </div>
      )}
    </div>
  );
}
