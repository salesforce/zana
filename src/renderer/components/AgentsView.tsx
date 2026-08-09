import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Bot, Plus, Sparkles } from 'lucide-react';
import type { AgentState, IdleTriageResult, TerminalSession } from '@shared/types';
import { useData, useUi, useAgentStatus, useIdleTriage, openWhatsNewAll } from '../store';
import { getScopedProjectId } from '../util/windowScope';
import { profileIcon } from '../util/profileIcon';
import { isRecentlyFinished } from '../util/sessionBuckets';
import { idleSurfacesToNeedsYou, partitionSquadMembers, type AgentCard } from './AgentBoard';
import { AgentLauncher } from './AgentLauncher';
import { useAgentCardActions, AgentCardMenu, clampMenuAnchor } from './agentCardActions';
import { PromptModal } from './PromptModal';
import { ListPaneResizer } from './ListPaneResizer';

/**
 * The Agents section's column-2 list pane. Column 3 under the Agents nav is the
 * cross-project {@link GlobalAgentsBoard} Kanban (wired in App.tsx) — the same
 * board the Projects home shows.
 *
 * AgentsListPane lists all agents across every project grouped by liveness,
 * with a live "running for X", a state dot, and badges. Clicking a row opens
 * the agent-inspector modal (the same one the board cards open) — a peek at the
 * live terminal with "Open in workspace" as the escape hatch into Projects.
 */

interface AgentRow {
  session: TerminalSession;
  projectId: string;
  projectName: string;
  state: AgentState;
  /** Idle-triage verdict for this session, if the add-on has classified it.
   *  Only consulted when the "promote triaged agents" setting is on. */
  triage?: IdleTriageResult;
}

// Display priority: who needs attention first. Mirrors AGENT_STATE_RANK in the
// store but ordered for a top-to-bottom list (most urgent first).
const STATE_RANK: Record<AgentState, number> = {
  blocked: 0,
  working: 1,
  idle: 2,
  done: 3,
  unknown: 4
};

const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  unknown: 'Idle'
};

/**
 * Does a side-list row belong in "Needs you"? Always when `blocked` (a real
 * permission prompt / question). Additionally — ONLY when `promoteTriage` is on
 * (the optional `agentListNeedsYouFromTriage` setting) — when it's an at-rest
 * (non-working) agent whose triage verdict surfaces at `sensitivity` (the same
 * mapping the board uses). With the setting off, a triaged idle agent is never
 * promoted and falls through to Idle. Pure + exported for unit tests.
 */
export function sideListNeedsYou(
  r: Pick<AgentRow, 'state' | 'triage'>,
  promoteTriage: boolean,
  sensitivity: 'high' | 'medium' | 'low'
): boolean {
  if (r.state === 'blocked') return true;
  if (!promoteTriage || !r.triage || r.state === 'working') return false;
  return idleSurfacesToNeedsYou(r.triage.resolution, r.triage.confidence ?? 0, sensitivity);
}

/**
 * Flat, sorted list of every agent across all projects. Selectors return raw
 * store slices (stable refs); the derived array lives behind useMemo so we
 * don't trip zustand's re-render loop (see MEMORY zustand-selector-stable-ref).
 * Headless (background/scheduled) sessions are INCLUDED — peeking them is the
 * whole point. Exited sessions are included too; the list groups them out.
 * Plain `shell` sessions are EXCLUDED — this is an agents view, not a terminal
 * list; bare shells have no agent state to surface here.
 */
function useAgentRows(): AgentRow[] {
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const byId = useAgentStatus((s) => s.byId);
  const triageById = useIdleTriage((s) => s.byId);

  return useMemo<AgentRow[]>(() => {
    const nameById = new Map(projects.map((p) => [p.id, p.name]));
    const out: AgentRow[] = [];
    // In a per-project window, list only this project's agents.
    const scopedProjectId = getScopedProjectId();
    const pairs = scopedProjectId
      ? ([[scopedProjectId, terminals[scopedProjectId] ?? []]] as const)
      : (Object.entries(terminals) as Array<readonly [string, typeof terminals[string]]>);
    for (const [projectId, list] of pairs) {
      for (const session of list) {
        if (session.profile === 'shell') continue;
        out.push({
          session,
          projectId,
          projectName: nameById.get(projectId) ?? 'Unknown',
          state: byId[session.id] ?? 'unknown',
          triage: triageById[session.id]
        });
      }
    }
    // Sort: state rank → project name → title. The status groups below are
    // built by stable `.filter()` over THIS array, so the project key clusters
    // each project's agents together within every status group (the title key
    // then orders within a project). One sort drives both the group order and
    // the project clustering.
    out.sort((a, b) => {
      const r = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9);
      if (r !== 0) return r;
      const p = a.projectName.localeCompare(b.projectName);
      if (p !== 0) return p;
      return a.session.title.localeCompare(b.session.title);
    });
    return out;
  }, [terminals, projects, byId, triageById]);
}

