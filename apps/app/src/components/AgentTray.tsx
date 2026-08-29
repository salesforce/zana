import { useMemo, type CSSProperties, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Clock } from 'lucide-react';
import { ProviderIcon } from './thread/pickers/ProviderIcon.js';
import type { AgentState, TerminalSession } from '@zana-ai/zcc-domain/product';
import { useData, useUi, useAgentStatus, useIdleTriage } from '../store.js';
import { useThreads } from '../thread-store.js';
import { useEnsureThreads } from '../hooks/useEnsureThreads.js';
import { getThreadRoutePath } from '../lib/route-paths.js';
import { FavoriteStar } from './FavoriteStar.js';
import { useAgentCardActions, AgentCardMenu, clampMenuAnchor } from './agentCardActions.js';
import { useThreadCardActions, ThreadCardMenu, openThreadMenu } from './threadCardActions.js';
import { PromptModal } from './PromptModal.js';
import type { AgentCard } from './AgentBoard.js';
import { FleetKindChip } from './FleetKindChip.js';
import { isVisibleThread, threadTitle } from './fleet-item.js';
import { threadStatusToAgentState } from './thread/thread-timeline-model.js';

/**
 * Which agent states the tray surfaces, in display-priority order.
 *
 * Global (unscoped) tray: only states that want attention — blocked first,
 * then working. Idle/done/unknown stay off that list so the footer isn't noise.
 *
 * Workspace (project-scoped) tray: also include idle / unknown so you can
 * resume an at-rest agent in the project you're already in. Scheduled runs
 * that are only waiting stay hidden — they aren't yours to resume until they
 * actually work or need you.
 */
const GLOBAL_TRAY_STATES: readonly AgentState[] = ['blocked', 'working'];
const WORKSPACE_TRAY_STATES: readonly AgentState[] = ['blocked', 'working', 'idle', 'unknown'];
const STATE_RANK: Record<string, number> = { blocked: 0, working: 1, idle: 2, unknown: 3 };

const STATE_LABEL: Record<string, string> = {
  blocked: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  unknown: 'Idle'
};

export function trayStatesFor(projectId: string | undefined): readonly AgentState[] {
  return projectId ? WORKSPACE_TRAY_STATES : GLOBAL_TRAY_STATES;
}

/** Scheduled runs that are merely waiting stay off the workspace rail. */
export function isScheduledWaiting(
  session: Pick<TerminalSession, 'scheduled'>,
  state: AgentState
): boolean {
  return Boolean(session.scheduled) && (state === 'idle' || state === 'unknown');
}

interface TrayAgent {
  kind: 'agent';
  session: TerminalSession;
  projectId: string;
  projectName: string;
  projectColor?: string;
  state: AgentState;
}

interface TrayThread {
  kind: 'thread';
  id: string;
  title: string;
  projectId: string;
  providerId: string;
  projectName: string;
  projectColor?: string;
  state: AgentState;
}

