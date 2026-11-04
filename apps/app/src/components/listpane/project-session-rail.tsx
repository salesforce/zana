import { useMemo, useState, type HTMLAttributes, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ChevronRight, MessageCirclePlus, MoreHorizontal, Network } from 'lucide-react';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  projectRailTerminals,
  useAgentStatus,
  useData,
  useIdleTriage,
  useUi
} from '../../store.js';
import { useThreads, type ThreadListItem } from '../../thread-store.js';
import { useEnsureThreads } from '../../hooks/useEnsureThreads.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { getAgentSessionRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { railThreadsForProject } from '../fleet-item.js';
import { composerProjectLabel, isRemoteWorkspaceProject } from '../composer-project-default.js';
import { ProjectDot } from './ProjectDot.js';
import {
  AgentCardMenu,
  clampMenuAnchor,
  useAgentCardActions
} from '../agentCardActions.js';
import { ThreadCardMenu, openThreadMenu, useThreadCardActions } from '../threadCardActions.js';
import { PromptModal } from '../PromptModal.js';
import type { AgentCard } from '../AgentBoard.js';
import { ProjectAgentRailRow, ProjectThreadRailRow } from './project-session-rail-rows.js';
import { projectNavigationSessions } from '../../lib/teamRunOrganization.js';
import { FocusedProjectMenu } from './FocusedProjectMenu.js';

const SIDEBAR_PROJECT_SESSION_SECTION_KEY = 'sidebar:project-sessions';
const SIDEBAR_PROJECT_SESSION_TREE_ID = 'sidebar-project-sessions-tree';

export function useProjectRailSessions(projectId: string): {
  liveList: TerminalSession[];
  railThreads: ThreadListItem[];
  hasSessions: boolean;
} {
  const terminals = useData((s) => s.terminals);
  const organization = useData((s) => s.projectNavigationOrganization);
  const threads = useThreads(useShallow((s) => s.threads.filter(thread => thread.projectId === projectId)));
  useEnsureThreads();
  return useMemo(() => {
    const liveList = projectNavigationSessions(projectRailTerminals(terminals[projectId]), organization);
    const railThreads = railThreadsForProject(
      threads
    );
    return {
      liveList,
      railThreads,
      hasSessions: liveList.length > 0 || railThreads.length > 0
    };
  }, [projectId, terminals, threads, organization]);
}

/**
 * Bottom-of-rail tree for a focused project — same chrome as the global
 * Projects collection, minus filter / sort / add. Nested session rows match
 * the global workspace tree.
 *
 * With `projectRow={false}` the titlebar already names the project and owns its
 * actions menu, so the redundant project row is dropped and the section becomes
 * a flat "Sessions" list.
 */
