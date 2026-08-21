/**
 * ProjectTicketsView — the zana-tickets extension's per-project Tickets panel.
 *
 * The extension's projectTab panel: core mounts it with an injected
 * {@link ModuleHost} whose {@link ModuleHost.getActiveProject} returns the
 * project this tab is scoped to. All ticket/sprint/artifact DATA comes from the
 * `useTickets` store (keyed by `project.id`), which fetches through `ticketsApi`
 * → the `zana` built-in main module. The panel owns nothing stateful except
 * local UI ephemera (text filter, open assign-menu id, per-column collapse
 * overrides, a detail-modal selection stub).
 *
 * Scope: PER-PROJECT — it scopes to the ONE active project (`{ kind: 'project' }`);
 *   there is no source rail / Global concept. `host.getActiveProject()` is the
 *   single source of scope. `project.path` is an ADVISORY hint forwarded to the
 *   store → main, which re-resolves it (and may throw) — path trust stays in main.
 *
 * The 30s auto-refresh tick lives in the store (one app-lifetime tick), not here;
 * `ensure` is store-de-duped, so a tab-switch remount is a cache hit (no per-mount
 * IPC storm). `columns`/`filtered` memos keep the substance-sort off the render
 * hot path.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  Ban,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileText,
  LayoutGrid,
  List,
  Search,
  Tag,
  User,
  Users,
  X
} from 'lucide-react';
import type { ModuleHost, ProjectInfo } from '@zana-ai/zcc-extension-sdk/renderer';
import type { AssignChoice, ZanaArtifact, ZanaProfile, ZanaTicket } from '@shared/zana-types';
import { isClosedZanaStatus } from '@shared/zana-types';
import { useTickets, useTicketsEntry, useTicketsKpis, type TicketsKey } from './ticketsStore';
import {
  buildColumns,
  extractAssignees,
  filterTickets,
  isSnapshotEmpty,
  isTerminalStatus,
  resolveSprintName,
  shortId
} from './ticketColumns';
import { buildProfileMap, avatarColor, initials } from './AssignMenu';
import { TicketDetailModal, type ZanaSelection } from './TicketDetailModal';
import { ProfilesView } from './ProfilesView';
import { SprintsList } from './SprintsList';
import { DocsList } from './DocsList';

/**
 * Sub-tab ids for the Tickets-view strip — the SINGLE exported union. C3 adds
 * `'sprints'`/`'docs'`; C5 appended `'profiles'`. Whoever widens this declares
 * it here (no shadow/redeclare). The store mirrors this union for its cross-tab
 * UI-state slice (`ticketsStore.ts`).
 */
export type TicketsSubTab = 'tickets' | 'sprints' | 'docs' | 'profiles';

export default function ProjectTicketsView({ host }: { host: ModuleHost }) {
  // The project this tab is scoped to. `getScopedProjectId()` tracks the fixed
  // scope of a project-tab mount; `getActiveProject()` resolves its full
  // {id,name,path}. Null only if the shell has no active project (empty shell
  // or a race) — render a gentle placeholder rather than crashing.
  const project = host.getActiveProject();

  if (!project) {
    return (
      <section className="gus-panel zana-panel">
        <div className="empty-workspace overlay">
          <div className="empty-inner">
            <h3>No project selected</h3>
            <p>Open a project to see its Zana tickets.</p>
          </div>
        </div>
      </section>
    );
  }

  return <TicketsBoard host={host} project={project} />;
}

/**
 * The board proper — split out so the top-level panel can early-return on a null
 * active project WITHOUT calling hooks conditionally (the board's many hooks all
 * run unconditionally once a project is resolved).
 */
