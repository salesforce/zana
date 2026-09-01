import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  Calendar,
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
import { profileIcon, personaIcon } from '../lib/profileIcon.js';
import { isClaudeProfile } from '../lib/launchProfile.js';
import { AGENT_MONITOR_TERMINAL_ANCHOR_ID } from './TerminalSurface.js';
import {
  useAgentCardActions,
  AgentCardMenu,
  clampMenuAnchor,
  canCloseWithFollowup,
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
  type AgentCard,
  type IdleAttentionSensitivity,
  type LaneKey
} from './AgentBoard.js';
import { FleetKindChip } from './FleetKindChip.js';
import { ProviderIcon } from './thread/pickers/ProviderIcon.js';
import { fleetMatchesLane, resolveMonitorSelection, type FleetItem } from './fleet-item.js';
import { ThreadDetail } from '../views/threads/ThreadDetailView.js';

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

/** Same workspace jump the status-rail Open button and the card menu share. */
function openAgentInWorkspace(card: AgentCard): void {
  const ui = useUi.getState();
  const data = useData.getState();
  ui.setNav('projects');
  ui.enterProjectFocus(card.projectId);
  if (card.session.headless && card.session.status !== 'exited') {
    void data.restoreTerminal(card.session.id, card.projectId);
  } else {
    ui.selectTab(card.projectId, card.session.id);
  }
  ui.setWorkspaceMode(card.projectId, 'terminals');
}

