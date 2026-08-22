import { useEffect, useMemo, useState } from 'react';
import { Bot, Moon, Plus, Loader2 } from 'lucide-react';
import type { ExecutionBoardProjection, ExecutionBoardSnapshot, Project } from '@shared/types';
import { useData, useUi, useAgentStatus, useIdleTriage, useOverseerActivity, useSubagents, useFavoriteAgents, favoriteKey, listedTerminals } from '../store';
import { AgentBoardLanes, isReclaimableIdle, type AgentCard } from './AgentBoard';
import { AgentViewToggle } from './AgentViewToggle';
import { SquadFlowView } from './SquadFlowView';
import { AutonomousRunBanner } from './AutonomousRunBanner';
import { AgentMonitor } from './AgentMonitor';
import { CloseIdleAgentsDialog } from './CloseIdleAgentsDialog';
import { CohortBar, type LiveCohort } from './CohortBar';

/**
 * Per-project Agents board — the Kanban-style status board scoped to one
 * project. Cards flow across lanes by live agent state; clicking one jumps into
 * that agent's live terminal (restoring it from background first if needed),
 * reusing the same selection path the TabBar uses so the app-level
 * TerminalSurface portals the real xterm in. Plain `shell` sessions are
 * excluded — this is an agents board. Presentational lane/card rendering lives
 * in the shared {@link AgentBoardLanes}.
 */

interface Props {
  project: Project;
  onNewAgent: () => void;
}

