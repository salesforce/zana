import { product } from '../../lib/product-client.js';
import { DelayedStencilList } from '../../components/ui/Skeleton.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Users, Search, FolderOpen, Play, ChevronDown, ChevronRight, Plus, Download, Upload, Copy, Pencil, Trash2 } from 'lucide-react';
import type { CancelTeamLaunchResult, LaunchTeamResult, Project, Result, Team, Persona } from '@zana-ai/zcc-domain/product';
import { useTeams, useData, useUi, usePersonas } from '@/store';
import { resolveIcon } from '@/lib/resolveIcon';
import { getScopedProjectId } from '@/lib/windowScope';
import { personaIcon } from '@/lib/profileIcon';
import { SquadEditor } from '@/components/SquadEditor';

/**
 * Teams management panel — a catalogue of launchable Teams (builtin ⊕
 * ~/.zcc/teams ⊕ <project>/.zcc/teams ⊕ extension registrations), merged and
 * pushed by the main process. A Team bundles personas; launching it opens one
 * terminal tab per slot (orchestrator first, carrying the team prompt).
 *
 * Clicking a row opens the team editor modal: builtins and project teams open
 * read-only with "Edit override" / "Duplicate to user"; user teams are fully
 * editable. Extension teams are view-only. Mirrors the PersonasPanel layout.
 * Uses its OWN `teams-*` classes — NOT the shared `gus-*` classes (coupling
 * note in CLAUDE.md).
 */

/** What the editor modal is doing: nothing, creating, or viewing/editing one. */
type EditorState = { kind: 'new' } | { kind: 'open'; team: Team } | null;

type SourceKind = 'all' | 'builtin' | 'user' | 'project' | 'extension';

const SOURCE_FILTERS: Array<{ id: SourceKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'builtin', label: 'Builtin' },
  { id: 'user', label: 'User' },
  { id: 'project', label: 'Project' },
  { id: 'extension', label: 'Extension' }
];

function sourceKind(source: Team['source']): Exclude<SourceKind, 'all'> {
  if (source === 'builtin') return 'builtin';
  if (source === 'user') return 'user';
  if (source && typeof source === 'object' && 'extensionId' in source) return 'extension';
  return 'project';
}

function sourceLabel(source: Team['source']): string {
  if (source === 'builtin') return 'Builtin';
  if (source === 'user') return 'User';
  if (source && typeof source === 'object') {
    if ('extensionId' in source) {
      // Reads `extensionTitle` from data (provenance), never a hardcoded id (Rule 6).
      return source.extensionTitle ? `Extension · ${source.extensionTitle}` : 'Extension';
    }
    return source.projectName ? `Project · ${source.projectName}` : 'Project';
  }
  return 'User';
}

/**
 * Total tabs a team opens — Σ slot quantity. Clamp each slot to TEAM_SLOT_MAX so
 * the badge matches what `launchTeam` will actually open (which clamps per slot).
 */
const TEAM_SLOT_MAX = 16;
export function menuIndexForKey(key: string, current: number, count: number): number | undefined {
  if (count < 1) return undefined;
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}
export function menuTabIndex(index: number, activeIndex: number): 0 | -1 {
  return index === activeIndex ? 0 : -1;
}
export async function runTeamLaunchExclusive<T>(
  inFlight: { current: boolean },
  launch: () => Promise<T>
): Promise<T | undefined> {
  if (inFlight.current) return undefined;
  inFlight.current = true;
  try {
    return await launch();
  } finally {
    inFlight.current = false;
  }
}
export async function runTeamLaunch(
  launch: () => Promise<Result<LaunchTeamResult> | null>
): Promise<{ result: Result<LaunchTeamResult> | null; error: string | null }> {
  try {
    return { result: await launch(), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: null, error: `Launch failed: ${message}` };
  }
}
type CancelState = { kind: 'pending' | 'success' | 'error' | 'retry'; message: string } | null;
export function cancelStateForResult(result: CancelTeamLaunchResult): NonNullable<CancelState> {
  const { canceledSessionIds: ids, pendingSessionIds, lifecycleState } = result;
  if (pendingSessionIds.length > 0) {
    return {
      kind: 'retry',
      message: `Cancellation pending; retry. Sessions: ${pendingSessionIds.join(', ')}.`
    };
  }
  return {
    kind: 'success',
    message: ids.length > 0
      ? lifecycleState === 'cancel-pending'
        ? `Cancellation requested for ${ids.length} session${ids.length === 1 ? '' : 's'}: ${ids.join(', ')}.`
        : `Canceled ${ids.length} session${ids.length === 1 ? '' : 's'}: ${ids.join(', ')}.`
      : lifecycleState === 'canceled'
        ? 'Launch already canceled or complete.'
        : 'Cancellation in progress.'
  };
}
function tabCount(team: Team): number {
  return team.slots.reduce((sum, s) => sum + Math.max(1, Math.min(TEAM_SLOT_MAX, s.quantity ?? 1)), 0);
}