export function AgentMonitor({ cards, executions = [], showProject = false, onInspectExecution }: AgentMonitorProps) {
  const sensitivity = useData((s) => s.idleAttentionSensitivity);
  const selection = useUi((s) => s.agentMonitor);
  const selectMonitorAgent = useUi((s) => s.selectMonitorAgent);
  const clearMonitorAgent = useUi((s) => s.clearMonitorAgent);
  const [pickedId, setPickedId] = useState<string | null>(null);
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

  const grouped = useMemo(() => {
    const byLane = new Map<LaneKey, FleetItem[]>();
    for (const item of jobCards) {
      const key = laneOf(item, sensitivity);
      const list = byLane.get(key) ?? [];
      list.push(item);
      byLane.set(key, list);
    }
    return LANES.map((l) => ({ key: l.key, label: l.label, cards: byLane.get(l.key) ?? [] })).filter(
      (g) => g.cards.length > 0
    );
  }, [jobCards, sensitivity]);

  const selected = useMemo(
    () =>
      resolveMonitorSelection(
        jobCards,
        selection ? { sessionId: selection.sessionId, projectId: selection.projectId } : null,
        pickedId
      ),
    [jobCards, selection, pickedId]
  );

  useEffect(() => {
    if (!selected) {
      clearMonitorAgent();
      return;
    }
    if (selected.kind === 'agent') {
      if (selection?.sessionId !== selected.card.session.id) {
        selectMonitorAgent(selected.card.session.id, selected.projectId);
      }
      return;
    }
    clearMonitorAgent();
  }, [selected, selection, selectMonitorAgent, clearMonitorAgent]);

  if (cards.length === 0) {
    return (
      <div className="agent-monitor agent-monitor--empty">
        <Bot size={28} aria-hidden="true" />
        <h4>No agents</h4>
        <p>Start an agent and it will appear here to watch live.</p>
      </div>
    );
  }

  return (
    <div
      className={`agent-monitor ${
        selected?.kind === 'thread' ? 'is-thread' : selected?.kind === 'agent' ? 'is-agent-session' : ''
      }`}
    >
      <nav className="agent-monitor-list" aria-label="Agents">
        {grouped.map((g) => (
          <div key={g.key} className="agent-monitor-group">
            <div className={`agent-monitor-group-head group-${g.key}`}>
              <span>{g.label}</span>
              <span className="agent-monitor-group-count">{g.cards.length}</span>
            </div>
            {g.cards.map((item) => (
              <AgentMonitorRow
                key={item.id}
                item={item}
                laneKey={g.key}
                active={item.id === selected?.id}
                showProject={showProject}
                onSelect={() => setPickedId(item.id)}
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
            ))}
          </div>
        ))}
      </nav>

      <AgentMonitorTerminal
        selected={selected}
        showProject={showProject}
        executions={executions}
        onInspectExecution={onInspectExecution}
      />

      {typeof document !== 'undefined' &&
        menu &&
        createPortal(
          <AgentCardMenu
            menu={menu}
            setMenu={setMenu}
            actions={actions}
            onPick={openAgentInWorkspace}
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
  onSelect: () => void;
  onContextMenu: (e: MouseEvent) => void;
}

function AgentMonitorRow({ item, laneKey, active, showProject, onSelect, onContextMenu }: RowProps) {
  const personas = usePersonas((s) => s.personas);
  if (item.kind === 'schedule') {
    return (
      <button
        type="button"
        className={`agent-monitor-row is-schedule lane-${laneKey} ${active ? 'active' : ''}${item.task.enabled ? '' : ' exited'}`}
        data-kind="schedule"
        onClick={() => useUi.getState().revealSchedule(item.task.id)}
        onContextMenu={onContextMenu}
        title={`${item.title} · ${item.projectName}`}
      >
        <span className="agent-monitor-row-icon">
          <Calendar size={14} aria-hidden="true" />
        </span>
        <span className="agent-monitor-row-text">
          <span className="agent-monitor-row-title-line">
            <span className="agent-monitor-row-title">{item.title}</span>
            <FleetKindChip kind="schedule" />
          </span>
          <span className="agent-monitor-row-meta">
            {showProject && (
              <span className="agent-monitor-row-project" title={item.projectName}>
                {item.projectName}
              </span>
            )}
            <span className="agent-monitor-row-dur">{item.task.enabled ? 'Armed' : 'Paused'}</span>
          </span>
        </span>
      </button>
    );
  }
  if (item.kind === 'thread') {
    return (
      <button
        type="button"
        className={`agent-monitor-row is-thread lane-${laneKey} ${active ? 'active' : ''}`}
        data-kind="thread"
        onClick={onSelect}
        onContextMenu={onContextMenu}
        aria-current={active ? 'true' : undefined}
        title={`${item.title} · ${item.projectName} · ${item.thread.status}`}
      >
        <span className="agent-monitor-row-icon">
          <ProviderIcon providerId={item.thread.providerId} size={14} />
        </span>
        <span className="agent-monitor-row-text">
          <span className="agent-monitor-row-title-line">
            <span className={`tab-agent-dot agent-${item.state}`} aria-hidden="true" />
            <span className="agent-monitor-row-title">{item.title}</span>
            <FleetKindChip kind="thread" />
          </span>
          <span className="agent-monitor-row-meta">
            {showProject && (
              <span className="agent-monitor-row-project" title={item.projectName}>
                {item.projectName}
              </span>
            )}
            <span className="agent-monitor-row-dur">{item.thread.status}</span>
          </span>
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
      <span
        className={`agent-monitor-row-icon tab-profile-icon profile-${t.profile} ${
          showProject && card.projectColor ? 'project-tinted' : ''
        }`}
        style={
          showProject && card.projectColor
            ? ({ '--project-color': card.projectColor } as CSSProperties)
            : undefined
        }
      >
        {persona ? personaIcon(persona, 14) : profileIcon(t.profile, 14)}
      </span>
      <span className="agent-monitor-row-text">
        <span className="agent-monitor-row-title-line">
          {!exited && <span className={`tab-agent-dot agent-${card.state}`} aria-hidden="true" />}
          {!!t.cohort?.executionId && (
            <span className="job-badge" title={`Execution-backed job member (Run ID: ${t.cohort.executionId})`} style={{ margin: 0, marginRight: 5 }}>
              job
            </span>
          )}
          <span className="agent-monitor-row-title">{t.title}</span>
          <FleetKindChip kind="agent" />
        </span>
        <span className="agent-monitor-row-meta">
          {showProject && (
            <span className="agent-monitor-row-project" title={card.projectName}>
              {card.projectName}
            </span>
          )}
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
  onInspectExecution
}: {
  selected: FleetItem | null;
  showProject: boolean;
  executions: readonly ExecutionBoardProjection[];
  onInspectExecution?: (projectId: string, executionId: string) => void;
}) {
  const agent = selected?.kind === 'agent' ? selected : null;
  const thread = selected?.kind === 'thread' ? selected : null;
  return (
    <section className="agent-monitor-main">
      {!thread && !agent && (
        <header className="agent-monitor-main-head">
          <TerminalIcon size={13} aria-hidden="true" />
          <span className="agent-monitor-main-title">No agent selected</span>
        </header>
      )}
      {!thread && agent && (
        <header className="agent-monitor-main-head">
          <TerminalIcon size={13} aria-hidden="true" />
          {!!agent.card.session.cohort?.executionId && (
            <span className="job-badge" title={`Execution-backed job member (Run ID: ${agent.card.session.cohort.executionId})`} style={{ margin: 0, marginRight: 5 }}>
              job
            </span>
          )}
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
            <ThreadDetail threadId={thread.id} embedded />
          </div>
        ) : agent ? (
          <AgentMonitorSession
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
  card,
  showProject,
  executions,
  onInspectExecution
}: {
  card: AgentCard;
  showProject: boolean;
  executions: readonly ExecutionBoardProjection[];
  onInspectExecution?: (projectId: string, executionId: string) => void;
}) {
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
  const openInWorkspace = () => openAgentInWorkspace(card);
  const canSummarize = isClaudeProfile(t.profile);
  const canFollowupClose = canCloseWithFollowup(t);
  const [summarizing, setSummarizing] = useState(false);
  const [closingWithFollowup, setClosingWithFollowup] = useState(false);
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
    setClosingWithFollowup(true);
    try {
      await closeAgentWithFollowup(t, card.projectId);
    } finally {
      setClosingWithFollowup(false);
    }
  };
  const prevId = useRef(t.id);
  if (prevId.current !== t.id) {
    prevId.current = t.id;
    if (summarizing) setSummarizing(false);
    if (closingWithFollowup) setClosingWithFollowup(false);
  }

  const monitorActions = (
    <>
      {execution && onInspectExecution && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={() => onInspectExecution(execution.projectId, execution.executionId)}
        >
          {execution.currentBlocker ? 'Respond in job details' : 'Job details'}
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
            : 'Kill and relaunch this session with the same profile and args'
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
        title="Open this agent in the full workspace view"
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
        <Trash2 size={13} /> {exited ? 'Dismiss' : 'Kill'}
      </button>
    </>
  );

  return (
    <AgentSessionView
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
