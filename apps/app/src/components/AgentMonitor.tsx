import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Bot,
  ExternalLink,
  Inbox,
  Loader2,
  RotateCw,
  Square,
  Trash2,
  Terminal as TerminalIcon
} from 'lucide-react';
import type { AgentState } from '@zana-ai/zcc-domain/product';
import { useData, useUi, usePersonas, useAgentPanel } from '../store.js';
import { profileIcon, personaIcon } from '../lib/profileIcon.js';
import { isClaudeProfile } from '../lib/launchProfile.js';
import { AGENT_MONITOR_TERMINAL_ANCHOR_ID } from './TerminalSurface.js';
import { useAgentCardActions } from './agentCardActions.js';
import { AgentDetailPanel } from './AgentDetailPanel.js';
import {
  LANES,
  cardCohort,
  formatDuration,
  isBackgroundAgent,
  type AgentCard,
  type IdleAttentionSensitivity,
  type LaneKey
} from './AgentBoard.js';

/**
 * The Agents "List" view: a three-pane live monitor — agent list (left),
 * the selected agent's LIVE terminal (center), and its status + actions
 * (right). Replaces the old mesh/registry panel as the List toggle target.
 *
 * The center pane does NOT re-create a terminal: TerminalSurface portals the
 * selected session's already-live xterm into {@link AGENT_MONITOR_TERMINAL_ANCHOR_ID}
 * (the one-xterm-per-session invariant), exactly like the agent-inspector modal
 * — so scrollback is shared with the agent's workspace tab and the prompt stays
 * interactive right here. Selection is held in the UI store (`agentMonitor`);
 * this component owns that selection's lifecycle and CLEARS it on unmount, so a
 * stale selection can never steal the live terminal from the Projects workspace
 * once the List view is off screen.
 *
 * Fed a flat {@link AgentCard}[] by whichever board hosts it (global or
 * per-project), so it honors the same filter/scope the board already applied.
 */

const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  unknown: 'Idle'
};

interface AgentMonitorProps {
  cards: AgentCard[];
  /** Show the owning-project chip on rows + in the status pane (global board). */
  showProject?: boolean;
}

/** Which lane a card sits in — reuses the board's exact lane predicates so the
 *  monitor list groups identically to the Kanban. First match wins (lanes are
 *  ordered most-urgent first). */
function laneOf(card: AgentCard, sensitivity: IdleAttentionSensitivity): LaneKey {
  const lane = LANES.find((l) => l.match(card, sensitivity));
  return lane?.key ?? 'idle';
}

export function AgentMonitor({ cards, showProject = false }: AgentMonitorProps) {
  const sensitivity = useData((s) => s.idleAttentionSensitivity);
  const selection = useUi((s) => s.agentMonitor);
  const selectMonitorAgent = useUi((s) => s.selectMonitorAgent);
  const clearMonitorAgent = useUi((s) => s.clearMonitorAgent);
  const collapsed = useAgentPanel((s) => s.collapsed.monitor);

  // Own the selection's lifecycle: clear it when the monitor unmounts (the user
  // left the List view). This keeps `agentMonitor` non-null ONLY while this pane
  // is on screen, so TerminalSurface never portals the live xterm here once the
  // Projects workspace should own it again. Mount-only — the cleanup captures
  // the stable store action.
  useEffect(() => () => clearMonitorAgent(), [clearMonitorAgent]);

  // Group cards into the board's lanes, then flatten into a single ordered list
  // with lane headers — the list reads top-to-bottom by urgency (Needs you →
  // Working → Idle → Done), mirroring the Kanban's lane order.
  const grouped = useMemo(() => {
    const byLane = new Map<LaneKey, AgentCard[]>();
    for (const c of cards) {
      const key = laneOf(c, sensitivity);
      const list = byLane.get(key) ?? [];
      list.push(c);
      byLane.set(key, list);
    }
    return LANES.map((l) => ({ key: l.key, label: l.label, cards: byLane.get(l.key) ?? [] })).filter(
      (g) => g.cards.length > 0
    );
  }, [cards, sensitivity]);

  // The selected card, resolved from the live card list (so its state/badges
  // stay fresh). Falls back to the first card when the selection is absent or
  // stale (its session died / was filtered out) — the monitor always shows
  // *something* when any agent exists.
  const selected = useMemo(() => {
    const bySel =
      selection && cards.find((c) => c.session.id === selection.sessionId);
    return bySel ?? cards[0] ?? null;
  }, [cards, selection]);

  // Keep the store selection in sync with the resolved fallback, so the surface
  // portals the right session even before the user clicks. Only writes when it
  // actually differs (avoids a set-in-render loop).
  useEffect(() => {
    if (!selected) return;
    if (selection?.sessionId !== selected.session.id) {
      selectMonitorAgent(selected.session.id, selected.projectId);
    }
  }, [selected, selection, selectMonitorAgent]);

  if (cards.length === 0) {
    return (
      <div className="agent-monitor agent-monitor--empty">
        <Bot size={28} aria-hidden="true" />
        <h4>No agents running</h4>
        <p>Start a Claude session and it will appear here to watch live.</p>
      </div>
    );
  }

  return (
    <div className={`agent-monitor ${collapsed ? 'panel-collapsed' : ''}`}>
      <nav className="agent-monitor-list" aria-label="Agents">
        {grouped.map((g) => (
          <div key={g.key} className="agent-monitor-group">
            <div className={`agent-monitor-group-head group-${g.key}`}>
              <span>{g.label}</span>
              <span className="agent-monitor-group-count">{g.cards.length}</span>
            </div>
            {g.cards.map((c) => (
              <AgentMonitorRow
                key={c.session.id}
                card={c}
                laneKey={g.key}
                active={c.session.id === selected?.session.id}
                showProject={showProject}
                onSelect={() => selectMonitorAgent(c.session.id, c.projectId)}
              />
            ))}
          </div>
        ))}
      </nav>

      <AgentMonitorTerminal selected={selected} />

      {selected && <AgentMonitorStatus card={selected} showProject={showProject} />}
    </div>
  );
}

