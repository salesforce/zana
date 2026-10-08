import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Calendar,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Inbox,
  Loader2,
  MailCheck,
  RotateCw,
  Square,
  Trash2,
  Terminal as TerminalIcon
} from 'lucide-react';
import type { AgentState, ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { useData, useUi, usePersonas } from '../store.js';
import { getAgentSessionRoutePath } from '../lib/route-paths.js';
import { inspectRouteProjectId } from '../lib/inspect-session.js';
import { profileIcon, personaIcon } from '../lib/profileIcon.js';
import { isClaudeProfile } from '../lib/launchProfile.js';
import { AGENT_MONITOR_TERMINAL_ANCHOR_ID } from './TerminalSurface.js';
import {
  useAgentCardActions,
  AgentCardMenu,
  clampMenuAnchor,
  canCloseWithFollowup,
  cliAgentRemoveLabel,
  cliAgentRestartLiveTitle,
  closeAgentWithFollowup
} from './agentCardActions.js';
import { useThreadCardActions, ThreadCardMenu, openThreadMenu } from './threadCardActions.js';
import { PromptModal } from './PromptModal.js';
import { AgentSessionView } from './AgentSessionView.js';
import {
  LANES,
  cardCohort,
  formatDuration,
  isBackgroundAgent,
  visibleAgentLanes,
  type AgentCard,
  type IdleAttentionSensitivity,
  type LaneKey
} from './AgentBoard.js';
import { FleetKindChip } from './FleetKindChip.js';
import { ProviderIcon } from './thread/pickers/ProviderIcon.js';
import { fleetMatchesLane, resolveMonitorSelection, type FleetItem } from './fleet-item.js';
import { ThreadDetail } from '../views/threads/ThreadDetailView.js';
import { openScheduleFromAgents } from './scheduler/openScheduledLive.js';
import { groupSessionsByTeamRun } from '../lib/teamRunOrganization.js';
import { PaneEmptyState } from './PaneEmptyState.js';
import { useCompactLayout } from '../hooks/useCompactLayout.js';
import { useMobileThreadControlsTarget } from './useMobileThreadTitleTarget.js';
import {
  OTHER_PROJECTS_KEY,
  applyMonitorFilter,
  fleetItemActivityAt,
  formatAge,
  isUnreadFleetItem,
  sectionByProject,
  sortByRecent,
  type MonitorListFilter,
  type MonitorListSort
} from './agent-monitor-list.js';

/**
 * The Agents "List" view: a live monitor — item list (left), the selected
 * session (center), and status + actions (right). Replaces the old mesh/registry
 * panel as the List toggle target.
 *
 * Agents and threads both drop the dedicated status column: the center pane
 * mounts {@link AgentSessionView} (PTY + thread secondary panel) or
 * {@link ThreadDetail} (conversation + the same chrome). Selection is
 * held in the UI store (`agentMonitor`); this component owns that selection's
 * lifecycle and CLEARS it on unmount, so a stale selection can never steal the
 * live terminal from the Projects workspace once the List view is off screen.
 * Compact layouts start with the list alone. An explicit row tap replaces it
 * with the session; Back unmounts the detail and restores the list's scroll and
 * keyboard focus. No terminal is selected while the mobile list is showing.
 *
 * Fed a flat {@link AgentCard}[] by whichever board hosts it (global or
 * per-project), so it honors the same filter/scope the board already applied.
 */

const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  unknown: 'Idle',
  waiting: 'Waiting for model'
};

interface AgentMonitorProps {
  cards: FleetItem[];
  /** Durable Job state promotes only its orchestrator when a response is needed. */
  executions?: readonly ExecutionBoardProjection[];
  /** Show the owning-project chip on rows + in the status pane (global board). */
  showProject?: boolean;
  onInspectExecution?: (projectId: string, executionId: string) => void;
}

/** Which lane an item sits in — reuses the board's exact lane predicates so the
 *  monitor list groups identically to the Kanban. First match wins (lanes are
 *  ordered most-urgent first). */
function laneOf(item: FleetItem, sensitivity: IdleAttentionSensitivity): LaneKey {
  const lane = LANES.find((l) => fleetMatchesLane(item, l.key, (card) => l.match(card, sensitivity)));
  return lane?.key ?? 'idle';
}

