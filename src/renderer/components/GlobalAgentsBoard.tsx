import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Moon, Plus, Search, X, Loader2 } from 'lucide-react';
import type { ExecutionBoardProjection, TerminalSession } from '@shared/types';
import { useData, useUi, useAgentStatus, useIdleTriage, useOverseerActivity, useSubagents, useFavoriteAgents, favoriteKey, listedTerminals } from '../store';
import { AgentBoardLanes, isReclaimableIdle, type AgentCard } from './AgentBoard';
import { AgentViewToggle } from './AgentViewToggle';
import { SquadFlowView } from './SquadFlowView';
import { AgentMonitor } from './AgentMonitor';
import { CloseIdleAgentsDialog } from './CloseIdleAgentsDialog';
import { CohortBar, type LiveCohort } from './CohortBar';
import { AgentLauncher } from './AgentLauncher';
import { ExecutionJobDetails } from './ExecutionJobDetails';

/**
 * The cross-project Agents Kanban: a board of every agent across ALL projects,
 * so you see the whole fleet working at a glance. Same lanes/animations as the
 * per-project board (shared {@link AgentBoardLanes}), but each card carries a
 * project chip. Owns column 3 in two places: the Projects-nav home when NO
 * project is opened, and the dedicated Agents nav (where the column-2
 * {@link AgentsListPane} lists the same fleet grouped by liveness).
 *
 * Clicking a card OPENS that card's project (enterProjectFocus) and focuses the
 * agent's terminal — restoring it from background first if it's headless — so a
 * click takes you straight from the fleet view into that agent's live session.
 * Plain `shell` sessions are excluded; this is an agents board.
 */