// ── Left pane: one agent row ────────────────────────────────────────────────

interface RowProps {
  card: AgentCard;
  laneKey: LaneKey;
  active: boolean;
  showProject: boolean;
  onSelect: () => void;
}

function AgentMonitorRow({ card, laneKey, active, showProject, onSelect }: RowProps) {
  const personas = usePersonas((s) => s.personas);
  const { session: t } = card;
  const exited = t.status === 'exited';
  const persona = t.personaId ? personas.find((p) => p.id === t.personaId) : undefined;
  const subtitle = persona?.name ?? t.profile;
  // Live "running for X"; the parent board already runs a 1s tick, but the row
  // is cheap to recompute so we lean on the surrounding board re-render.
  const dur = formatDuration(
    (exited ? t.finishedAt ?? t.createdAt : Date.now()) - t.createdAt
  );

  return (
    <button
      type="button"
      className={`agent-monitor-row lane-${laneKey} ${active ? 'active' : ''} ${exited ? 'exited' : ''}`}
      onClick={onSelect}
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
          <span className="agent-monitor-row-title">{t.title}</span>
        </span>
        <span className="agent-monitor-row-meta">
          {showProject && (
            <span className="agent-monitor-row-project" title={card.projectName}>
              {/* No colored project dot here — the project-tinted ring around
                  the agent icon already carries the project's color. */}
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

function AgentMonitorTerminal({ selected }: { selected: AgentCard | null }) {
  return (
    <section className="agent-monitor-main">
      <header className="agent-monitor-main-head">
        <TerminalIcon size={13} aria-hidden="true" />
        {selected ? (
          <>
            <span className="agent-monitor-main-title">{selected.session.title}</span>
            {selected.session.status !== 'exited' && (
              <span className={`agent-monitor-main-state agent-${selected.state}`}>
                <span className={`tab-agent-dot agent-${selected.state}`} aria-hidden="true" />
                {STATE_LABEL[selected.state]}
              </span>
            )}
          </>
        ) : (
          <span className="agent-monitor-main-title">No agent selected</span>
        )}
      </header>
      {/* TerminalSurface portals the selected session's live xterm into this
          anchor while the List view is on screen (see the monitor anchor id).
          The anchor is positioned; the surface fills it via inset:0. */}
      <div className="agent-monitor-terminal" id={AGENT_MONITOR_TERMINAL_ANCHOR_ID}>
        {!selected && (
          <div className="agent-monitor-terminal-empty">
            <Bot size={24} aria-hidden="true" />
            <p>Select an agent to watch its output.</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Right pane: status + actions ────────────────────────────────────────────

function AgentMonitorStatus({ card, showProject }: { card: AgentCard; showProject: boolean }) {
  const { actions } = useAgentCardActions();
  const toggleCollapse = useAgentPanel((s) => s.toggle);
  const collapsed = useAgentPanel((s) => s.collapsed.monitor);
  const { session: t } = card;
  const exited = t.status === 'exited';
  const background = isBackgroundAgent(card);
  const cohort = cardCohort(card);

  // "Open in workspace" — the escape hatch into the full split-pane view, same
  // path the board card's context-menu "Open" uses.
  const openInWorkspace = () => {
    const ui = useUi.getState();
    const data = useData.getState();
    ui.setNav('projects');
    ui.enterProjectFocus(card.projectId);
    if (t.headless && !exited) {
      void data.restoreTerminal(t.id, card.projectId);
    } else {
      ui.selectTab(card.projectId, t.id);
    }
    ui.setWorkspaceMode(card.projectId, 'terminals');
  };

  // Summarize this agent's work to the inbox (claude-family only — a shell has
  // no transcript). Guards against a double-click while the micro-call is live.
  const canSummarize = isClaudeProfile(t.profile);
  const [summarizing, setSummarizing] = useState(false);
  const summarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    try {
      await useData.getState().summarizeSession(t.id, card.projectId);
    } finally {
      setSummarizing(false);
    }
  };
  // Reset the transient summarizing flag whenever the selection changes, so a
  // spinner from one agent doesn't bleed onto the next.
  const prevId = useRef(t.id);
  if (prevId.current !== t.id) {
    prevId.current = t.id;
    if (summarizing) setSummarizing(false);
  }

  // Monitor action semantics: Stop is a NON-destructive Ctrl-C (session stays
  // alive), distinct from the modal's kill-the-process Stop; Kill terminates and
  // removes the card. Passed into the shared panel so its look matches the modal
  // while each surface keeps its own behavior.
  const monitorActions = (
    <>
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
    <AgentDetailPanel
      variant="monitor"
      session={t}
      projectId={card.projectId}
      projectName={card.projectName}
      projectColor={card.projectColor}
      state={card.state}
      showProject={showProject}
      cohort={cohort}
      background={background}
      actions={monitorActions}
      collapsed={collapsed}
      onToggleCollapse={() => toggleCollapse('monitor')}
    />
  );
}
