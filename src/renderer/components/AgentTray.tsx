import { useMemo, type CSSProperties } from 'react';
import { Activity, Clock } from 'lucide-react';
import type { AgentState, TerminalSession } from '@shared/types';
import { useData, useUi, useAgentStatus } from '../store';
import { FavoriteStar } from './FavoriteStar';

/**
 * Which agent states the tray surfaces, in display-priority order. We show only
 * the two states that actually want the user's attention:
 *   blocked — agent is waiting on the user (permission prompt / question — the
 *             Notification-hook state), so it's listed first and pulses red.
 *   working — agent is actively running, so you can hop in and watch.
 * `done`/`idle`/`unknown` are deliberately excluded — they aren't "running" and
 * don't need you, so they'd just be noise here.
 */
const TRAY_STATES: readonly AgentState[] = ['blocked', 'working'];
const STATE_RANK: Record<string, number> = { blocked: 0, working: 1 };

const STATE_LABEL: Record<string, string> = {
  blocked: 'Needs you',
  working: 'Working'
};

interface TrayAgent {
  session: TerminalSession;
  projectId: string;
  projectName: string;
  projectColor?: string;
  state: AgentState;
}

/**
 * Bottom-of-sidebar tray listing every agent that is currently running or
 * waiting for user interaction. One click jumps straight to that session's tab
 * (un-hiding it first if it's a background/scheduled run), mirroring the inbox
 * "focus session" path so the behavior is consistent.
 *
 * Headless (background/scheduler) sessions are intentionally included — a
 * blocked scheduled run is exactly the kind of thing you want surfaced here.
 *
 * Scope: by default the tray spans ALL projects (the global Sidebar). Pass
 * `projectId` to confine it to one project — the focused-project rail
 * (ProjectScopedNav) uses this so a drilled-in user still sees "needs you"
 * agents for the project they're in, without the cross-project noise.
 */
export function AgentTray({
  projectId,
  placement = 'footer'
}: {
  projectId?: string;
  placement?: 'footer' | 'inline';
} = {}) {
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const byId = useAgentStatus((s) => s.byId);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

  // Derive the flat, sorted list once per relevant change. Selectors above
  // return raw store slices (stable refs); the fresh array lives behind useMemo
  // so we don't trip zustand's re-render loop (see MEMORY zustand-selector-stable-ref).
  const agents = useMemo<TrayAgent[]>(() => {
    const byProjectId = new Map(projects.map((p) => [p.id, p]));
    const out: TrayAgent[] = [];
    for (const [pid, list] of Object.entries(terminals)) {
      // Project scope (focused rail): only this project's sessions.
      if (projectId && pid !== projectId) continue;
      for (const session of list) {
        const state = byId[session.id] ?? 'unknown';
        if (!TRAY_STATES.includes(state)) continue;
        const project = byProjectId.get(pid);
        out.push({
          session,
          projectId: pid,
          projectName: project?.name ?? 'Unknown',
          projectColor: project?.color,
          state
        });
      }
    }
    out.sort((a, b) => {
      const r = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9);
      if (r !== 0) return r;
      return a.session.title.localeCompare(b.session.title);
    });
    return out;
  }, [terminals, projects, byId, projectId]);

  const blockedCount = agents.reduce((n, a) => n + (a.state === 'blocked' ? 1 : 0), 0);

  // Clicking a tray row opens the agent-inspector modal — a peek at the live
  // terminal + metadata without leaving the current view. The modal's "Open in
  // workspace" button is the path to the full split-pane view (the old focus
  // behaviour); keeping the row click lightweight means a glance doesn't yank
  // you out of whatever you were doing.
  const inspect = (a: TrayAgent) => {
    useUi.getState().openAgentModal(a.session.id, a.projectId);
  };

  // The sidebar collection stays visible even when it has no live work. A small
  // empty state makes the intentional space clear without adding a second CTA
  // beside the section header's New quick agent control.
  if (agents.length === 0) {
    return placement === 'inline' ? (
      <p className="agent-tray-empty" role="status">
        No active agents
      </p>
    ) : null;
  }

  // Collapsed rail: a single activity icon carrying the count. Red when any
  // agent is blocked (needs you), otherwise muted. Clicking expands the rail so
  // the full list is reachable.
  if (collapsed) {
    const title =
      blockedCount > 0
        ? `${agents.length} active · ${blockedCount} need you`
        : `${agents.length} active`;
    return (
      <div className={`agent-tray ${placement === 'inline' ? 'agent-tray--inline' : ''} collapsed`}>
        <button
          className="nav-item agent-tray-rail-btn"
          onClick={toggleSidebar}
          title={title}
          aria-label={title}
        >
          <span className="nav-item-icon">
            <Activity size={16} />
          </span>
          <span
            className={`nav-badge ${blockedCount > 0 ? 'nav-badge--blocked' : 'nav-badge--running'}`}
            aria-hidden="true"
          >
            {agents.length > 99 ? '99+' : agents.length}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={`agent-tray ${placement === 'inline' ? 'agent-tray--inline' : ''}`}>
      <div className="agent-tray-header">
        <span className="nav-section-label agent-tray-label">Active agents</span>
        <span className="agent-tray-count">{agents.length}</span>
      </div>
      <div className="agent-tray-list">
        {agents.map((a) => {
          // A scheduler-spawned (or otherwise headless/background) run isn't a
          // tab the user is driving — flag it so it doesn't read like an
          // interactive agent. `scheduled` is the specific "cron job" case;
          // `headless` covers detached background work generally.
          const background = a.session.scheduled || a.session.headless;
          const bgTitle = a.session.scheduled ? 'Scheduled run' : 'Background run';
          return (
            <button
              key={a.session.id}
              className={`agent-tray-row ${a.projectColor ? 'project-tinted' : ''} ${
                background ? 'is-background' : ''
              }`}
              onClick={() => inspect(a)}
              title={`${a.session.title} — ${a.projectName} · ${STATE_LABEL[a.state]}${
                background ? ` · ${bgTitle}` : ''
              }`}
              style={a.projectColor ? ({ '--project-color': a.projectColor } as CSSProperties) : undefined}
            >
              <span className={`tab-agent-dot agent-${a.state}`} aria-hidden="true" />
              <span className="agent-tray-row-text">
                <span className="agent-tray-row-title-line">
                  <span className="agent-tray-row-title">{a.session.title}</span>
                  {background && (
                    <span className="agent-tray-bg-chip" title={bgTitle}>
                      <Clock size={9} aria-hidden="true" />
                      {a.session.scheduled ? 'Scheduled' : 'Background'}
                    </span>
                  )}
                </span>
                {/* Project name is redundant when the tray is already scoped to
                    one project (focused rail) — show it only in the global tray. */}
                {!projectId && <span className="agent-tray-row-meta">{a.projectName}</span>}
              </span>
              {a.state === 'blocked' && (
                <span className="agent-tray-needs-you">{STATE_LABEL[a.state]}</span>
              )}
              <FavoriteStar session={a.session} className="agent-tray-fav" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