export function GlobalAgentsBoard() {
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const byId = useAgentStatus((s) => s.byId);
  const sinceById = useAgentStatus((s) => s.since);
  const triageById = useIdleTriage((s) => s.byId);
  const overseerById = useOverseerActivity((s) => s.byId);
  const subagentsById = useSubagents((s) => s.byId);
  const enterProjectFocus = useUi((s) => s.enterProjectFocus);
  const setNav = useUi((s) => s.setNav);
  const selectTab = useUi((s) => s.selectTab);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const closeIdleAgents = useData((s) => s.closeIdleAgents);
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
  const boardView = useUi((s) => s.agentsBoardView);
  // Narrow the board to a subset — matches project name OR the agent's title,
  // so you can hone in on one project or one task across the fleet.
  const [filter, setFilter] = useState('');
  // The Close dialog targets a SET of reclaimable agents: the whole fleet (Close
  // button) or one cohort's members (a team chip's Close). Null = closed.
  const [closeIdleTarget, setCloseIdleTarget] = useState<AgentCard[] | null>(null);
  const [busyAction, setBusyAction] = useState<null | 'close'>(null);
  // The "New agent" launcher — the same AgentLauncher the column-2 list uses,
  // but here it can target any registered project (its default is the scratch
  // workspace). Opened from the primary button in the header.
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [executions, setExecutions] = useState<ExecutionBoardProjection[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<{ projectId: string; executionId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void Promise.all(projects.map((project) => window.cc.executionBoard.listProject(project.id))).then((lists) => {
      if (!cancelled) setExecutions(lists.flatMap((list) => list.executions));
    });
    refresh();
    const timer = setInterval(refresh, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [projects, terminals]);

  // Flatten every project's listed (visible + hidden-but-alive) non-shell
  // sessions into one card list. Raw store slices only; derive behind a memo so
  // a status tick doesn't rebuild the world (render-storm guard).
  const cards = useMemo<AgentCard[]>(() => {
    const byProjectId = new Map(projects.map((p) => [p.id, p]));
    const out: AgentCard[] = [];
    for (const [projectId, list] of Object.entries(terminals)) {
      const project = byProjectId.get(projectId);
      if (!project) continue; // tombstoned/unknown project — skip
      for (const s of listedTerminals(list)) {
        if (s.profile === 'shell') continue;
        out.push({
          session: s,
          state: byId[s.id] ?? 'unknown',
          stateSince: sinceById[s.id],
          projectId,
          projectName: project.name,
          projectColor: project.color,
          triage: triageById[s.id],
          overseer: overseerById[s.id],
          liveSubagents: subagentsById[s.id] ?? 0
        });
      }
    }
    return out;
  }, [terminals, projects, byId, sinceById, triageById, overseerById, subagentsById]);

  // Apply the text filter (project name OR agent title). Cheap derive — runs
  // on a tiny in-memory list, no need to memoize.
  const q = filter.trim().toLowerCase();
  const visibleCards = q
    ? cards.filter(
        (c) =>
          c.projectName.toLowerCase().includes(q) || c.session.title.toLowerCase().includes(q)
      )
    : cards;

  const liveCount = visibleCards.filter((c) => c.session.status !== 'exited').length;
  const projectsWithAgents = new Set(
    visibleCards.filter((c) => c.session.status !== 'exited').map((c) => c.projectId)
  ).size;
  // Target set for the board Close action, over the currently-visible
  // (filter-respecting) cards so the button can't disagree with what the user
  // sees. Idle, not parked on a question, not a background worker, and
  // not STARRED — a favorite is pinned by the user, so a bulk sweep passes it by
  // (it can still be closed from its own card/modal). Spans every project.
  const reclaimableAgents = useMemo(
    () => visibleCards.filter((c) => isReclaimableIdle(c) && !favoriteIds[favoriteKey(c.session)]),
    [visibleCards, favoriteIds]
  );

  // Card click → peek at the agent in the inspector modal (no nav change).
  const inspect = (c: AgentCard) => {
    if (c.session.cohort?.executionId) {
      setSelectedExecution({ projectId: c.projectId, executionId: c.session.cohort.executionId });
      return;
    }
    useUi.getState().openAgentModal(c.session.id, c.projectId);
  };

  // Stable launcher props so the memoized AgentLauncher doesn't re-render
  // (and drop keystrokes) on this board's 1s tick / agent-status churn.
  const closeLauncher = useCallback(() => setLauncherOpen(false), []);
  const onLauncherLaunched = useCallback(
    (session: TerminalSession, projectId: string) =>
      useUi.getState().openAgentModal(session.id, projectId),
    []
  );

  // Context-menu "Open"/"View" → the heavier navigate-to-workspace path.
  const pick = (c: AgentCard) => {
    // Open the card's project, then focus the agent's tab (restoring a headless
    // session into the strip first). enterProjectFocus also selects the project.
    // setNav matters when this board is shown under the Agents nav: a click
    // graduates the agent into Projects. Under the Projects nav it's a no-op.
    setNav('projects');
    enterProjectFocus(c.projectId);
    if (c.session.headless && c.session.status !== 'exited') {
      void restoreTerminal(c.session.id, c.projectId);
    } else {
      selectTab(c.projectId, c.session.id);
    }
    // Land on the terminal, not whatever workspace mode that project was last
    // in (e.g. its own agents board) — so the click opens the live instance.
    setWorkspaceMode(c.projectId, 'terminals');
  };

  return (
    <main className="agents-board agents-board--global">
      <div className="agents-board-header">
        <h3>Agents</h3>
        <span className="agents-board-count">
          {liveCount} live{projectsWithAgents > 0 ? ` · ${projectsWithAgents} ${projectsWithAgents === 1 ? 'project' : 'projects'}` : ''}
        </span>
        <span className="grow" />
        {/* Show the toggle whenever there's something to switch between OR we're
            already in list view — otherwise closing the last agent while in list
            view would strip the toggle and trap the user there. */}
        {(cards.length > 0 || boardView === 'list' || boardView === 'flow') && <AgentViewToggle />}
        {reclaimableAgents.length > 0 && (
          <button
            type="button"
            className="btn agents-board-close-idle"
            onClick={() => setCloseIdleTarget(reclaimableAgents)}
            disabled={busyAction !== null}
            title="Close every idle agent that isn't waiting on a question or starred, across all projects (working and blocked agents are left running)"
          >
            {busyAction === 'close' ? <Loader2 size={14} className="gus-spin" /> : <Moon size={14} />}
            {busyAction === 'close'
              ? `Closing (${reclaimableAgents.length})…`
              : `Close (${reclaimableAgents.length})`}
          </button>
        )}
        {cards.length > 0 && (
          <div className="agents-board-filter">
            <Search size={12} className="agents-board-filter-icon" aria-hidden="true" />
            <input
              type="text"
              placeholder="Filter by project or task…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter agents"
            />
            {filter && (
              <button
                type="button"
                className="agents-board-filter-clear"
                aria-label="Clear filter"
                onClick={() => setFilter('')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          className="btn primary agents-board-new"
          onClick={() => setLauncherOpen(true)}
          title="Start a new agent — in any project or the scratch workspace"
        >
          <Plus size={14} />
          New agent
        </button>
      </div>
      <div className="agents-board-content">
      {selectedExecution && <ExecutionJobDetails projectId={selectedExecution.projectId} executionId={selectedExecution.executionId} onClose={() => setSelectedExecution(null)} />}

      {/* Live Team cohorts — one chip per launch, with a per-team Close scoped to
          that cohort (same reclaimable filter as the board buttons: skips
          question-parked, background, and starred members). Only on the board
          view — Flow/List are full custom views with no cohort bar; renders
          nothing when no team is live. */}
      {boardView === 'board' && (
        <CohortBar
          cards={visibleCards}
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
        <SquadFlowView onInspectExecution={(projectId, executionId) => setSelectedExecution({ projectId, executionId })} />
      ) : boardView === 'list' ? (
        <AgentMonitor cards={visibleCards} executions={executions} showProject onInspectExecution={(projectId, executionId) => setSelectedExecution({ projectId, executionId })} />
      ) : cards.length === 0 && executions.length === 0 ? (
        <div className="agents-board-empty">
          <Bot size={28} aria-hidden="true" />
          <h4>No agents running</h4>
          <p>
            Open a project on the left and start a Claude session — it&rsquo;ll appear here, across
            every project.
          </p>
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="agents-board-empty">
          <Bot size={28} aria-hidden="true" />
          <h4>No matches</h4>
          <p>
            No agents match &ldquo;{filter.trim()}&rdquo;.{' '}
            <button type="button" className="list-empty-link" onClick={() => setFilter('')}>
              Clear filter
            </button>
          </p>
        </div>
      ) : (
        <AgentBoardLanes cards={visibleCards} onInspect={inspect} onPick={pick} showProject executions={executions} onDismissExecution={(executionId) => {
          setExecutions((current) => current.filter((execution) => execution.executionId !== executionId));
          setSelectedExecution((current) => current?.executionId === executionId ? null : current);
        }} />
      )}
      </div>

      {closeIdleTarget && (
        <CloseIdleAgentsDialog
          agents={closeIdleTarget}
          action="close"
          onClose={() => setCloseIdleTarget(null)}
          onConfirm={(summarize) => {
            // Snapshot + group by project NOW — the dialog closes immediately and
            // the cards list changes underneath us as sessions die. The store's
            // close action is project-scoped (one inbox wrap-up per project), so
            // we fan out one call per project the reclaimable agents span. Run the
            // projects SEQUENTIALLY: each project's call bounds its own summary
            // concurrency, so awaiting between projects keeps the total number of
            // in-flight `claude` children bounded rather than 5×(#projects).
            const byProject = new Map<string, string[]>();
            for (const c of closeIdleTarget) {
              const list = byProject.get(c.projectId) ?? [];
              list.push(c.session.id);
              byProject.set(c.projectId, list);
            }
            setCloseIdleTarget(null);
            setBusyAction('close');
            void (async () => {
              for (const [projectId, ids] of byProject) {
                await closeIdleAgents(projectId, ids, summarize);
              }
            })().finally(() => setBusyAction(null));
          }}
        />
      )}

      {launcherOpen && (
        <AgentLauncher
          onClose={closeLauncher}
          // Stay on the fleet board and pop the agent-inspector modal on the new
          // session (mirrors clicking a card), rather than navigating into the
          // target project — same behavior as the column-2 list's "+".
          onLaunched={onLauncherLaunched}
        />
      )}
    </main>
  );
}