export function ProjectSessionRail({
  project,
  dragHandle,
  onNavigate,
  projectRow = true
}: {
  project: Project;
  dragHandle?: HTMLAttributes<HTMLElement>;
  onNavigate?: (event: { preventDefault: () => void }) => void;
  projectRow?: boolean;
}) {
  const { liveList, railThreads } = useProjectRailSessions(project.id);
  const unread = useUi((s) => s.unread);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const collapsed = useUi((s) => !!s.collapsedSections[SIDEBAR_PROJECT_SESSION_SECTION_KEY]);
  const toggleSection = useUi((s) => s.toggleSection);
  const setLauncherOpen = useUi((s) => s.setLauncherOpen);
  const navigate = useNavigate();
  const { threadId: activeThreadId, sessionId: activeSessionId } = useRouteState();
  const {
    menu: agentMenu,
    setMenu: setAgentMenu,
    actions: agentActions,
    rename: agentRename,
    closeRename: closeAgentRename,
    submitRename: submitAgentRename
  } = useAgentCardActions();
  const { menu: threadMenu, setMenu: setThreadMenu } = useThreadCardActions();
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number } | null>(null);
  const showProjectMenu = (x: number, y: number) => {
    setAgentMenu(null);
    setThreadMenu(null);
    setProjectMenu({ x, y });
  };

  const sessionToCard = (session: TerminalSession): AgentCard => ({
    session,
    state: useAgentStatus.getState().byId[session.id] ?? 'unknown',
    projectId: project.id,
    projectName: composerProjectLabel(project),
    projectColor: project.color,
    triage: useIdleTriage.getState().byId[session.id]
  });

  const openAgentCardMenu = (e: MouseEvent, session: TerminalSession) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectMenu(null);
    setThreadMenu(null);
    setAgentMenu({ card: sessionToCard(session), ...clampMenuAnchor(e) });
  };

  const nestedCount = liveList.length + railThreads.length;
  const displayName = composerProjectLabel(project);
  const hasUnread = liveList.some((session) => unread[session.id]);
  const activeTab = selectedTabId[project.id];
  const sectionLabel = projectRow ? 'Project' : 'Sessions';

  return (
    <section
      className={`sidebar-projects ${collapsed ? 'sidebar-projects--collapsed' : ''}`}
      data-testid="project-session-rail"
    >
      <header className="sidebar-projects-header">
        <button
          type="button"
          className="sidebar-projects-heading"
          {...dragHandle}
          data-testid="project-session-rail-heading"
          onClick={(event) => {
            onNavigate?.(event);
            if (event.defaultPrevented) return;
            toggleSection(SIDEBAR_PROJECT_SESSION_SECTION_KEY);
          }}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${sectionLabel} section`}
          aria-controls={SIDEBAR_PROJECT_SESSION_TREE_ID}
          aria-expanded={!collapsed}
          title={`${collapsed ? 'Expand' : 'Collapse'} ${sectionLabel}`}
        >
          <span>{sectionLabel}</span>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`sidebar-projects-chevron ${collapsed ? '' : 'open'}`}
          />
        </button>
        {!projectRow && nestedCount > 0 ? <span className="project-badge">{nestedCount}</span> : null}
      </header>
      <div
        id={SIDEBAR_PROJECT_SESSION_TREE_ID}
        className="sidebar-projects-body"
        hidden={collapsed}
      >
        {projectRow ? <div className="project-item" data-session-move-project={project.id} onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showProjectMenu(event.clientX, event.clientY);
        }}>
          <ProjectDot project={project} unread={hasUnread} />
          <button
            type="button"
            className="project-select project-meta project-meta--inline"
            aria-label={`Open ${displayName}`}
            onClick={() => {
              const ui = useUi.getState();
              ui.setNav('projects');
              ui.enterProjectFocus(project.id);
            }}
          >
            <span className="project-name">{displayName}</span>
            {isRemoteWorkspaceProject(project) && (
              <Network size={11} strokeWidth={2} className="project-remote-icon" aria-label="Remote SSH project" />
            )}
          </button>
          {nestedCount > 0 ? <span className="project-badge">{nestedCount}</span> : null}
          <button type="button" className="project-actions" aria-label={`Project actions for ${displayName}`}
            title="Project actions" onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              showProjectMenu(rect.right, rect.bottom);
            }}>
            <MoreHorizontal size={15} />
          </button>
          <button
            type="button"
            className="project-spawn"
            aria-label={`New agent in ${displayName}`}
            title="New agent"
            onClick={(e) => {
              e.stopPropagation();
              setLauncherOpen(true, project.id);
            }}
          >
            <MessageCirclePlus size={14} />
          </button>
        </div> : null}
        {nestedCount > 0 ? (
          <div
            className={`project-terminals${projectRow ? '' : ' project-terminals--flat'}`}
            role="list"
            aria-label={`Sessions in ${displayName}`}
          >
            {railThreads.map((thread) => (
              <ProjectThreadRailRow
                key={thread.id}
                thread={thread}
                active={activeThreadId === thread.id}
                projectId={project.id}
                routeProjectId={project.id}
                onOpen={() => {
                  navigate(getThreadRoutePath(thread.id, project.id));
                }}
                onContextMenu={(e) => {
                  setProjectMenu(null);
                  openThreadMenu(e, thread, setThreadMenu);
                }}
              />
            ))}
            {liveList.map((session) => (
              <ProjectAgentRailRow
                key={session.id}
                session={session}
                isUnread={!!unread[session.id] && activeTab !== session.id}
                active={activeSessionId === session.id}
                onOpen={() => {
                  navigate(getAgentSessionRoutePath(session.id, project.id));
                }}
                onContextMenu={(e) => openAgentCardMenu(e, session)}
                projectId={project.id}
                routeProjectId={project.id}
                projectRemote={Boolean(project.remote)}
              />
            ))}
          </div>
        ) : !projectRow ? (
          <div className="sidebar-projects-empty">No sessions yet</div>
        ) : null}
      </div>
      {projectMenu && <FocusedProjectMenu project={project} {...projectMenu} onClose={() => setProjectMenu(null)} />}
      {agentMenu && (
        <AgentCardMenu menu={agentMenu} setMenu={setAgentMenu} actions={agentActions} />
      )}
      {threadMenu && <ThreadCardMenu menu={threadMenu} setMenu={setThreadMenu} />}
      {agentRename && (
        <PromptModal
          title="Rename agent"
          label="Name"
          initialValue={agentRename.card.session.title}
          confirmLabel="Rename"
          onSubmit={(v) => submitAgentRename(agentRename.card, v)}
          onClose={closeAgentRename}
        />
      )}
    </section>
  );
}