type TrayItem = TrayAgent | TrayThread;

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
  const threads = useThreads((s) => s.threads);
  useEnsureThreads();
  const navigate = useNavigate();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const { menu, setMenu, actions, rename, closeRename, submitRename } = useAgentCardActions();
  const { menu: threadMenu, setMenu: setThreadMenu } = useThreadCardActions();

  const pickAgent = (card: AgentCard) => {
    const ui = useUi.getState();
    ui.setNav('projects');
    ui.enterProjectFocus(card.projectId);
    if (card.session.headless && card.session.status !== 'exited') {
      void useData.getState().restoreTerminal(card.session.id, card.projectId);
    } else {
      ui.selectTab(card.projectId, card.session.id);
    }
    ui.setWorkspaceMode(card.projectId, 'terminals');
  };

  const openAgentMenu = (e: MouseEvent, a: TrayAgent) => {
    e.preventDefault();
    e.stopPropagation();
    setThreadMenu(null);
    setMenu({
      card: {
        session: a.session,
        state: a.state,
        projectId: a.projectId,
        projectName: a.projectName,
        projectColor: a.projectColor,
        triage: useIdleTriage.getState().byId[a.session.id]
      },
      ...clampMenuAnchor(e)
    });
  };

  const items = useMemo<TrayItem[]>(() => {
    const allowed = trayStatesFor(projectId);
    const byProjectId = new Map(projects.map((p) => [p.id, p]));
    const out: TrayItem[] = [];
    for (const [pid, list] of Object.entries(terminals)) {
      if (projectId && pid !== projectId) continue;
      for (const session of list) {
        if (session.profile === 'shell' || session.status === 'exited') continue;
        const state = byId[session.id] ?? 'unknown';
        if (!allowed.includes(state) || isScheduledWaiting(session, state)) continue;
        const project = byProjectId.get(pid);
        out.push({
          kind: 'agent',
          session,
          projectId: pid,
          projectName: project?.name ?? 'Unknown',
          projectColor: project?.color,
          state
        });
      }
    }
    for (const thread of threads) {
      if (!isVisibleThread(thread)) continue;
      if (projectId && thread.projectId !== projectId) continue;
      const state = threadStatusToAgentState(thread.status, thread.hasPendingInteraction);
      if (!allowed.includes(state)) continue;
      const project = byProjectId.get(thread.projectId);
      out.push({
        kind: 'thread',
        id: thread.id,
        title: threadTitle(thread),
        projectId: thread.projectId,
        providerId: thread.providerId,
        projectName: project?.name ?? 'Unknown',
        projectColor: project?.color,
        state
      });
    }
    out.sort((a, b) => {
      const r = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9);
      if (r !== 0) return r;
      const titleA = a.kind === 'thread' ? a.title : a.session.title;
      const titleB = b.kind === 'thread' ? b.title : b.session.title;
      return titleA.localeCompare(titleB);
    });
    return out;
  }, [terminals, projects, byId, projectId, threads]);

  const blockedCount = items.reduce((n, item) => n + (item.state === 'blocked' ? 1 : 0), 0);

  const inspectAgent = (a: TrayAgent) => {
    useUi.getState().openAgentModal(a.session.id, a.projectId);
  };

  if (items.length === 0) {
    return placement === 'inline' ? (
      <p className="agent-tray-empty" role="status">
        {projectId ? 'No agents' : 'No active agents'}
      </p>
    ) : null;
  }

  if (collapsed) {
    const title =
      blockedCount > 0
        ? `${items.length} ${projectId ? 'agents' : 'active'} · ${blockedCount} need you`
        : `${items.length} ${projectId ? 'agents' : 'active'}`;
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
            {items.length > 99 ? '99+' : items.length}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={`agent-tray ${placement === 'inline' ? 'agent-tray--inline' : ''}`}>
      {!(placement === 'inline' && projectId) && (
      <div className="agent-tray-header">
        <span className="nav-section-label agent-tray-label">Active agents</span>
        <span className="agent-tray-count">{items.length}</span>
      </div>
      )}
      <div className="agent-tray-list">
        {items.map((item) => {
          if (item.kind === 'thread') {
            return (
              <button
                key={item.id}
                type="button"
                className={`agent-tray-row is-thread ${item.projectColor ? 'project-tinted' : ''}`}
                data-kind="thread"
                onClick={() => navigate(getThreadRoutePath(item.id, projectId))}
                onContextMenu={(e) => {
                  const thread = threads.find((row) => row.id === item.id);
                  if (!thread) return;
                  setMenu(null);
                  openThreadMenu(e, thread, setThreadMenu);
                }}
                title={`${item.title} — ${item.projectName} · ${STATE_LABEL[item.state]}`}
                style={item.projectColor ? ({ '--project-color': item.projectColor } as CSSProperties) : undefined}
              >
                <span className={`tab-agent-dot agent-${item.state}`} aria-hidden="true" />
                <ProviderIcon providerId={item.providerId} size={13} />
                <span className="agent-tray-row-text">
                  <span className="agent-tray-row-title-line">
                    <span className="agent-tray-row-title">{item.title}</span>
                    <FleetKindChip kind="thread" />
                  </span>
                  {!projectId && <span className="agent-tray-row-meta">{item.projectName}</span>}
                </span>
                {item.state === 'blocked' && (
                  <span className="agent-tray-needs-you">{STATE_LABEL[item.state]}</span>
                )}
              </button>
            );
          }
          const background = item.session.scheduled || item.session.headless;
          const bgTitle = item.session.scheduled ? 'Scheduled run' : 'Background run';
          return (
            <button
              key={item.session.id}
              className={`agent-tray-row ${item.projectColor ? 'project-tinted' : ''} ${
                background ? 'is-background' : ''
              }`}
              onClick={() => inspectAgent(item)}
              onContextMenu={(e) => openAgentMenu(e, item)}
              title={`${item.session.title} — ${item.projectName} · ${STATE_LABEL[item.state]}${
                background ? ` · ${bgTitle}` : ''
              }`}
              style={item.projectColor ? ({ '--project-color': item.projectColor } as CSSProperties) : undefined}
            >
              <span className={`tab-agent-dot agent-${item.state}`} aria-hidden="true" />
              <span className="agent-tray-row-text">
                <span className="agent-tray-row-title-line">
                  <span className="agent-tray-row-title">{item.session.title}</span>
                  <FleetKindChip kind="agent" />
                  {background && (
                    <span className="agent-tray-bg-chip" title={bgTitle}>
                      <Clock size={9} aria-hidden="true" />
                      {item.session.scheduled ? 'Scheduled' : 'Background'}
                    </span>
                  )}
                </span>
                {!projectId && <span className="agent-tray-row-meta">{item.projectName}</span>}
              </span>
              {item.state === 'blocked' && (
                <span className="agent-tray-needs-you">{STATE_LABEL[item.state]}</span>
              )}
              <FavoriteStar session={item.session} className="agent-tray-fav" />
            </button>
          );
        })}
      </div>
      {menu && (
        <AgentCardMenu menu={menu} setMenu={setMenu} actions={actions} onPick={pickAgent} />
      )}
      {threadMenu && (
        <ThreadCardMenu menu={threadMenu} setMenu={setThreadMenu} />
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
