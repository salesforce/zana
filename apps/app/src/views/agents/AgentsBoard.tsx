import { useMemo, useState } from 'react';
import { Bot, Moon, Plus, Search, X, Loader2 } from 'lucide-react';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  useData,
  useUi,
  useAgentStatus,
  useIdleTriage,
  useOverseerActivity,
  useSubagents,
  useFavoriteAgents,
  favoriteKey,
  listedTerminals
} from '@/store';
import { AgentBoardLanes, isReclaimableIdle, type AgentCard } from '@/components/AgentBoard';
import { AgentViewToggle } from '@/components/AgentViewToggle';
import { SquadFlowView } from '@/views/agents/SquadFlowView';
import { AutonomousRunBanner } from '@/components/AutonomousRunBanner';
import { AgentMonitor } from '@/components/AgentMonitor';
import { CloseIdleAgentsDialog } from '@/components/CloseIdleAgentsDialog';
import { CohortBar, type LiveCohort } from '@/components/CohortBar';
import { AuroraGrid } from '@/components/AuroraGrid';
import { HomeAgentComposer } from '@/components/HomeAgentComposer';

/**
 * One Agents Kanban, two scopes. Global (`kind: 'global'`) flattens every
 * project's listed non-shell sessions; project scope keeps the same lanes /
 * list / flow / empty composer but filters to one workspace. Presentational
 * lane/card rendering lives in the shared {@link AgentBoardLanes}.
 *
 * New agent never mounts a launcher here — it flips `useUi.launcherOpen` so
 * App (fleet) or Workspace (project) hosts the shared modal.
 */

export type AgentsBoardScope =
  | { kind: 'global' }
  | { kind: 'project'; project: Project };

function groupSessionIdsByProject(cards: AgentCard[]): Map<string, string[]> {
  const byProject = new Map<string, string[]>();
  for (const c of cards) {
    const list = byProject.get(c.projectId) ?? [];
    list.push(c.session.id);
    byProject.set(c.projectId, list);
  }
  return byProject;
}

function toCard(
  session: TerminalSession,
  project: Project,
  byId: Record<string, AgentCard['state'] | undefined>,
  sinceById: Record<string, number | undefined>,
  triageById: Record<string, AgentCard['triage']>,
  overseerById: Record<string, AgentCard['overseer']>,
  subagentsById: Record<string, number | undefined>
): AgentCard {
  return {
    session,
    state: byId[session.id] ?? 'unknown',
    stateSince: sinceById[session.id],
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color,
    triage: triageById[session.id],
    overseer: overseerById[session.id],
    liveSubagents: subagentsById[session.id] ?? 0
  };
}