/** "12m", "1h 5m", "8s" — coarse, human, recomputed on the list's 1s tick. */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── Column 2: the agent list ────────────────────────────────────────────────

export function AgentsListPane() {
  const rows = useAgentRows();
  const selectedTabId = useUi((s) => s.selectedTabId);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  // Optional (off by default): also pull a triage-flagged idle agent into the
  // "Needs you" group, using the same sensitivity mapping as the board. When
  // off, only `blocked` agents are "Needs you" and a triaged idle one stays Idle.
  const promoteTriage = useData((s) => s.agentListNeedsYouFromTriage);
  const sensitivity = useData((s) => s.idleAttentionSensitivity);
  const [launcherOpen, setLauncherOpen] = useState(false);
  // Right-click lifecycle menu — the SAME hook the kanban board uses, so a row
  // and a board card drive the identical pty actions and expose the identical
  // menu (Stop / Restart / Rename / Delete …). No parallel action path.
  const { menu, setMenu, actions, rename, closeRename, submitRename } = useAgentCardActions();

  // Clicking a row opens the agent-inspector modal — a peek at the live terminal
  // plus metadata, with "Open in workspace" as the escape hatch to the full
  // split-pane view. Same modal the board cards open; it doesn't navigate away
  // from the Agents section, so the list stays put behind it.
  const open = (r: AgentRow) => {
    useUi.getState().openAgentModal(r.session.id, r.projectId);
  };

  // The context menu speaks in `AgentCard`s (shared with the board). A list row
  // carries the load-bearing subset — the menu recomputes remote/needs-you from
  // `session`/`state`/`triage` — so this thin adapter is all it needs.
  const rowToCard = (r: AgentRow): AgentCard => ({
    session: r.session,
    state: r.state,
    projectId: r.projectId,
    projectName: r.projectName,
    triage: r.triage
  });

  // Menu "Open"/"View" → graduate the agent into Projects (mirrors the board's
  // `pick`): open its project, restore a headless session into the strip, focus
  // its tab, and land on the terminal view.
  const pick = (c: AgentCard) => {
    const ui = useUi.getState();
    ui.setNav('projects');
    ui.enterProjectFocus(c.projectId);
    if (c.session.headless && c.session.status !== 'exited') {
      void useData.getState().restoreTerminal(c.session.id, c.projectId);
    } else {
      ui.selectTab(c.projectId, c.session.id);
    }
    ui.setWorkspaceMode(c.projectId, 'terminals');
  };

  const onRowContextMenu = (e: MouseEvent, r: AgentRow) => {
    e.preventDefault();
    setMenu({ card: rowToCard(r), ...clampMenuAnchor(e) });
  };

  // Stable launcher props so the memoized AgentLauncher doesn't re-render
  // (and drop keystrokes) on this list's 1s tick / agent-status churn.
  const closeLauncher = useCallback(() => setLauncherOpen(false), []);
  const onLauncherLaunched = useCallback(
    (session: TerminalSession, projectId: string) =>
      useUi.getState().openAgentModal(session.id, projectId),
    []
  );

  // One timer for the whole list drives the live "running for X". A tick state
  // forces a re-render each second; durations are computed at render from
  // createdAt vs. now. Only mounted while the Agents list is shown.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  // Collapse each launched squad into ONE list entry: a cohort with a live
  // orchestrator keeps only that row in the groups, with its workers nested
  // underneath it — so a team reads as one unit here too, instead of spraying a
  // worker into every liveness bucket. Solo agents + driverless worker fleets
  // pass through untouched. `topRows` is what the groups below filter over.
  const { top: topRows, workersByHost } = useMemo(
    () => partitionSquadMembers(rows),
    [rows]
  );
  // Exited agents linger here only briefly, then auto-dismiss: once a finished
  // run is older than FINISHED_LINGER_MS it drops out of the list (the 1s tick
  // above re-renders, so the row disappears on its own ~60s after it ends).
  const finished = topRows.filter((r) => isRecentlyFinished(r.session, now));
  // Live, foreground agents are the ones you're actively driving — they get the
  // status grouping up top. Background (headless) runs are detached and don't
  // need your attention moment-to-moment, so they sink to their own section at
  // the bottom rather than diluting the Needs-you / Working / Idle buckets.
  const live = topRows.filter((r) => r.session.status !== 'exited' && !r.session.headless);
  const background = topRows.filter((r) => r.session.status !== 'exited' && r.session.headless);

  const needsYou = (r: AgentRow): boolean => sideListNeedsYou(r, promoteTriage, sensitivity);

  // Group live foreground agents by what they need from you. `done` and
  // `unknown` collapse into the Idle bucket — neither is actively running nor
  // waiting, so they read as "at rest" alongside idle. Order: most-urgent first.
  // Each group is mutually exclusive: a promoted card is in "Needs you", not Idle.
  const liveGroups: Array<{ key: string; label: string; rows: AgentRow[] }> = [
    { key: 'blocked', label: 'Needs you', rows: live.filter(needsYou) },
    { key: 'working', label: 'Working', rows: live.filter((r) => r.state === 'working') },
    {
      key: 'idle',
      label: 'Idle',
      rows: live.filter((r) => r.state !== 'working' && !needsYou(r))
    }
  ].filter((g) => g.rows.length > 0);

  // A compact worker row nested under its squad's orchestrator: a status dot +
  // title + duration, no icon/project/badges — smaller than a top-level row so a
  // squad's members read as a tight sub-list, not a wall of full rows. At-rest
  // (idle/done/unknown) workers show no colored dot (matches the board).
  const renderWorker = (r: AgentRow) => {
    const { session: t } = r;
    const exited = t.status === 'exited';
    const active = selectedProjectId === r.projectId && selectedTabId[r.projectId] === t.id;
    const dur = formatDuration((exited ? t.finishedAt ?? t.createdAt : now) - t.createdAt);
    const label = t.cohort?.slotLabel || t.title;
    return (
      <button
        key={t.id}
        className={`agents-worker-row ${active ? 'active' : ''} ${exited ? 'exited' : ''}`}
        onClick={() => open(r)}
        onContextMenu={(e) => onRowContextMenu(e, r)}
        aria-current={active ? 'true' : undefined}
        title={`${t.title} — ${r.projectName} · ${STATE_LABEL[r.state]}`}
      >
        <span className={`tab-agent-dot agent-${exited ? 'done' : r.state}`} aria-hidden="true" />
        <span className="agents-worker-title">{label}</span>
        <span className="agents-worker-dur">{exited ? `ran ${dur}` : dur}</span>
      </button>
    );
  };

  const renderRow = (r: AgentRow) => {
    const { session: t } = r;
    const exited = t.status === 'exited';
    // "Active" = this agent is the selected tab of the selected project, i.e.
    // the one a click would re-surface in Projects.
    const active = selectedProjectId === r.projectId && selectedTabId[r.projectId] === t.id;
    // Live agents grow against `now`; exited ones freeze at their run length
    // (finishedAt - createdAt) so the timer doesn't keep ticking after death.
    const dur = formatDuration((exited ? t.finishedAt ?? t.createdAt : now) - t.createdAt);
    // Workers nested under this row when it's a squad's live orchestrator (empty
    // otherwise). partitionSquadMembers pulled them out of the flat groups, so
    // they render here or nowhere — the squad reads as one entry.
    const workers = workersByHost.get(t.id) ?? [];
    const isOrch = t.cohort?.role === 'orchestrator';
    const row = (
      <button
        key={t.id}
        className={`agents-row ${active ? 'active' : ''} ${exited ? 'exited' : ''} ${
          isOrch && workers.length ? 'is-squad-orch' : ''
        }`}
        onClick={() => open(r)}
        onContextMenu={(e) => onRowContextMenu(e, r)}
        aria-current={active ? 'true' : undefined}
        title={`${t.title} — ${r.projectName} · ${STATE_LABEL[r.state]}`}
      >
        <span className="agents-row-icon">{profileIcon(t.profile, 13)}</span>
        <span className="agents-row-text">
          <span className="agents-row-title-line">
            {!exited && <span className={`tab-agent-dot agent-${r.state}`} aria-hidden="true" />}
            <span className="agents-row-title">{t.title}</span>
          </span>
          <span className="agents-row-meta">
            <span className="agents-row-project">{r.projectName}</span>
            {!exited && <span className="agents-row-duration">{dur}</span>}
            {exited && t.finishedAt && (
              <span className="agents-row-duration" title="Total run time">
                ran {dur}
              </span>
            )}
            {/* Squad size chip — shows a collapsed team's worker count at a
                glance (the workers themselves nest below). */}
            {workers.length > 0 && (
              <span className="agents-row-badge" title={`${workers.length} squad worker${workers.length === 1 ? '' : 's'}`}>
                +{workers.length}
              </span>
            )}
            {/* No "Background" pill: these rows live under the Background
                header, so it'd be redundant. Scheduled stays — a background run
                can also be a scheduled job, which is worth flagging. */}
            {t.scheduled && <span className="agents-row-badge">Scheduled</span>}
            {exited && (
              <span className={`agents-row-badge ${t.exitCode ? 'bad' : ''}`}>
                {t.exitCode ? `Exited ${t.exitCode}` : 'Exited'}
              </span>
            )}
          </span>
        </span>
      </button>
    );
    if (workers.length === 0) return row;
    return (
      <div key={t.id} className="agents-squad">
        {row}
        <div className="agents-squad-workers">{workers.map(renderWorker)}</div>
      </div>
    );
  };

  return (
    <section className="list-pane agents-list-pane">
      <header className="list-header">
        <h2>Agents</h2>
        {live.length + background.length > 0 && (
          <span className="agents-count">{live.length + background.length}</span>
        )}
        <button
          type="button"
          data-testid="agents-new"
          className="icon-btn agents-new"
          onClick={() => setLauncherOpen(true)}
          aria-label="New quick agent"
          title="New quick agent"
        >
          <Plus size={14} />
        </button>
      </header>
      <div className="list-body">
        {rows.length === 0 ? (
          <div className="agents-list-empty">
            <Bot size={20} aria-hidden="true" />
            <p>No agents yet</p>
            <span>Launch a quick agent here, or start a Claude session in a project.</span>
            <button
              type="button"
              data-testid="agents-new-empty"
              className="btn primary"
              onClick={() => setLauncherOpen(true)}
            >
              <Plus size={14} />
              New quick agent
            </button>
            <button
              type="button"
              className="agents-empty-whatsnew"
              onClick={() => {
                void openWhatsNewAll();
              }}
            >
              <Sparkles size={13} aria-hidden="true" />
              See what&rsquo;s new
            </button>
          </div>
        ) : (
          <>
            {liveGroups.map((g) => (
              <div key={g.key} className="agents-group">
                <div className={`agents-group-label group-${g.key}`}>
                  <span>{g.label}</span>
                  <span className="agents-group-count">{g.rows.length}</span>
                </div>
                {g.rows.map(renderRow)}
              </div>
            ))}
            {(background.length > 0 || finished.length > 0) && (
              // At-rest sections (detached + exited) pin to the bottom via
              // margin-top:auto so they sit below the live groups even when no
              // foreground agent is running and the list is otherwise empty.
              <div className="agents-rest">
                {background.length > 0 && (
                  <div className="agents-group">
                    <div className="agents-group-label group-background">
                      <span>Background</span>
                      <span className="agents-group-count">{background.length}</span>
                    </div>
                    {background.map(renderRow)}
                  </div>
                )}
                {finished.length > 0 && (
                  <div className="agents-group">
                    <div className="agents-group-label group-finished">
                      <span>Recently finished</span>
                      <span className="agents-group-count">{finished.length}</span>
                    </div>
                    {finished.map(renderRow)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <ListPaneResizer />
      {menu && (
        <AgentCardMenu menu={menu} setMenu={setMenu} actions={actions} onPick={pick} />
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
      {launcherOpen && (
        <AgentLauncher
          onClose={closeLauncher}
          // From the global Agents view, pop the agent-inspector modal on the
          // new session instead of redirecting into its project — keeps the user
          // on the board, mirroring how clicking a row opens the modal.
          onLaunched={onLauncherLaunched}
        />
      )}
    </section>
  );
}