function TicketsBoard({ host, project }: { host: ModuleHost; project: ProjectInfo }) {
  // The single store key for this view — `project.id` keys the cache, and
  // `project.path` is the advisory hint forwarded to main.
  const key = useMemo<TicketsKey>(
    () => ({ projectId: project.id, projectPath: project.path }),
    [project.id, project.path]
  );

  // Data via store, not IPC. `ensure` is idempotent + de-duped, so this effect
  // re-firing on every tab-switch remount does NOT re-hit `getSnapshot`
  // (Rule 5 / IPC-storm guard, owned + tested in the store).
  const ensure = useTickets((s) => s.ensure);
  const applyAssign = useTickets((s) => s.applyAssign);
  const initProjectAction = useTickets((s) => s.initProject);
  useEffect(() => {
    ensure(key);
  }, [ensure, key]);

  // "Init Zana" button state (empty-state only) — local UI ephemera, not
  // store-owned: it's a one-shot in-flight/error gate for this mount, not data
  // that needs to survive a WorkspaceMode tab-switch remount.
  const [initState, setInitState] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null
  });
  const onInitProject = async () => {
    setInitState({ pending: true, error: null });
    try {
      await initProjectAction(key);
      setInitState({ pending: false, error: null });
    } catch (err) {
      setInitState({ pending: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // ── Cross-tab UI state lives in the store, NOT in component `useState` ──────
  // The view fully unmounts on every WorkspaceMode switch, so a local `useState`
  // for the sub-tab / sprint-filter would reset on each return to Tickets. The
  // store is a module-singleton, so these persist for the session (durable
  // persistence is D1's job — see the `// persistence: see D1` marker there).
  const activeSubTab = useTickets((s) => s.subTab);
  const setActiveSubTab = useTickets((s) => s.setSubTab);
  const sprintFilter = useTickets((s) => s.sprintFilter);
  const setSprintFilter = useTickets((s) => s.setSprintFilter);
  const openSprint = useTickets((s) => s.openSprint);
  const toggleColumnCollapsedAction = useTickets((s) => s.toggleColumnCollapsed);
  const boardDensity = useTickets((s) => s.boardDensity);
  const setBoardDensity = useTickets((s) => s.setBoardDensity);

  const entry = useTicketsEntry(key);
  const kpis = useTicketsKpis(key);
  const snapshot = entry?.snapshot ?? null;
  const loading = entry?.loading ?? false;
  const error = entry?.error ?? null;

  // ── Local UI ephemera (no snapshot state lives here — the view fully
  // unmounts on every WorkspaceMode tab-switch; all data lives in the store). ──
  const [query, setQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  // Per-status collapse overrides keyed by lowercased status now live in the
  // store (durable + per-project, D1). A key's presence pins that column's
  // state; absent statuses fall back to the `isTerminalStatus` default. The view
  // holds NO local copy (single source of truth).
  const collapsedOverrides = entry?.collapsedColumns ?? {};
  // Detail-modal selection (C4). Null when the modal is closed.
  const [selected, setSelected] = useState<ZanaSelection | null>(null);

  const tickets = snapshot?.tickets ?? [];
  const sprints = snapshot?.sprints ?? [];
  const artifacts = snapshot?.artifacts ?? [];
  const profiles = entry?.profiles ?? [];
  // Derive the profile lookup ONCE from the store's profiles (Rule 5: no
  // per-mount profile fetch in the modal — the store owns the single fetch).
  const profileMap = useMemo(() => buildProfileMap(profiles), [profiles]);
  // Assignee chips are keyed by DISPLAY NAME (what `extractAssignees` returns),
  // so the avatar can show a profile's emoji icon when the assignee matches a
  // known profile. Derive the name→profile lookup once alongside the id map.
  const profileByName = useMemo(() => {
    const map = new Map<string, ZanaProfile>();
    for (const p of profiles) if (p && typeof p.displayName === 'string') map.set(p.displayName, p);
    return map;
  }, [profiles]);

  const assignees = useMemo(() => extractAssignees(tickets), [tickets]);
  const filtered = useMemo(
    () => filterTickets(tickets, query, sprintFilter, assigneeFilter),
    [tickets, query, sprintFilter, assigneeFilter]
  );
  const columns = useMemo(() => buildColumns(filtered), [filtered]);

  const isColumnCollapsed = (status: string) => {
    const k = status.trim().toLowerCase();
    return collapsedOverrides[k] ?? isTerminalStatus(status);
  };

  const toggleColumnCollapsed = (status: string) =>
    toggleColumnCollapsedAction(key, status, isTerminalStatus(status));

  const onAssign = (ticket: ZanaTicket, choice: AssignChoice) => applyAssign(key, ticket, choice);

  const openTicket = (t: ZanaTicket) => setSelected({ kind: 'ticket', ticket: t });
  // Open a profile in the C4 detail modal via its `ZanaSelection` opener — no
  // local `host.call`/`getHost` (Rule 6). C4's modal owns the profile lazy-load.
  const openProfile = (p: ZanaProfile) => setSelected({ kind: 'profile', profile: p });
  // Open an artifact (doc) in the C4 detail modal. The `{ kind: 'artifact' }`
  // `ZanaSelection` literal is constructed HERE (the C2 shell), never inside the
  // C3 DocsList/ArtifactCard — those take a plain `(a: ZanaArtifact) => void`,
  // keeping the C4-owned selection union out of C3.
  const openArtifact = (a: ZanaArtifact) => setSelected({ kind: 'artifact', artifact: a });

  // ── Empty / loading / error gates ────────────────────────────────────────
  // Emptiness is derived from snapshot ARRAYS, not all-zero kpis (kpis can read
  // zero with stale arrays).
  const isEmpty = !loading && !error && isSnapshotEmpty(snapshot);
  // A freshly-`Init`-ed workspace is ALSO empty (zero tickets/sprints/
  // artifacts) — `snapshot.isInitialized` is the only signal that tells that
  // apart from "never initialized", so the CTA below only shows pre-init and a
  // successful click swaps it for a plain "no tickets yet" notice instead of
  // re-showing the same button forever.
  const isUninitialized = isEmpty && snapshot != null && !snapshot.isInitialized;

  // Sub-tab strip — shared between the normal and board-empty renders so the
  // Profiles sub-tab stays present even when the board has zero tickets. The
  // full strip is Tickets · Sprints · Docs · Profiles. The sprint-filter-clear
  // chip rides at the end of the strip, but only on the Tickets sub-tab while a
  // sprint filter is active.
  const subTabBar = (
    <div className="zana-tabs" role="tablist">
      {(['tickets', 'sprints', 'docs', 'profiles'] as TicketsSubTab[]).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeSubTab === tab}
          className={`zana-tab ${activeSubTab === tab ? 'active' : ''}`}
          onClick={() => setActiveSubTab(tab)}
        >
          {tab === 'profiles' && <Users size={13} aria-hidden />}
          {tab === 'tickets'
            ? 'Tickets'
            : tab === 'sprints'
              ? 'Sprints'
              : tab === 'docs'
                ? 'Docs'
                : 'Profiles'}
        </button>
      ))}
      {sprintFilter && activeSubTab === 'tickets' && (
        <button
          type="button"
          className="zana-sprint-filter-clear"
          onClick={() => setSprintFilter(null)}
        >
          Sprint: {sprints.find((s) => s.id === sprintFilter)?.name ?? shortId(sprintFilter)}
          <X size={11} />
        </button>
      )}
      {/* Board-wide card/list density toggle (Tickets sub-tab only) — one switch
          for the whole kanban, not per column. */}
      {activeSubTab === 'tickets' && (
        <div
          className="zana-density-switch zana-tabs-density"
          role="group"
          aria-label="Board layout"
        >
          <button
            type="button"
            className={`zana-density-btn ${boardDensity === 'card' ? 'active' : ''}`}
            onClick={() => setBoardDensity('card')}
            aria-pressed={boardDensity === 'card'}
            title="Show all columns as cards"
          >
            <LayoutGrid size={13} aria-hidden />
          </button>
          <button
            type="button"
            className={`zana-density-btn ${boardDensity === 'list' ? 'active' : ''}`}
            onClick={() => setBoardDensity('list')}
            aria-pressed={boardDensity === 'list'}
            title="Show all columns as a dense list"
          >
            <List size={13} aria-hidden />
          </button>
        </div>
      )}
      {/* Search rides at the end of the tab strip (Tickets sub-tab only) — the
          dedicated left rail it used to live in wasted a whole column on one
          input + a hint, so the board now spans full width. */}
      {activeSubTab === 'tickets' && (
        <div className="zana-tabs-search gus-search" title="Filter by title, labels & assignee">
          <Search size={13} className="gus-search-icon" aria-hidden />
          <input
            type="text"
            placeholder="Filter tickets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter tickets by title, labels and assignee"
          />
          {query && (
            <button
              type="button"
              className="gus-search-clear"
              aria-label="Clear filter"
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (error) {
    return (
      <section className="gus-panel zana-panel">
        <div className="gus-error" role="alert">
          <AlertCircle size={16} />
          <div>
            <strong>Couldn't load Zana data.</strong>
            <p>{error}</p>
          </div>
        </div>
      </section>
    );
  }

  if (loading && !snapshot) {
    return (
      <section className="gus-panel zana-panel">
        <div className="gus-loading">Loading Zana data…</div>
      </section>
    );
  }

  if (isEmpty) {
    // Board has no tickets/sprints/docs, but Profiles are GLOBAL — so keep the
    // sub-tab strip and let the Profiles tab work; only the Tickets tab shows
    // the "no data" notice (matches the live panel's empty branch).
    return (
      <section className="gus-panel zana-panel">
        {subTabBar}
        {activeSubTab === 'profiles' ? (
          <ProfilesView profiles={profiles} tickets={tickets} onOpen={openProfile} />
        ) : (
          <div className="empty-workspace overlay">
            <div className="empty-inner">
              {isUninitialized ? (
                <>
                  <h3>No Zana data for this project</h3>
                  <p>
                    Zana stores tickets, sprints and docs under <code>.zana/</code> — initialize it for{' '}
                    {project.name}, or run Zana there to populate this board.
                  </p>
                  <button
                    type="button"
                    className="zana-start-btn"
                    onClick={onInitProject}
                    disabled={initState.pending}
                  >
                    {initState.pending ? 'Initializing…' : 'Init Zana'}
                  </button>
                  {initState.error && (
                    <p className="gus-error" role="alert">
                      {initState.error}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <h3>No tickets yet</h3>
                  <p>
                    {project.name}'s <code>.zana/</code> workspace is initialized but empty — create a
                    ticket or run Zana there to populate this board.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        {selected && (
          <TicketDetailModal
            host={host}
            selection={selected}
            sprints={sprints}
            tickets={tickets}
            profiles={profiles}
            profileMap={profileMap}
            projectPath={project.path}
            useGlobal={false}
            onAssign={(choice) => {
              if (selected.kind === 'ticket') onAssign(selected.ticket, choice);
            }}
            onClose={() => setSelected(null)}
          />
        )}
      </section>
    );
  }

  return (
    <section className="gus-panel zana-panel">
      {/* KPI strip — always visible once a snapshot resolves (zeros when empty). */}
      {kpis && (
        <div className="zana-kpi-strip">
          <KpiCard icon={<CircleDot size={15} />} label="Open" value={kpis.openTickets} tone="open" />
          <KpiCard icon={<CheckCircle2 size={15} />} label="Closed" value={kpis.closedTickets} tone="done" />
          <KpiCard icon={<Ban size={15} />} label="Blocked" value={kpis.blockedTickets} tone="blocked" />
          <KpiCard icon={<Activity size={15} />} label="Throughput 7d" value={kpis.throughput7d ?? 0} />
          <KpiCard icon={<CalendarRange size={15} />} label="Sprints" value={kpis.sprintCount} />
          <KpiCard icon={<FileText size={15} />} label="Docs" value={kpis.artifactCount} />

          <div className="zana-kpi-breakdowns">
            <Breakdown title="By status" counts={kpis.byStatus} />
            <Breakdown title="By priority" counts={kpis.byPriority} />
          </div>
        </div>
      )}

      {subTabBar}

      {activeSubTab === 'profiles' && (
        <ProfilesView profiles={profiles} tickets={tickets} onOpen={openProfile} />
      )}

      {activeSubTab === 'sprints' && (
        <SprintsList sprints={sprints} onOpenSprint={openSprint} />
      )}

      {activeSubTab === 'docs' && <DocsList artifacts={artifacts} onOpen={openArtifact} />}

      {activeSubTab === 'tickets' && assignees.length > 0 && (
        <div className="zana-assignee-bar" role="group" aria-label="Filter by assignee">
          <button
            type="button"
            className={`zana-assignee-chip ${assigneeFilter === null ? 'active' : ''}`}
            onClick={() => setAssigneeFilter(null)}
          >
            <Users size={12} aria-hidden /> All
          </button>
          {assignees.map((name) => {
            const prof = profileByName.get(name);
            return (
              <button
                key={name}
                type="button"
                className={`zana-assignee-chip ${assigneeFilter === name ? 'active' : ''}`}
                onClick={() => setAssigneeFilter(assigneeFilter === name ? null : name)}
              >
                <span
                  className="zana-assignee-chip-avatar"
                  style={{ background: avatarColor(name) }}
                  aria-hidden
                >
                  {prof ? prof.icon : initials(name)}
                </span>
                {name}
              </button>
            );
          })}
          <button
            type="button"
            className={`zana-assignee-chip ${assigneeFilter === '__unassigned__' ? 'active' : ''}`}
            onClick={() => setAssigneeFilter(assigneeFilter === '__unassigned__' ? null : '__unassigned__')}
          >
            Unassigned
          </button>
        </div>
      )}

      {activeSubTab === 'tickets' && (
      <div className="zana-content">
        {/* Full-width board — the old filter rail moved into the tab strip. */}
        <div className="gus-content">
            <div className="gus-board zana-board">
              {columns.length === 0 && <div className="gus-column-empty">No tickets match.</div>}
              {columns.map(([status, items]) => {
                const collapsed = isColumnCollapsed(status);
                const terminal = isTerminalStatus(status);
                return (
                  <div
                    key={status}
                    className={`gus-column zana-column ${collapsed ? 'is-collapsed' : ''} ${
                      terminal ? 'zana-column--terminal' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="gus-column-head zana-column-head-btn"
                      onClick={() => toggleColumnCollapsed(status)}
                      aria-expanded={!collapsed}
                      title={collapsed ? `Expand ${status}` : `Collapse ${status}`}
                    >
                      <span className="zana-column-head-left">
                        {collapsed ? (
                          <ChevronRight size={13} aria-hidden />
                        ) : (
                          <ChevronDown size={13} aria-hidden />
                        )}
                        <span className="gus-column-title">{status}</span>
                      </span>
                      <span className="gus-column-count">{items.length}</span>
                    </button>
                    {!collapsed &&
                      (boardDensity === 'list' ? (
                        <div className="gus-column-body zana-column-body--dense">
                          {items.map((t) => (
                            <CompactTicketRow key={t.id} ticket={t} onOpen={() => openTicket(t)} />
                          ))}
                        </div>
                      ) : (
                        <div className="gus-column-body">
                          {items.map((t) => (
                            <TicketCard
                              key={t.id}
                              ticket={t}
                              sprintName={resolveSprintName(t.sprintId, sprints)}
                              onAssign={(choice) => onAssign(t, choice)}
                              onOpen={() => openTicket(t)}
                            />
                          ))}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
        </div>
      </div>
      )}

      {selected && (
        <TicketDetailModal
          host={host}
          selection={selected}
          sprints={sprints}
          tickets={tickets}
          profiles={profiles}
          profileMap={profileMap}
          projectPath={project.path}
          useGlobal={false}
          onAssign={(choice) => {
            if (selected.kind === 'ticket') onAssign(selected.ticket, choice);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

// ── KPI strip pieces ─────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: 'open' | 'done' | 'blocked';
}) {
  return (
    <div className={`zana-kpi-card ${tone ? `zana-kpi-card--${tone}` : ''}`}>
      <span className="zana-kpi-icon" aria-hidden>
        {icon}
      </span>
      <span className="zana-kpi-value">{value}</span>
      <span className="zana-kpi-label">{label}</span>
    </div>
  );
}

/** A compact breakdown: a labelled row of proportional bars per key. */
function Breakdown({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <div className="zana-breakdown">
      <div className="zana-breakdown-title">{title}</div>
      <div className="zana-breakdown-rows">
        {entries.map(([key, n]) => (
          <div key={key} className="zana-breakdown-row" title={`${key}: ${n}`}>
            <span className="zana-breakdown-key">{key}</span>
            <span className="zana-breakdown-bar">
              <span
                className="zana-breakdown-fill"
                style={{ width: `${Math.round((n / max) * 100)}%` }}
              />
            </span>
            <span className="zana-breakdown-num">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cards ──────────────────────────────────────────────────────────────────

/**
 * A full kanban card for an active (non-terminal) column. The assignee is shown
 * read-only here; the interactive assign PICKER is C4 (it ports the lifted
 * picker into core). `onAssign` is wired through so C4 only swaps in the picker
 * UI — no signature churn — and the store's optimistic-assign contract is
 * already in place.
 */
function TicketCard({
  ticket,
  sprintName,
  onAssign,
  onOpen
}: {
  ticket: ZanaTicket;
  sprintName?: string;
  onAssign: (choice: AssignChoice) => void;
  onOpen: () => void;
}) {
  // `onAssign` is the wired store contract; C4 attaches the picker that calls it.
  void onAssign;

  const closed = isClosedZanaStatus(ticket.status, ticket.closedAt);
  const prio = ticket.priority?.toLowerCase();
  // One-line gist under the title — the ticket's own description, or the
  // resolution summary once it's closed. The single biggest readability win:
  // the old card showed only a title, so near-identical titles were
  // indistinguishable at a glance.
  const blurb = ticket.description?.trim() || ticket.resultSummary?.trim();
  const extraLabels = ticket.labels.length - 3;
  return (
    <div
      className={`gus-card zana-card ${closed ? 'is-closed' : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${ticket.title} — click for details`}
    >
      <div className="gus-card-top zana-card-top">
        {/* Leading dot, colored by priority — the at-a-glance urgency cue that
            lets you scan a column without reading the pill on every card. */}
        <span
          className={`zana-card-dot ${prio ? `zana-prio--${prio}` : ''}`}
          aria-hidden
        />
        <div className="gus-card-subject zana-card-title">{ticket.title}</div>
        {ticket.priority && (
          <span className={`zana-prio zana-prio--${prio}`}>{ticket.priority}</span>
        )}
      </div>

      {blurb && <div className="zana-card-desc">{blurb}</div>}

      {/* Chip row: only rendered when there's something to show, so a bare
          ticket stays a clean title + footer instead of an empty band. */}
      {(ticket.type || ticket.blockedBy.length > 0 || sprintName || ticket.labels.length > 0) && (
        <div className="zana-card-chips">
          {ticket.type && <span className="zana-type-badge">{ticket.type}</span>}
          {ticket.blockedBy.length > 0 && (
            <span className="zana-blocked-tag" title={`Blocked by ${ticket.blockedBy.length}`}>
              <Ban size={11} aria-hidden /> Blocked
            </span>
          )}
          {sprintName && <span className="gus-chip">{sprintName}</span>}
          {ticket.labels.slice(0, 3).map((l) => (
            <span key={l} className="zana-label-chip">
              <Tag size={9} aria-hidden /> {l}
            </span>
          ))}
          {extraLabels > 0 && <span className="gus-chip">+{extraLabels}</span>}
        </div>
      )}

      {/* Footer: assignee on the left, short id pinned right — mirrors the
          gus card's author/meta split for a calm, readable baseline. */}
      <div className="zana-card-foot">
        {ticket.assigneeName ? (
          <span className="zana-card-assignee" title={`Assigned to ${ticket.assigneeName}`}>
            <User size={11} aria-hidden /> {ticket.assigneeName}
          </span>
        ) : (
          <span className="zana-card-unassigned">Unassigned</span>
        )}
        <span className="zana-card-id" title={ticket.id}>
          {shortId(ticket.id)}
        </span>
      </div>
    </div>
  );
}

/**
 * A dense, single-line ticket row used inside expanded terminal columns
 * (done/cancelled/…): a small priority dot, the title (clipped to one line),
 * and the short id. Clicking opens the full detail (C4).
 */
function CompactTicketRow({ ticket, onOpen }: { ticket: ZanaTicket; onOpen: () => void }) {
  return (
    <div
      className="zana-compact-row"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${ticket.title} — click for details`}
    >
      {ticket.priority && (
        <span
          className={`zana-compact-prio zana-prio--${ticket.priority.toLowerCase()}`}
          title={ticket.priority}
          aria-hidden
        />
      )}
      <span className="zana-compact-title">{ticket.title}</span>
      <span className="zana-compact-id" title={ticket.id}>
        {shortId(ticket.id)}
      </span>
    </div>
  );
}