export function AgentsBoard({ scope }: { scope: AgentsBoardScope }) {
  const isGlobal = scope.kind === 'global';
  const scopedProject = scope.kind === 'project' ? scope.project : undefined;

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
  const selectProject = useUi((s) => s.selectProject);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const closeIdleAgents = useData((s) => s.closeIdleAgents);
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
  const boardView = useUi((s) => s.agentsBoardView);
  const [filter, setFilter] = useState('');
  const [closeIdleTarget, setCloseIdleTarget] = useState<AgentCard[] | null>(null);
  const [busyAction, setBusyAction] = useState<null | 'close'>(null);

  const cards = useMemo<AgentCard[]>(() => {
    const byProjectId = new Map(projects.map((p) => [p.id, p]));
    if (scopedProject) {
      return listedTerminals(terminals[scopedProject.id])
        .filter((s) => s.profile !== 'shell')
        .map((s) =>
          toCard(s, scopedProject, byId, sinceById, triageById, overseerById, subagentsById)
        );
    }
    const out: AgentCard[] = [];
    for (const [projectId, list] of Object.entries(terminals)) {
      const project = byProjectId.get(projectId);
      if (!project) continue;
      for (const s of listedTerminals(list)) {
        if (s.profile === 'shell') continue;
        out.push(toCard(s, project, byId, sinceById, triageById, overseerById, subagentsById));
      }
    }
    return out;
  }, [
    terminals,
    projects,
    scopedProject,
    byId,
    sinceById,
    triageById,
    overseerById,
    subagentsById
  ]);

  const q = isGlobal ? filter.trim().toLowerCase() : '';
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
  const reclaimableAgents = useMemo(
    () => visibleCards.filter((c) => isReclaimableIdle(c) && !favoriteIds[favoriteKey(c.session)]),
    [visibleCards, favoriteIds]
  );
  const activeTabId = scopedProject ? selectedTabId[scopedProject.id] : undefined;

  const inspect = (c: AgentCard) => {
    useUi.getState().openAgentModal(c.session.id, c.projectId);
  };

  const pick = (c: AgentCard) => {
    if (isGlobal) {
      setNav('projects');
      enterProjectFocus(c.projectId);
    } else {
      selectProject(c.projectId);
    }
    if (c.session.headless && c.session.status !== 'exited') {
      void restoreTerminal(c.session.id, c.projectId);
    } else {
      selectTab(c.projectId, c.session.id);
    }
    setWorkspaceMode(c.projectId, 'terminals');
  };

  const confirmCloseIdle = (summarize: boolean) => {
    if (!closeIdleTarget) return;
    const byProject = groupSessionIdsByProject(closeIdleTarget);
    setCloseIdleTarget(null);
    setBusyAction('close');
    void (async () => {
      for (const [projectId, ids] of byProject) {
        await closeIdleAgents(projectId, ids, summarize);
      }
    })().finally(() => setBusyAction(null));
  };

  return (
    <div className={isGlobal ? 'agents-board agents-board--global panel-body--full' : 'agents-board'}>
      <header className="agents-board-header">
        {isGlobal ? <h1>Agents</h1> : (
          <span className="agents-board-count">
            {liveCount} {liveCount === 1 ? 'agent' : 'agents'} live
          </span>
        )}
        <div className="agents-board-header-actions">
          {isGlobal && (
            <span className="agents-board-count">
              {liveCount} live
              {projectsWithAgents > 0 && (
                <span className="agents-board-count-extra">
                  {` · ${projectsWithAgents} ${projectsWithAgents === 1 ? 'project' : 'projects'}`}
                </span>
              )}
            </span>
          )}
          {(cards.length > 0 || boardView === 'list' || boardView === 'flow') && <AgentViewToggle />}
          {reclaimableAgents.length > 0 && (
            <button
              type="button"
              className="btn agents-board-close-idle"
              onClick={() => setCloseIdleTarget(reclaimableAgents)}
              disabled={busyAction !== null}
              aria-label={
                busyAction === 'close'
                  ? `Closing ${reclaimableAgents.length} idle agents`
                  : `Close ${reclaimableAgents.length} idle agents`
              }
              title={
                isGlobal
                  ? "Close every idle agent that isn't waiting on a question or starred, across all projects (working and blocked agents are left running)"
                  : "Close every idle agent that isn't waiting on a question or starred (working and blocked agents are left running)"
              }
            >
              {busyAction === 'close' ? <Loader2 size={14} className="gus-spin" /> : <Moon size={14} />}
              <span className="agents-board-btn-label">
                {busyAction === 'close' ? 'Closing' : 'Close'}
              </span>
              <span className="agents-board-btn-count">
                ({reclaimableAgents.length}){busyAction === 'close' ? '…' : ''}
              </span>
            </button>
          )}
          {isGlobal && cards.length > 0 && (
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
            onClick={() => useUi.getState().setLauncherOpen(true)}
            aria-label="New agent"
            title={
              isGlobal
                ? 'Start a new agent — in any project or the scratch workspace'
                : 'Start a new agent in this project'
            }
          >
            <Plus size={14} />
            <span className="agents-board-btn-label">New agent</span>
          </button>
        </div>
      </header>

      {scopedProject && <AutonomousRunBanner projectId={scopedProject.id} />}
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
        <SquadFlowView projectId={scopedProject?.id} />
      ) : boardView === 'list' ? (
        <AgentMonitor cards={visibleCards} showProject={isGlobal} />
      ) : cards.length === 0 ? (
        <div className="agents-board-empty agents-board-empty--launch aurora-host">
          <AuroraGrid />
          <div className="agents-board-empty-copy">
            <Bot size={28} aria-hidden="true" />
            {isGlobal ? (
              <>
                <h4>No agents running</h4>
                <p>
                  Open a project on the left and start a Claude session — it&rsquo;ll appear here, across
                  every project.
                </p>
              </>
            ) : (
              <>
                <h4>No agents yet</h4>
                <p>Start a Claude session in this project and watch it move across the board.</p>
              </>
            )}
          </div>
          <HomeAgentComposer project={scopedProject} />
        </div>
      ) : isGlobal && visibleCards.length === 0 ? (
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
        <AgentBoardLanes
          cards={visibleCards}
          activeId={activeTabId}
          onInspect={inspect}
          onPick={pick}
          showProject={isGlobal}
        />
      )}

      {closeIdleTarget && (
        <CloseIdleAgentsDialog
          agents={closeIdleTarget}
          projectName={scopedProject?.name}
          action="close"
          onClose={() => setCloseIdleTarget(null)}
          onConfirm={confirmCloseIdle}
        />
      )}
    </div>
  );
}