export function ProjectAgentsBoard({ project, onNewAgent }: Props) {
  const sessions = useData((s) => s.terminals[project.id]);
  const byId = useAgentStatus((s) => s.byId);
  const sinceById = useAgentStatus((s) => s.since);
  const triageById = useIdleTriage((s) => s.byId);
  const overseerById = useOverseerActivity((s) => s.byId);
  const subagentsById = useSubagents((s) => s.byId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const selectTab = useUi((s) => s.selectTab);
  const selectProject = useUi((s) => s.selectProject);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const closeIdleAgents = useData((s) => s.closeIdleAgents);
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
  const boardView = useUi((s) => s.agentsBoardView);
  const activeTabId = selectedTabId[project.id];
  // The Close dialog targets a SET: the board's reclaimable idle agents (Close
  // button) or one cohort's idle members (a team chip). Null = closed.
  const [closeIdleTarget, setCloseIdleTarget] = useState<AgentCard[] | null>(null);
  const [busyAction, setBusyAction] = useState<null | 'close'>(null);
  const [executions, setExecutions] = useState<ExecutionBoardProjection[]>([]);
  const [hasMoreExecutions, setHasMoreExecutions] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [executionSnapshot, setExecutionSnapshot] = useState<ExecutionBoardSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const loadMoreExecutions = async () => {
    if (loadingMore || !hasMoreExecutions || executions.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = executions[executions.length - 1].createdAt;
      const next = await window.cc.executionBoard.listProject(project.id, oldest);
      setExecutions((prev) => {
        const existing = new Set(prev.map(e => e.executionId));
        const added = next.executions.filter(e => !existing.has(e.executionId));
        return [...prev, ...added];
      });
      setHasMoreExecutions(next.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void window.cc.executionBoard.listProject(project.id).then((next) => {
      if (!cancelled) {
        setExecutions((prev) => {
          if (prev.length > next.executions.length) {
            const nextMap = new Map(next.executions.map(e => [e.executionId, e]));
            return prev.map(e => nextMap.get(e.executionId) ?? e);
          }
          return next.executions;
        });
        setHasMoreExecutions(next.hasMore);
      }
    });
    refresh();
    const timer = setInterval(refresh, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [project.id, sessions]);

  // Raw slices only — derive cards behind a memo so we don't trip zustand's
  // re-render loop (see zustand-selector-stable-ref memory). Listed sessions
  // (visible + hidden-but-alive) minus plain shells.
  const cards = useMemo<AgentCard[]>(
    () =>
      listedTerminals(sessions)
        .filter((s) => s.profile !== 'shell')
        .map((s) => ({
          session: s,
          state: byId[s.id] ?? 'unknown',
          stateSince: sinceById[s.id],
          projectId: project.id,
          projectName: project.name,
          projectColor: project.color,
          triage: triageById[s.id],
          overseer: overseerById[s.id],
          liveSubagents: subagentsById[s.id] ?? 0
        })),
    [sessions, byId, sinceById, triageById, overseerById, subagentsById, project.id, project.name, project.color]
  );

  const totalLive = cards.filter((c) => c.session.status !== 'exited').length;
  // Target set for the board Close action: idle agents that aren't parked on a
  // question, aren't background workers, and aren't STARRED — a favorite is the
  // user's explicit "leave this pinned", so a bulk sweep must pass it by (it can
  // still be closed from its own card/modal).
  const reclaimableAgents = useMemo(
    () => cards.filter((c) => isReclaimableIdle(c) && !favoriteIds[favoriteKey(c.session)]),
    [cards, favoriteIds]
  );

  // Card click → peek at the agent in the inspector modal (no nav change).
  const inspect = (c: AgentCard) => {
    const executionId = c.session.cohort?.executionId;
    if (executionId) {
      setSnapshotLoading(true);
      void window.cc.executionBoard.snapshot(project.id, executionId).then((snapshot) => setExecutionSnapshot(snapshot ?? null)).finally(() => setSnapshotLoading(false));
      return;
    }
    useUi.getState().openAgentModal(c.session.id, project.id);
  };

  const loadOlderExecutionEvents = () => {
    if (!executionSnapshot?.truncated) return;
    setSnapshotLoading(true);
    void window.cc.executionBoard.snapshot(project.id, executionSnapshot.execution.executionId, executionSnapshot.nextAfter)
      .then((next) => {
        if (!next) return;
        setExecutionSnapshot((current) => current ? {
          ...next,
          events: [...current.events, ...next.events]
        } : next);
      })
      .finally(() => setSnapshotLoading(false));
  };

  // Context-menu "Open"/"View" → the heavier navigate-to-workspace path.
  const pick = (c: AgentCard) => {
    selectProject(project.id);
    if (c.session.headless && c.session.status !== 'exited') {
      void restoreTerminal(c.session.id, project.id);
    } else {
      selectTab(project.id, c.session.id);
    }
    // Switch the workspace from the agents board to the terminal view, so the
    // click actually surfaces the agent's live instance (restoreTerminal/
    // selectTab only select it — the board would otherwise keep covering it).
    setWorkspaceMode(project.id, 'terminals');
  };

  return (
    <div className="agents-board">
      <div className="agents-board-header">
        {/* No <h3>Agents</h3> here: the per-project Workspace topbar already
            renders the "Agents" mode label (Workspace.tsx), so repeating it in
            the board header duplicated the title. The count chip below is the
            board's own status line. The cross-project GlobalAgentsBoard has no
            topbar, so it keeps its <h3> as the sole title. */}
        <span className="agents-board-count">
          {totalLive} {totalLive === 1 ? 'agent' : 'agents'} live
        </span>
        <span className="grow" />
        {/* Keep the toggle when in list view even with no agents, so closing the
            last agent can't trap the user in list view with no way back. */}
        {(cards.length > 0 || boardView === 'list' || boardView === 'flow') && <AgentViewToggle />}
        {reclaimableAgents.length > 0 && (
          <button
            type="button"
            className="btn agents-board-close-idle"
            onClick={() => setCloseIdleTarget(reclaimableAgents)}
            disabled={busyAction !== null}
            title="Close every idle agent that isn't waiting on a question or starred (working and blocked agents are left running)"
          >
            {busyAction === 'close' ? <Loader2 size={14} className="gus-spin" /> : <Moon size={14} />}
            {busyAction === 'close'
              ? `Closing (${reclaimableAgents.length})…`
              : `Close (${reclaimableAgents.length})`}
          </button>
        )}
        <button
          type="button"
          className="btn primary agents-board-new"
          onClick={onNewAgent}
          title="Start a new agent in this project"
        >
          <Plus size={14} />
          New agent
        </button>
      </div>

      <AutonomousRunBanner projectId={project.id} />
      {executionSnapshot && (
        <section className="execution-details" aria-label="Job details">
          <header>
            <strong>{executionSnapshot.execution.jobTitle}</strong>
            <button type="button" onClick={() => setExecutionSnapshot(null)}>Close details</button>
          </header>
          <div className="execution-details-events">
            {executionSnapshot.events.map((event) => (
              <details key={event.id}>
                <summary>{event.severity}: {event.summary}</summary>
                {event.detail && <p>{event.detail}</p>}
                {event.blocker && <p>Blocker: {event.blocker.question}</p>}
                {event.progress && <p>Progress: {event.progress.completed}/{event.progress.total}</p>}
                {event.blocker && event.slotId && (
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const message = replyDrafts[event.id]?.trim();
                    if (!message) return;
                    setSnapshotLoading(true);
                    const action = executionSnapshot.execution.state === 'BLOCKED'
                      ? window.cc.executionBoard.resume
                      : window.cc.executionBoard.respond;
                    void action(project.id, executionSnapshot.execution.executionId, executionSnapshot.execution.stateVersion ?? 0, event.slotId!, message)
                      .then((result) => {
                        if (!result.ok) useUi.getState().pushToast(`Job response failed: ${result.message ?? result.code}`, 'error');
                      })
                      .finally(() => setSnapshotLoading(false));
                  }}>
                    <input
                      value={replyDrafts[event.id] ?? ''}
                      onChange={(e) => setReplyDrafts((current) => ({ ...current, [event.id]: e.target.value }))}
                      placeholder="Respond to blocker"
                    />
                    <button type="submit" disabled={snapshotLoading}>Send</button>
                  </form>
                )}
              </details>
            ))}
          </div>
          {executionSnapshot.truncated && (
            <button type="button" disabled={snapshotLoading} onClick={loadOlderExecutionEvents}>
              {snapshotLoading ? 'Loading...' : 'Load older events'}
            </button>
          )}
          {executionSnapshot.artifacts.length > 0 && (
            <div className="execution-details-artifacts">
              {executionSnapshot.artifacts.map((artifact) => (
                <div key={artifact.id}>{artifact.name} ({artifact.mediaType})</div>
              ))}
            </div>
          )}
        </section>
      )}
      {/* Live Team cohorts launched into this project — one chip per launch, with
          a per-team Close scoped to that cohort (same reclaimable filter as the
          board buttons: skips question-parked, background, and starred members).
          Only on the board view — Flow/List are full custom views with no cohort
          bar. */}
      {boardView === 'board' && (
        <CohortBar
          cards={cards}
          onCloseIdle={(co: LiveCohort) =>
            setCloseIdleTarget(
              co.cards.filter(
                (c) => isReclaimableIdle(c) && !favoriteIds[favoriteKey(c.session)]
              )
            )
          }
        />
      )}

      {boardView === 'flow' ? (
        <SquadFlowView projectId={project.id} />
      ) : boardView === 'list' ? (
        <AgentMonitor cards={cards} />
      ) : cards.length === 0 ? (
        <div className="agents-board-empty">
          <Bot size={28} aria-hidden="true" />
          <h4>No agents yet</h4>
          <p>Start a Claude session in this project and watch it move across the board.</p>
          <button type="button" className="btn primary" onClick={onNewAgent}>
            <Plus size={14} />
            New agent
          </button>
        </div>
      ) : (
        <AgentBoardLanes cards={cards} activeId={activeTabId} onInspect={inspect} onPick={pick} executions={executions} hasMoreExecutions={hasMoreExecutions} onLoadMoreExecutions={loadMoreExecutions} />
      )}

      {closeIdleTarget && (
        <CloseIdleAgentsDialog
          agents={closeIdleTarget}
          projectName={project.name}
          action="close"
          onClose={() => setCloseIdleTarget(null)}
          onConfirm={(summarize) => {
            // Snapshot the ids now — the dialog closes immediately and the cards
            // list will change underneath us as sessions die. Same path whether
            // the target is the board's reclaimable set or one cohort's members.
            const ids = closeIdleTarget.map((c) => c.session.id);
            setCloseIdleTarget(null);
            setBusyAction('close');
            void closeIdleAgents(project.id, ids, summarize).finally(() => setBusyAction(null));
          }}
        />
      )}

    </div>
  );
}