/** Open the first-class CLI-agent session page without leaving Agents for a project. */
function openAgentSession(navigate: (to: string) => void, card: AgentCard): void {
  navigate(getAgentSessionRoutePath(card.session.id, inspectRouteProjectId(card.projectId)));
}

export function AgentMonitor({ cards, executions = [], showProject = false, onInspectExecution }: AgentMonitorProps) {
  const compact = useCompactLayout();
  const sensitivity = useData((s) => s.idleAttentionSensitivity);
  const includeScheduled = useData((s) => s.includeScheduledAgentsInAgentView);
  const organization = useData((s) => s.agentsListOrganization);
  const selection = useUi((s) => s.agentMonitor);
  const selectMonitorAgent = useUi((s) => s.selectMonitorAgent);
  const clearMonitorAgent = useUi((s) => s.clearMonitorAgent);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [mobileDetailId, setMobileDetailId] = useState<string | null>(null);
  const pickedRow = useRef<HTMLButtonElement | null>(null);
  const [filter, setFilter] = useState<MonitorListFilter>('all');
  const [sort, setSort] = useState<MonitorListSort>('project');
  // Finished work starts folded so it can't push live agents off-screen.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(['done']));
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Row ages ("4m", "2h") only need minute resolution.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 30_000);
    return () => clearInterval(id);
  }, []);
  const { menu, setMenu, actions, rename, closeRename, submitRename } = useAgentCardActions();
  const { menu: threadMenu, setMenu: setThreadMenu } = useThreadCardActions();

  useEffect(() => () => clearMonitorAgent(), [clearMonitorAgent]);

  // Durable-Job-aware fleet: an orchestrator with an actionable blocker is
  // promoted to `blocked` (both on the FleetItem and its wrapped AgentCard, so
  // lane matching AND the row dot/state label agree) regardless of its raw
  // live status — mirrors the board's own execution-attention promotion.
  const jobCards = useMemo(() => {
    const byExecutionId = new Map(executions.map((execution) => [execution.executionId, execution]));
    return cards.map((item) => {
      if (item.kind !== 'agent') return item;
      const executionId = item.card.session.cohort?.executionId;
      const execution = executionId ? byExecutionId.get(executionId) : undefined;
      const terminal = execution?.state === 'COMPLETED' || execution?.state === 'FAILED' || execution?.state === 'STOPPED';
      const needsAttention = !!execution?.currentBlocker && !terminal &&
        execution.currentBlocker.delivery?.state !== 'PENDING' && execution.currentBlocker.delivery?.state !== 'LEASED';
      if (needsAttention && item.card.session.cohort?.role === 'orchestrator') {
        return { ...item, state: 'blocked' as const, card: { ...item.card, state: 'blocked' as const } };
      }
      return item;
    });
  }, [cards, executions]);

  const unreadCount = useMemo(() => jobCards.filter(isUnreadFleetItem).length, [jobCards]);
  const listCards = useMemo(() => applyMonitorFilter(jobCards, filter), [jobCards, filter]);

  const grouped = useMemo(() => {
    const ordered = (groups: Array<{ key: string; label: string; cards: FleetItem[] }>) =>
      sort === 'recent' ? groups.map((g) => ({ ...g, cards: sortByRecent(g.cards) })) : groups;
    if (organization === 'team-run') {
      const agentGroups = groupSessionsByTeamRun(
        listCards.filter((item): item is Extract<FleetItem, { kind: 'agent' }> => item.kind === 'agent')
          .map((item) => ({ session: item.card.session, item }))
      ).map((group) => ({
        key: group.key,
        label: group.label,
        cards: group.items.map(({ item }) => item)
      }));
      const other = listCards.filter((item) => item.kind !== 'agent');
      return ordered(other.length
        ? [...agentGroups, { key: 'other-fleet', label: 'Threads and schedules', cards: other }]
        : agentGroups);
    }
    const pinnedThreads = listCards.filter(
      (item): item is Extract<FleetItem, { kind: 'thread' }> => item.kind === 'thread' && item.thread.pinnedAt != null
    );
    const byLane = new Map<LaneKey, FleetItem[]>();
    for (const item of listCards) {
      if (item.kind === 'thread' && item.thread.pinnedAt != null) continue;
      const key = laneOf(item, sensitivity);
      const list = byLane.get(key) ?? [];
      list.push(item);
      byLane.set(key, list);
    }
    return ordered([
      { key: 'pinned', label: 'Pinned', cards: pinnedThreads },
      ...visibleAgentLanes(includeScheduled).map((l) => ({ key: l.key, label: l.label, cards: byLane.get(l.key) ?? [] }))
    ]
      .filter((g) => g.cards.length > 0));
  }, [listCards, sensitivity, includeScheduled, organization, sort]);

  const selected = useMemo(
    () => compact
      ? jobCards.find((item) => item.id === mobileDetailId) ?? null
      : resolveMonitorSelection(
        jobCards,
        selection ? { sessionId: selection.sessionId, projectId: selection.projectId } : null,
        pickedId
      ),
    [jobCards, selection, pickedId, compact, mobileDetailId]
  );

  useEffect(() => {
    if (!compact) setMobileDetailId(null);
    else if (!selected) {
      setMobileDetailId(null);
      pickedRow.current?.focus({ preventScroll: true });
    }
  }, [compact, selected?.id]);

  useEffect(() => {
    if (!selected) {
      if (selection) clearMonitorAgent();
      return;
    }
    if (selected.kind === 'agent') {
      if (selection?.sessionId !== selected.card.session.id) {
        selectMonitorAgent(selected.card.session.id, selected.projectId);
      }
      return;
    }
    if (selection) clearMonitorAgent();
  }, [selected, selection, selectMonitorAgent, clearMonitorAgent]);

  if (cards.length === 0) {
    return (
      <PaneEmptyState
        className="agent-monitor agent-monitor--empty"
        art="agents"
        title="No agents"
        hint="Start an agent and it will appear here to watch live."
      />
    );
  }

  return (
    <div
      className={`agent-monitor ${
        selected?.kind === 'thread' ? 'is-thread' : selected?.kind === 'agent' ? 'is-agent-session' : ''
      }`}
    >
      <nav className="agent-monitor-list" aria-label="Agents" hidden={compact && !!selected}>
        <div className="agent-monitor-list-bar">
          <div className="agent-monitor-chips" role="group" aria-label="Show">
            <button
              type="button"
              className={`agent-monitor-chip ${filter === 'all' ? 'active' : ''}`}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All <span className="agent-monitor-chip-count">{jobCards.length}</span>
            </button>
            <button
              type="button"
              className={`agent-monitor-chip ${filter === 'unread' ? 'active' : ''}`}
              aria-pressed={filter === 'unread'}
              onClick={() => setFilter('unread')}
            >
              Unread <span className="agent-monitor-chip-count">{unreadCount}</span>
            </button>
          </div>
          <div className="agent-monitor-sort" role="group" aria-label="Order">
            {(['project', 'recent'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={sort === value ? 'active' : ''}
                aria-pressed={sort === value}
                onClick={() => setSort(value)}
              >
                {value === 'project' ? 'Project' : 'Recent'}
              </button>
            ))}
          </div>
        </div>
        {grouped.length === 0 && (
          <p className="agent-monitor-list-empty">{filter === 'unread' ? 'No unread agents.' : 'No agents.'}</p>
        )}
        {grouped.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          // Project sub-sections only help when rows span several projects and
          // the list is ordered by project; otherwise each row names its project.
          const sections = showProject && sort === 'project' ? sectionByProject(g.cards) : null;
          const renderRow = (item: FleetItem, rowShowsProject: boolean) => (
            <AgentMonitorRow
              key={item.id}
              item={item}
              laneKey={laneOf(item, sensitivity)}
              active={item.id === selected?.id}
              showProject={rowShowsProject}
              onSelect={(event) => {
                setPickedId(item.id);
                if (compact) {
                  pickedRow.current = event.currentTarget;
                  setMobileDetailId(item.id);
                }
              }}
              onContextMenu={(e) => {
                if (item.kind === 'schedule') {
                  e.preventDefault();
                  return;
                }
                if (item.kind === 'thread') {
                  setMenu(null);
                  openThreadMenu(e, item.thread, setThreadMenu);
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                setThreadMenu(null);
                setMenu({ card: item.card, ...clampMenuAnchor(e) });
              }}
            />
          );
          return (
            <div key={g.key} className={`agent-monitor-group ${isCollapsed ? 'is-collapsed' : ''}`}>
              <button
                type="button"
                className={`agent-monitor-group-head ${organization === 'status' ? `group-${g.key}` : 'group-team-run'}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(g.key)}
              >
                <span>{g.label}</span>
                <span className="agent-monitor-group-count">{g.cards.length}</span>
                {isCollapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
              </button>
              {!isCollapsed && (sections
                ? sections.map((section) => (
                  <div key={section.key} className="agent-monitor-project" data-project-section={section.key}>
                    <div className="agent-monitor-project-head">
                      <span
                        className="agent-monitor-project-swatch"
                        style={section.color ? ({ '--project-color': section.color } as CSSProperties) : undefined}
                        aria-hidden="true"
                      />
                      <span className="agent-monitor-project-name" title={section.label}>{section.label}</span>
                      <span className="agent-monitor-project-count">{section.items.length}</span>
                    </div>
                    {section.items.map((item) => renderRow(item, section.key === OTHER_PROJECTS_KEY))}
                  </div>
                ))
                : g.cards.map((item) => renderRow(item, showProject)))}
            </div>
          );
        })}
      </nav>

      {(!compact || selected) && <AgentMonitorTerminal
        selected={selected}
        showProject={showProject}
        executions={executions}
        onInspectExecution={onInspectExecution}
        onBack={compact ? () => setMobileDetailId(null) : undefined}
      />}

      {typeof document !== 'undefined' &&
        menu &&
        createPortal(
          <AgentCardMenu
            menu={menu}
            setMenu={setMenu}
            actions={actions}
          />,
          document.body
        )}
      {typeof document !== 'undefined' &&
        threadMenu &&
        createPortal(
          <ThreadCardMenu menu={threadMenu} setMenu={setThreadMenu} />,
          document.body
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
    </div>
  );
}

// ── Left pane: one agent row ────────────────────────────────────────────────

interface RowProps {
  item: FleetItem;
  laneKey: LaneKey;
  active: boolean;
  showProject: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (e: MouseEvent) => void;
}

function AgentMonitorRow({ item, laneKey, active, showProject, onSelect, onContextMenu }: RowProps) {
  const navigate = useNavigate();
  const personas = usePersonas((s) => s.personas);
  const terminals = useData((s) => s.terminals);
  const activityAt = fleetItemActivityAt(item);
  const age = activityAt != null ? formatAge(Date.now() - activityAt) : null;
  const project = showProject ? (
    <span className="agent-monitor-row-project" title={item.projectName}>
      {item.projectColor && (
        <span
          className="agent-monitor-project-swatch"
          style={{ '--project-color': item.projectColor } as CSSProperties}
          aria-hidden="true"
        />
      )}
      {item.projectName}
    </span>
  ) : null;

  if (item.kind === 'schedule') {
    return (
      <button
        type="button"
        className={`agent-monitor-row is-schedule lane-${laneKey} ${active ? 'active' : ''}${item.task.enabled ? '' : ' exited'}`}
        data-kind="schedule"
        onClick={() => openScheduleFromAgents(item.task, terminals, navigate)}
        onContextMenu={onContextMenu}
        title={`${item.title} · ${item.projectName}`}
      >
        <span className="agent-monitor-row-lead" aria-hidden="true" />
        <span className="agent-monitor-row-text">
          <span className="agent-monitor-row-title-line">
            <span className="agent-monitor-row-title">{item.title}</span>
          </span>
          <span className="agent-monitor-row-meta">
            <span className="agent-monitor-row-harness"><Calendar size={11} aria-hidden="true" /></span>
            {project}
            <FleetKindChip kind="schedule" />
            <span className="agent-monitor-row-dur">{item.task.enabled ? 'Armed' : 'Paused'}</span>
          </span>
        </span>
      </button>
    );
  }
  if (item.kind === 'thread') {
    const unread = isUnreadFleetItem(item);
    const failed = item.thread.status === 'error';
    return (
      <button
        type="button"
        className={`agent-monitor-row is-thread lane-${laneKey} ${active ? 'active' : ''} ${unread ? 'is-unread' : ''}`}
        data-kind="thread"
        onClick={onSelect}
        onContextMenu={onContextMenu}
        aria-current={active ? 'true' : undefined}
        title={`${item.title} · ${item.projectName} · ${item.thread.status}`}
      >
        <span className="agent-monitor-row-lead">
          {unread ? <span className="thread-unread-dot" data-testid="thread-unread-indicator" title="New activity" role="img" aria-label="New activity" /> : null}
        </span>
        <span className="agent-monitor-row-text">
          <span className="agent-monitor-row-title-line">
            <span className="agent-monitor-row-title">{item.title}</span>
            <span className="agent-monitor-row-trail">
              <span className="agent-monitor-row-harness">
                <ProviderIcon providerId={item.thread.providerId} size={11} />
              </span>
              {age && <span className="agent-monitor-row-age">{age}</span>}
            </span>
          </span>
          {(project || failed) && (
            <span className="agent-monitor-row-meta">
              {project}
              {failed && <span className="agent-monitor-row-error">Error</span>}
            </span>
          )}
        </span>
      </button>
    );
  }

  const card = item.card;
  const { session: t } = card;
  const exited = t.status === 'exited';
  const persona = t.personaId ? personas.find((p) => p.id === t.personaId) : undefined;
  const subtitle = persona?.name ?? t.profile;
  const dur = formatDuration(
    (exited ? t.finishedAt ?? t.createdAt : Date.now()) - t.createdAt
  );

  return (
    <button
      type="button"
      className={`agent-monitor-row lane-${laneKey} ${active ? 'active' : ''} ${exited ? 'exited' : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      aria-current={active ? 'true' : undefined}
      title={`${t.title} · ${subtitle}${showProject ? ` · ${card.projectName}` : ''}`}
    >
      <span className="agent-monitor-row-lead" aria-hidden="true" />
      <span className="agent-monitor-row-text">
        <span className="agent-monitor-row-title-line">
          <span className="agent-monitor-row-title">{t.title}</span>
          {age && <span className="agent-monitor-row-age">{age}</span>}
        </span>
        <span className="agent-monitor-row-meta">
          <span className={`agent-monitor-row-harness tab-profile-icon profile-${t.profile}`}>
            {persona ? personaIcon(persona, 11) : profileIcon(t.profile, 11)}
          </span>
          {project}
          <FleetKindChip kind="agent" />
          <span className="agent-monitor-row-dur">{exited ? `ran ${dur}` : dur}</span>
        </span>
      </span>
    </button>
  );
}

// ── Center pane: the live terminal portal target + a header ─────────────────

function AgentMonitorTerminal({
  selected,
  showProject,
  executions,
  onInspectExecution,
  onBack
}: {
  selected: FleetItem | null;
  showProject: boolean;
  executions: readonly ExecutionBoardProjection[];
  onInspectExecution?: (projectId: string, executionId: string) => void;
  onBack?: () => void;
}) {
  const agent = selected?.kind === 'agent' ? selected : null;
  const thread = selected?.kind === 'thread' ? selected : null;
  const backTarget = useMobileThreadControlsTarget(Boolean(onBack));
  const back = onBack ? <button type="button" className="agent-monitor-back" onClick={onBack} autoFocus aria-label="Back to agents" title="Back to agents">
    <ArrowLeft size={18} aria-hidden="true" /><span>Back to agents</span>
  </button> : null;
  return (
    <section className="agent-monitor-main">
      {backTarget ? createPortal(back, backTarget) : back}
      {!thread && !agent && (
        <header className="agent-monitor-main-head">
          <TerminalIcon size={13} aria-hidden="true" />
          <span className="agent-monitor-main-title">No agent selected</span>
        </header>
      )}
      {!thread && agent && !backTarget && (
        <header className="agent-monitor-main-head">
          <TerminalIcon size={13} aria-hidden="true" />
          <span className="agent-monitor-main-title">{agent.card.session.title}</span>
          {agent.card.session.status !== 'exited' && (
            <span className={`agent-monitor-main-state agent-${agent.state}`}>
              <span className={`tab-agent-dot agent-${agent.state}`} aria-hidden="true" />
              {STATE_LABEL[agent.state]}
            </span>
          )}
        </header>
      )}
      {/* TerminalSurface portals the selected session's live xterm into the
          AgentSessionView anchor while the List view is on screen. Thread
          selection clears the PTY store and mounts ThreadDetail here instead. */}
      <div
        className={`agent-monitor-terminal${thread ? ' is-thread' : agent ? ' is-agent-session' : ''}`}
      >
        {thread ? (
          <div className="agent-monitor-thread" data-testid="agent-monitor-thread">
            <ThreadDetail key={thread.id} threadId={thread.id} embedded showSecondaryPanel mobileTitleInShell={Boolean(onBack)} />
          </div>
        ) : agent ? (
          <AgentMonitorSession
            mobileTitleInShell={Boolean(onBack)}
            card={agent.card}
            showProject={showProject}
            executions={executions}
            onInspectExecution={onInspectExecution}
          />
        ) : (
          <div className="agent-monitor-terminal-empty">
            <Bot size={24} aria-hidden="true" />
            <p>Select an agent to watch its output.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function AgentMonitorSession({
  mobileTitleInShell,
  card,
  showProject,
  executions,
  onInspectExecution
}: {
  card: AgentCard;
  mobileTitleInShell: boolean;
  showProject: boolean;
  executions: readonly ExecutionBoardProjection[];
  onInspectExecution?: (projectId: string, executionId: string) => void;
}) {
  const navigate = useNavigate();
  const { actions } = useAgentCardActions();
  const { session: t } = card;
  const exited = t.status === 'exited';
  const background = isBackgroundAgent(card);
  const cohort = cardCohort(card);
  const execution = executions.find(
    (candidate) =>
      (t.cohort?.executionId && candidate.executionId === t.cohort.executionId) ||
      candidate.orchestratorSessionId === t.id
  );
  const project = useData((s) => s.projects.find((row) => row.id === card.projectId));
  const openInWorkspace = () => openAgentSession(navigate, card);
  const canSummarize = isClaudeProfile(t.profile);
  const canFollowupClose = canCloseWithFollowup(t);
  const [summarizing, setSummarizing] = useState(false);
  const closingWithFollowup = useData((s) => s.closingFollowupIds.has(t.id));
  const summarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    try {
      await useData.getState().summarizeSession(t.id, card.projectId);
    } finally {
      setSummarizing(false);
    }
  };
  const closeWithFollowup = async () => {
    if (closingWithFollowup) return;
    await closeAgentWithFollowup(t, card.projectId);
  };
  const prevId = useRef(t.id);
  if (prevId.current !== t.id) {
    prevId.current = t.id;
    if (summarizing) setSummarizing(false);
  }

  const monitorActions = (
    <>
      {execution && onInspectExecution && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={() => onInspectExecution(execution.projectId, execution.executionId)}
        >
          {execution.currentBlocker ? 'Respond in Squad details' : 'Squad details'}
        </button>
      )}
      {!exited && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={() => actions.stop(card)}
          title="Send Ctrl-C to interrupt the agent. The session stays alive."
        >
          <Square size={13} /> Stop
        </button>
      )}
      <button
        type="button"
        className="agent-monitor-action"
        onClick={() => actions.restart(card)}
        title={
          exited
            ? 'Relaunch this session with the same profile and args'
            : cliAgentRestartLiveTitle()
        }
      >
        <RotateCw size={13} /> Restart
      </button>
      {canFollowupClose && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={closeWithFollowup}
          disabled={closingWithFollowup}
          title="Close the agent, summarising its work to your inbox and filing a follow-up if it left something unfinished"
        >
          {closingWithFollowup ? <Loader2 size={13} className="spin" /> : <MailCheck size={13} />}
          {closingWithFollowup ? 'Closing…' : 'Close with follow-up'}
        </button>
      )}
      {canSummarize && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={summarize}
          disabled={summarizing}
          title="Summarize this agent's work and send it to your inbox"
        >
          {summarizing ? <Loader2 size={13} className="spin" /> : <Inbox size={13} />}
          {summarizing ? 'Summarizing…' : 'Summarize'}
        </button>
      )}
      <button
        type="button"
        className="agent-monitor-action"
        onClick={openInWorkspace}
        title="Open this agent on its session page"
      >
        <ExternalLink size={13} /> Open
      </button>
      <button
        type="button"
        className="agent-monitor-action danger"
        onClick={() => actions.remove(card)}
        title={
          exited ? 'Dismiss this finished agent' : 'Terminate this agent and remove it from the board'
        }
      >
        <Trash2 size={13} /> {cliAgentRemoveLabel(exited)}
      </button>
    </>
  );

  return (
    <AgentSessionView
      mobileTitleInShell={mobileTitleInShell}
      session={t}
      projectId={card.projectId}
      projectName={card.projectName}
      projectColor={card.projectColor}
      projectRemote={Boolean(project?.remote)}
      state={card.state}
      terminalAnchorId={AGENT_MONITOR_TERMINAL_ANCHOR_ID}
      showProject={showProject}
      cohort={cohort}
      background={background}
      footer={monitorActions}
    />
  );
}