export function SquadsView() {
  const allTeams = useTeams((s) => s.teams);
  const loading = useTeams((s) => s.loading);
  const projects = useData((s) => s.projects);
  const pushToast = useUi((s) => s.pushToast);
  const [filter, setFilter] = useState<SourceKind>('all');
  const [query, setQuery] = useState('');
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [rowMenu, setRowMenu] = useState<{ team: Team; x: number; y: number; trigger: HTMLElement } | null>(null);

  // In a per-project window, hide other projects' project-teams (mirrors the
  // PersonasPanel filter). Main window: all teams.
  const scopedProjectId = getScopedProjectId();
  const teams = useMemo(() => {
    if (!scopedProjectId) return allTeams;
    return allTeams.filter(
      (t) =>
        typeof t.source !== 'object' ||
        t.source === null ||
        !('projectId' in t.source) ||
        t.source.projectId === scopedProjectId
    );
  }, [allTeams, scopedProjectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter((t) => {
      if (filter !== 'all' && sourceKind(t.source) !== filter) return false;
      if (!q) return true;
      const haystack = `${t.name} ${t.id} ${t.description ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [teams, filter, query]);

  const counts = useMemo(() => {
    const c = { all: teams.length, builtin: 0, user: 0, project: 0, extension: 0 };
    for (const t of teams) c[sourceKind(t.source)] += 1;
    return c;
  }, [teams]);

  // Launch a team into an EXPLICIT project. The project is chosen at the point
  // of action (the row's Launch button opens a project menu), not a global
  // header dropdown — so the choice is contextual to the team you're launching.
  // main re-validates the id (Rule 1), so a stale id fails cleanly with a toast.
  const launch = async (team: Team, projectId: string): Promise<Result<LaunchTeamResult> | null> => {
    if (!projectId) {
      pushToast('Add a project before launching a team.', 'error');
      return null;
    }
    const res = await product.teams.launch(team.id, projectId);
    if (res.ok) {
      const n = res.value.launched;
      const where = projects.find((p) => p.id === projectId)?.name ?? 'project';
      pushToast(
        n > 0
          ? `Launched ${team.name} in ${where}: opened ${n} tab${n === 1 ? '' : 's'}.`
          : `${team.name}: no tabs opened (no resolvable personas).`,
        n > 0 ? 'info' : 'error'
      );
    } else {
      pushToast(`Launch failed: ${res.message}`, 'error');
    }
    return res;
  };

  const reveal = async () => {
    const res = await product.teams.revealDir();
    if (!res.ok) pushToast(res.message ?? 'Failed to reveal teams directory', 'error');
  };

  const exportTeam = async (team: Team) => {
    const res = await product.teams.exportBundle(team.id);
    if (!res.ok) {
      pushToast(`Export failed: ${res.message}`, 'error');
      return;
    }
    if (res.value.canceled) return;
    pushToast(`Exported "${team.name}" to ${res.value.path}.`, 'info');
  };

  const duplicateTeam = async (team: Team) => {
    const result = await product.teams.duplicate(team.id);
    if (!result.ok) {
      pushToast(`Duplicate failed: ${result.message}`, 'error');
      return;
    }
    pushToast(`Created squad “${result.value.name}”`, 'info');
  };

  const deleteTeam = async (team: Team) => {
    const result = await product.teams.delete(team.id);
    if (!result.ok) {
      pushToast(`Delete failed: ${result.message}`, 'error');
      return;
    }
    pushToast(`Deleted squad “${team.name}”`, 'info');
  };

  const importBundle = async () => {
    const res = await product.teams.importBundle();
    if (!res.ok) {
      pushToast(`Import failed: ${res.message}`, 'error');
      return;
    }
    if (res.value.canceled || !res.value.team) return;
    pushToast(
      `Imported "${res.value.team.name}" (${res.value.personaCount} persona${res.value.personaCount === 1 ? '' : 's'}).`,
      'info'
    );
  };

  return (
    <section className="settings-catalogue skills-panel squads-panel">
        <div className="settings-catalogue-actions">
            <button
              type="button"
              className="settings-btn primary"
              onClick={() => setEditor({ kind: 'new' })}
            >
              <Plus size={12} /> New squad
            </button>
            <button type="button" className="settings-btn" onClick={importBundle}>
              <Upload size={12} /> Import bundle
            </button>
            <button type="button" className="settings-btn" onClick={reveal}>
              <FolderOpen size={12} /> Reveal
            </button>
        </div>

        <div className="skills-layout">
          <section className="skills-left">
            <div className="skills-toolbar">
              <div className="skills-search">
                <Search size={14} aria-hidden />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search teams…"
                  aria-label="Search teams"
                />
              </div>
              <div className="skills-filter" role="tablist" aria-label="Source filter">
                {SOURCE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className={`skills-filter-btn ${filter === f.id ? 'is-active' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="skills-filter-count">{counts[f.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <DelayedStencilList label="Loading teams" className="scheduler-empty" />
            ) : filtered.length === 0 ? (
              <div className="scheduler-empty">
                <Users size={28} className="scheduler-empty-icon" />
                <div className="scheduler-empty-title">
                  {teams.length === 0 ? 'No teams found' : 'No matches'}
                </div>
                <div className="scheduler-empty-hint">
                  {teams.length === 0
                    ? 'Create a team with “New team”, or use a builtin.'
                    : 'Try a different search or filter.'}
                </div>
              </div>
            ) : (
              <ul className="skills-list">
                {filtered.map((t) => (
                  <TeamRow
                    key={t.id}
                    team={t}
                    projects={projects}
                    scopedProjectId={scopedProjectId}
                    onLaunch={(projectId) => launch(t, projectId)}
                    onOpen={() => setEditor({ kind: 'open', team: t })}
                    isExpanded={expandedTeamId === t.id}
                    onToggleExpand={() =>
                      setExpandedTeamId((cur) => (cur === t.id ? null : t.id))
                    }
                    onExport={() => exportTeam(t)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setRowMenu({ team: t, x: event.clientX, y: event.clientY, trigger: event.target as HTMLElement });
                    }}
                    onContextMenuKey={(event) => {
                      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setRowMenu({ team: t, x: rect.left, y: rect.bottom, trigger: event.currentTarget });
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      {editor && (
        <SquadEditor
          team={editor.kind === 'open' ? editor.team : null}
          mode={
            editor.kind === 'new'
              ? 'edit'
              : editor.team.source === 'user'
                ? 'edit'
                : 'view'
          }
          onClose={() => setEditor(null)}
        />
      )}
      {rowMenu && (
        <TeamRowMenu
          team={rowMenu.team}
          anchor={{ x: rowMenu.x, y: rowMenu.y }}
          onClose={() => {
            setRowMenu(null);
            rowMenu.trigger.focus();
          }}
          onOpen={() => setEditor({ kind: 'open', team: rowMenu.team })}
          onReveal={() => void reveal()}
          onDuplicate={() => void duplicateTeam(rowMenu.team)}
          onDelete={() => void deleteTeam(rowMenu.team)}
        />
      )}
    </section>
  );
}

function TeamRow({
  team,
  projects,
  scopedProjectId,
  onLaunch,
  onOpen,
  isExpanded,
  onToggleExpand,
  onExport,
  onContextMenu,
  onContextMenuKey
}: {
  team: Team;
  projects: Project[];
  /** Set in a per-project window — launch is locked to that project (no picker). */
  scopedProjectId: string | null;
  onLaunch: (projectId: string) => Promise<Result<LaunchTeamResult> | null>;
  onOpen: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onExport: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onContextMenuKey: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const Icon = resolveIcon(team.icon ?? 'Users');
  const tabs = tabCount(team);
  const allPersonas = usePersonas((s) => s.personas);
  const [picking, setPicking] = useState(false);
  const [launchResult, setLaunchResult] = useState<LaunchTeamResult | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [cancelState, setCancelState] = useState<CancelState>(null);
  const [activeMenuIndex, setActiveMenuIndex] = useState(0);
  const launchInFlightRef = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const launchButtonRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Resolve personas for each slot (orchestrator first) — the expanded row
  // renders one item per agent the team will open.
  const slotPersonas = useMemo(() => {
    const personas: Array<{ slot: { personaId: string; quantity?: number; label?: string }; persona: Persona | null }> = [];

    // Add orchestrator first if defined
    if (team.orchestratorPersonaId) {
      const persona = allPersonas.find((p) => p.id === team.orchestratorPersonaId) ?? null;
      personas.push({
        slot: { personaId: team.orchestratorPersonaId, quantity: 1, label: 'Orchestrator' },
        persona
      });
    }

    // Add all other slots — skip any slot that IS the orchestrator (some teams
    // list the orchestrator persona in both `orchestratorPersonaId` and `slots`,
    // which would otherwise render it twice).
    team.slots.forEach((slot) => {
      if (team.orchestratorPersonaId && slot.personaId === team.orchestratorPersonaId) return;
      const persona = allPersonas.find((p) => p.id === slot.personaId) ?? null;
      personas.push({ slot, persona });
    });

    return personas;
  }, [team, allPersonas]);

  // Close the picker on an outside click or Escape.
  useEffect(() => {
    if (!picking) return;
    const onDoc = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPicking(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPicking(false);
      launchButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [picking]);

  useEffect(() => {
    if (picking) {
      setActiveMenuIndex(0);
      menuItemRefs.current[0]?.focus();
    }
  }, [picking]);

  // Where can this team launch? In a scoped window, only that project. Otherwise
  // every project, with the team's own default sorted first for quick access.
  const launchTargets = useMemo(() => {
    if (scopedProjectId) return projects.filter((p) => p.id === scopedProjectId);
    const def = team.defaultProjectId;
    return [...projects].sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : 0));
  }, [projects, scopedProjectId, team.defaultProjectId]);

  // Click → launch straight away when there's no real choice (scoped window, or
  // a single project); otherwise open the picker so the user names the project.
  const runLaunch = async (projectId: string) => {
    await runTeamLaunchExclusive(launchInFlightRef, async () => {
      setLaunching(true);
      setLaunchResult(null);
      setLaunchError(null);
      setCancelState(null);
      try {
        const outcome = await runTeamLaunch(() => onLaunch(projectId));
        if (outcome.error) {
          setLaunchError(outcome.error);
          return;
        }
        const result = outcome.result;
        if (!result) return;
        if (result.ok) setLaunchResult(result.value);
        else {
          setLaunchResult(null);
          setLaunchError(`Launch failed: ${result.message}`);
        }
      } finally {
        setLaunching(false);
      }
    });
  };

  const cancelLaunch = async (launchRequestId: string) => {
    setCancelState({ kind: 'pending', message: 'Canceling launch…' });
    try {
      const result = await product.teams.cancel(launchRequestId);
      if (!result.ok) {
        setCancelState({ kind: 'error', message: `Cancel failed: ${result.message}` });
        return;
      }
      setCancelState(cancelStateForResult(result.value));
    } catch (error) {
      setCancelState({ kind: 'error', message: `Cancel failed: ${String(error)}` });
    }
  };

  const onLaunchClick = () => {
    if (launchTargets.length === 0) {
      void runLaunch(''); // surfaces the "add a project first" toast in the parent
      return;
    }
    if (launchTargets.length === 1) {
      void runLaunch(launchTargets[0].id);
      return;
    }
    setPicking((v) => !v);
  };

  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <li className="skills-row skills-row--clickable team-row" onContextMenu={onContextMenu}>
      <div className="team-row-header">
        <button
          type="button"
          className="teams-expand-btn"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Collapse ${team.name}` : `Expand ${team.name} to see agents`}
        >
          <ChevronIcon size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="skills-row-open"
          onClick={onOpen}
          onKeyDown={onContextMenuKey}
          aria-label={`Open ${team.name}`}
        >
          <span className="tab-profile-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <div className="skills-row-body">
            <div className="skills-row-head">
              <span className="skills-row-name">{team.name}</span>
              <span className="scheduler-pill scheduler-pill--source">{sourceLabel(team.source)}</span>
              <span className="scheduler-pill">
                {tabs} tab{tabs === 1 ? '' : 's'}
              </span>
            </div>
            {team.description && <p className="skills-row-desc">{team.description}</p>}
          </div>
        </button>
        <button
          type="button"
          className="settings-btn team-row-export"
          onClick={onExport}
          aria-label={`Export ${team.name} as a squad bundle`}
          title="Export as squad bundle"
        >
          <Download size={12} />
        </button>
        <div className="team-row-launch-wrap" ref={pickerRef}>
          <button
            ref={launchButtonRef}
            type="button"
            className="settings-btn primary team-row-launch"
            onClick={onLaunchClick}
            disabled={launching}
            aria-haspopup={launchTargets.length > 1 ? 'menu' : undefined}
            aria-expanded={launchTargets.length > 1 ? picking : undefined}
            aria-label={`Launch ${team.name}`}
          >
            <Play size={12} /> {launching ? 'Launching…' : 'Launch'}
          </button>
          {picking && (
          <div
            className="team-launch-menu"
            role="menu"
            aria-label={`Launch ${team.name} in…`}
            onKeyDown={(event) => {
              const current = menuItemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
              const next = menuIndexForKey(event.key, Math.max(0, current), launchTargets.length);
              if (next === undefined) return;
              event.preventDefault();
              setActiveMenuIndex(next);
              menuItemRefs.current[next]?.focus();
            }}
          >
            <div className="team-launch-menu-head">Launch in…</div>
            {launchTargets.map((p, index) => (
              <button
                ref={(node) => { menuItemRefs.current[index] = node; }}
                key={p.id}
                type="button"
                role="menuitem"
                tabIndex={menuTabIndex(index, activeMenuIndex)}
                className="team-launch-menu-item"
                disabled={launching}
                onClick={() => {
                  setPicking(false);
                  launchButtonRef.current?.focus();
                  void runLaunch(p.id);
                }}
              >
                <span
                  className="team-launch-menu-dot"
                  style={p.color ? { background: p.color } : undefined}
                  aria-hidden="true"
                />
                <span className="team-launch-menu-name">{p.name}</span>
                {p.id === team.defaultProjectId && (
                  <span className="team-launch-menu-default">default</span>
                )}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {launchResult && (
        <TeamLaunchStatus result={launchResult} cancelState={cancelState} onCancel={cancelLaunch} />
      )}
      {launchError && <div role="alert">{launchError}</div>}

      {isExpanded && (
        <div className="teams-agents-list" role="region" aria-label={`Agents in ${team.name}`}>
          {team.slots.length === 0 && !team.orchestratorPersonaId ? (
            <div className="teams-agents-empty">
              No agents configured for this team
            </div>
          ) : slotPersonas.length === 0 ? (
            <DelayedStencilList label="Loading agents" className="teams-agents-empty" />
          ) : (
            <ul className="teams-agents">
              {slotPersonas.map((item, idx) => {
                const { slot, persona } = item;
                const quantity = Math.max(1, Math.min(TEAM_SLOT_MAX, slot.quantity ?? 1));
                const isOrchestrator = slot.personaId === team.orchestratorPersonaId;

                return (
                  <li key={`${slot.personaId}-${idx}`} className="teams-agent-item">
                    <span className="teams-agent-icon" aria-hidden="true">
                      {persona ? personaIcon(persona) : <Users size={14} />}
                    </span>
                    <div className="teams-agent-body">
                      <div className="teams-agent-header">
                        <span className="teams-agent-name">
                          {persona?.name ?? slot.personaId}
                        </span>
                        {isOrchestrator && (
                          <span className="teams-agent-badge teams-agent-badge--orch">
                            Orchestrator
                          </span>
                        )}
                        {quantity > 1 && (
                          <span className="teams-agent-badge">
                            {quantity}x
                          </span>
                        )}
                      </div>
                      {persona?.description && (
                        <p className="teams-agent-desc">{persona.description}</p>
                      )}
                      {!persona && (
                        <p className="teams-agent-missing">
                          Persona not found
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function TeamRowMenu({
  team,
  anchor,
  onClose,
  onOpen,
  onReveal,
  onDuplicate,
  onDelete
}: {
  team: Team;
  anchor: { x: number; y: number };
  onClose: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canDelete = team.source === 'user';

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const padding = 8;
    const rect = menu.getBoundingClientRect();
    const left = anchor.x + rect.width > window.innerWidth - padding
      ? Math.max(padding, window.innerWidth - rect.width - padding)
      : anchor.x;
    const top = anchor.y + rect.height > window.innerHeight - padding
      ? Math.max(padding, window.innerHeight - rect.height - padding)
      : anchor.y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [anchor]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      role="menu"
      aria-label={`Actions for ${team.name}`}
      style={{ top: anchor.y, left: anchor.x }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const items = itemRefs.current.filter((item): item is HTMLButtonElement => !!item);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = menuIndexForKey(event.key, Math.max(0, current), items.length);
        if (next === undefined) return;
        event.preventDefault();
        items[next]?.focus();
      }}
    >
      <button ref={(item) => { itemRefs.current[0] = item; }} role="menuitem" onClick={() => { onClose(); onOpen(); }}>
        <Pencil size={13} /> {team.source === 'user' ? 'Edit' : 'View'}
      </button>
      <button ref={(item) => { itemRefs.current[1] = item; }} role="menuitem" onClick={() => { onClose(); onReveal(); }}>
        <FolderOpen size={13} /> Reveal folder
      </button>
      <button ref={(item) => { itemRefs.current[2] = item; }} role="menuitem" onClick={() => { onClose(); onDuplicate(); }}>
        <Copy size={13} /> Duplicate
      </button>
      {canDelete && (
        <>
          <div className="tab-context-sep" />
          <button ref={(item) => { itemRefs.current[3] = item; }} role="menuitem" className="tab-context-danger" onClick={() => { onClose(); onDelete(); }}>
            <Trash2 size={13} /> Delete
          </button>
        </>
      )}
    </div>
  );
}

export function TeamLaunchStatus({
  result,
  cancelState,
  onCancel
}: {
  result: LaunchTeamResult;
  cancelState: CancelState;
  onCancel: (launchRequestId: string) => void;
}) {
  const sessionIds = result.workers.length > 0
    ? result.workers.map((worker) => worker.sessionId)
    : [result.orchestratorSessionId, ...result.workerSessionIds].filter((id): id is string => !!id);

  return (
    <div role="status" aria-live="polite">
      <div>Launched sessions: {sessionIds.length > 0 ? sessionIds.join(', ') : 'none'}</div>
      {result.failedSlots.length > 0 && (
        <div>
          Failed slots:{' '}
          {result.failedSlots.map((slot) => `${slot.slotId} (${slot.personaId}): ${slot.reason}`).join('; ')}
        </div>
      )}
      <button
        type="button"
        className="settings-btn"
        disabled={cancelState?.kind === 'pending'}
        onClick={() => onCancel(result.launchRequestId)}
      >
        {cancelState?.kind === 'retry' ? 'Retry cancellation' : 'Cancel launch'}
      </button>
      {cancelState && (
        <div role={cancelState.kind === 'error' || cancelState.kind === 'retry' ? 'alert' : 'status'}>
          {cancelState.message}
        </div>
      )}
    </div>
  );
}

export { SquadsView as SquadsPanel };
