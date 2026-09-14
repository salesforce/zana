import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { TerminalSquare, GitBranch } from 'lucide-react';
import type { ProjectView } from '@/store';
import { useData, useUi, visibleTerminals } from '@/store';
import { TabBar } from '@/components/TabBar';
import { cliAgentRestartConfirm } from '@/components/agentCardActions';
import { FindBar } from '@/components/FindBar';
import { AgentsBoard } from '@/views/agents/AgentsBoard';
import { ProjectExtensionTab } from '@/views/project/ProjectExtensionTab';
import { useProjectTabModules } from '@/modules';
import { resolveProjectTabModule } from '@/lib/libraryPlugin';
import { DelayedStencilList } from '@/components/ui/Skeleton';
import { PluginSlotBoundary } from '@/plugins/PluginSlotBoundary';
import { ProjectStatusbarItems } from '@/plugins/ProjectStatusbarItems';
import { listProjectTabs, projectTabView, subscribePluginSlots } from '@/plugins/plugin-slots';
import { projectTerminalsAnchorId } from '@/lib/split-layout/agentSessionPortal';
import { decodeRouteParam, getProjectModeRoutePath } from '@/lib/route-paths';
import { useNavigate } from 'react-router-dom';
import { SplitPaneHeaderActions } from '@/views/thread-detail/SplitPaneHeaderActions';
import { PaneEmptyState } from '@/components/PaneEmptyState';
import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';

const ExplorerView = lazy(() =>
  import('@/views/project/ExplorerView').then((m) => ({ default: m.ExplorerView }))
);
const ProjectGoalsView = lazy(() =>
  import('@/views/project/GoalsView').then((m) => ({ default: m.ProjectGoalsView }))
);
const ProjectFollowUpsView = lazy(() =>
  import('@/views/follow-ups/ProjectFollowUpsView').then((m) => ({ default: m.ProjectFollowUpsView }))
);
const ProjectFeedView = lazy(() =>
  import('@/views/project/FeedView').then((m) => ({ default: m.ProjectFeedView }))
);
const SchedulerPanel = lazy(() =>
  import('@/views/scheduler/SchedulerView').then((m) => ({ default: m.SchedulerPanel }))
);

export function ProjectModePane({
  projectId,
  mode,
  paneId
}: {
  projectId: string;
  mode: string;
  paneId: string;
}) {
  const navigate = useNavigate();
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const selectTab = useUi((s) => s.selectTab);
  const findOpen = useUi((s) => s.findOpen);
  const setProjectView = useUi((s) => s.setProjectView);
  const createTerminal = useData((s) => s.createTerminal);
  const closeTerminal = useData((s) => s.closeTerminal);
  const hideTerminal = useData((s) => s.hideTerminal);
  const reorderTerminal = useData((s) => s.reorderTerminal);
  const renameTerminal = useData((s) => s.renameTerminal);
  const restartTerminal = useData((s) => s.restartTerminal);
  const reconnectRemote = useData((s) => s.reconnectRemote);
  const setPinned = useData((s) => s.setPinned);

  const projectTabModules = useProjectTabModules();
  const slotTabs = useSyncExternalStore(subscribePluginSlots, listProjectTabs, listProjectTabs);
  const slotPluginIds = new Set(slotTabs.map((tab) => tab.pluginId));
  const diskProjectTabModules = projectTabModules.filter((module) => !slotPluginIds.has(module.id));

  const project = projects.find((row) => row.id === projectId) ?? null;
  const gitStatus = useData((s) => (project ? s.gitStatus[project.id] : null)) ?? null;
  const terminalTabs = project
    ? visibleTerminals(terminals[project.id]).filter((t) => t.profile === 'shell')
    : [];
  const activeTabId = project ? selectedTabId[project.id] : undefined;
  const activeTab = terminalTabs.find((t) => t.id === activeTabId) ?? terminalTabs[0];
  const viewMode: ProjectView = decodeRouteParam(mode);
  const slotTab = project
    ? slotTabs.find((tab) => projectTabView(tab, slotTabs) === viewMode)
    : undefined;
  const extModule = project ? resolveProjectTabModule(viewMode, diskProjectTabModules) : undefined;
  const isExtTab = !!extModule || !!slotTab;
  const isAgents = viewMode === 'agents' && !!project;
  const isExplorer = viewMode === 'explorer' && !!project;
  const isScheduler = viewMode === 'scheduler' && !!project;
  const isFeed = viewMode === 'feed' && !!project;
  const goalsEnabled = useData((s) => s.goalsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  const isGoals = viewMode === 'goals' && !!project && goalsEnabled;
  const isFollowups = viewMode === 'followups' && !!project && followUpsEnabled;
  const isTerminals =
    !!project &&
    !isAgents &&
    !isExplorer &&
    !isScheduler &&
    !isFeed &&
    !isGoals &&
    !isFollowups &&
    !isExtTab;

  useEffect(() => {
    if (!project) return;
    if (viewMode === 'skills') {
      setProjectView(project.id, 'terminals');
      void navigate(getProjectModeRoutePath(project.id, 'terminals'), { replace: true });
    }
  }, [project, viewMode, setProjectView, navigate]);

  useEffect(() => {
    if (!project) return;
    if ((viewMode === 'goals' && !goalsEnabled) || (viewMode === 'followups' && !followUpsEnabled)) {
      setProjectView(project.id, 'agents');
      void navigate(getProjectModeRoutePath(project.id, 'agents'), { replace: true });
    }
  }, [project, viewMode, goalsEnabled, followUpsEnabled, setProjectView, navigate]);

  useEffect(() => {
    if (!project || !isTerminals) return;
    if (terminalTabs.length === 0) {
      if (activeTabId !== undefined) selectTab(project.id, undefined);
      return;
    }
    if (!terminalTabs.find((t) => t.id === activeTabId)) {
      selectTab(project.id, terminalTabs[terminalTabs.length - 1].id);
    }
  }, [project, isTerminals, terminalTabs, activeTabId, selectTab]);

  const handleNewTab = async (
    profile: LaunchProfileId,
    opts?: { extraArgs?: string[]; title?: string; personaId?: string; frameworkIds?: string[] }
  ) => {
    if (!project) return;
    const session = await createTerminal(project.id, profile, 80, 24, opts);
    if (session) selectTab(project.id, session.id);
  };

  const handleNewTerminal = () => handleNewTab('shell');

  if (!project) {
    return (
      <div className="project-mode-pane" data-testid="project-mode-pane" data-mode={mode}>
        <PaneEmptyState
          art="missing"
          title="Project not found"
          hint="This workspace is no longer available."
        />
      </div>
    );
  }

  return (
    <div className="project-mode-pane" data-testid="project-mode-pane" data-mode={viewMode}>
      {!isAgents && (
        <div className="project-topbar">
          <div className="project-topbar-tabs">
            {isTerminals ? (
              <TabBar
                tabs={terminalTabs}
                activeTabId={activeTab?.id}
                onSelect={(id) => selectTab(project.id, id)}
                onClose={(id) => closeTerminal(id, project.id)}
                onDetach={(id) => hideTerminal(id, project.id)}
                onNewTerminal={handleNewTerminal}
                onReorder={(from, to) => reorderTerminal(project.id, from, to)}
                onRename={(id, title) => renameTerminal(project.id, id, title)}
                onDuplicate={(id) => {
                  const src = terminalTabs.find((t) => t.id === id);
                  if (!src) return;
                  handleNewTab(src.profile, { extraArgs: src.extraArgs, title: src.title });
                }}
                onRestart={(id) => {
                  const src = terminalTabs.find((t) => t.id === id);
                  if (!src) return;
                  if (
                    src.status !== 'exited' &&
                    !window.confirm(cliAgentRestartConfirm(src.title))
                  ) {
                    return;
                  }
                  void restartTerminal(id, project.id);
                }}
                onReconnect={
                  project.remote ? (id) => void reconnectRemote(id, project.id) : undefined
                }
                onPin={(id, pinned) => setPinned(project.id, id, pinned)}
              />
            ) : (
              <div className="explorer-topbar">
                <span className="explorer-topbar-label">
                  {isExplorer
                    ? 'Explorer'
                    : isScheduler
                      ? 'Scheduler'
                      : isFeed
                        ? 'Feed'
                        : isGoals
                          ? 'Goals'
                          : isFollowups
                            ? 'Follow-ups'
                            : (extModule?.projectTab?.label ?? extModule?.title ?? slotTab?.label)}
                </span>
              </div>
            )}
            <SplitPaneHeaderActions />
          </div>
        </div>
      )}
      <div className="project-body">
        {isTerminals && (
          <div id={projectTerminalsAnchorId(paneId)} className="terminal-host">
            {findOpen && activeTab && <FindBar sessionId={activeTab.id} />}
            {terminalTabs.length === 0 ? (
              <div className="empty-project overlay">
                <div className="empty-inner">
                  <h3>No terminals open</h3>
                  <p>Start a shell in {project.name}.</p>
                  <button className="btn primary" onClick={handleNewTerminal}>
                    <TerminalSquare size={14} />
                    New terminal
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
        {isExplorer && (
          <Suspense fallback={<DelayedStencilList label="Loading explorer" className="zcc-stencil-padded" />}>
            <ExplorerView project={project} />
          </Suspense>
        )}
        {isScheduler && (
          <Suspense fallback={<DelayedStencilList label="Loading scheduler" className="zcc-stencil-padded" />}>
            <SchedulerPanel projectId={project.id} />
          </Suspense>
        )}
        {isGoals && (
          <Suspense fallback={<DelayedStencilList label="Loading goals" className="zcc-stencil-padded" />}>
            <ProjectGoalsView project={project} />
          </Suspense>
        )}
        {isFollowups && (
          <Suspense fallback={<DelayedStencilList label="Loading follow-ups" className="zcc-stencil-padded" />}>
            <ProjectFollowUpsView project={project} />
          </Suspense>
        )}
        {isFeed && (
          <Suspense fallback={<DelayedStencilList label="Loading feed" className="zcc-stencil-padded" />}>
            <ProjectFeedView project={project} />
          </Suspense>
        )}
        {isExtTab && slotTab && (
          <div className="project-ext-tab">
            <PluginSlotBoundary pluginId={slotTab.pluginId} generation={slotTab.generation}>
              {(() => {
                const Component = slotTab.component;
                return <Component pluginId={slotTab.pluginId} projectId={project.id} />;
              })()}
            </PluginSlotBoundary>
          </div>
        )}
        {isExtTab && extModule && !slotTab && (
          <div className="project-ext-tab">
            <ProjectExtensionTab moduleId={extModule.id} project={project} />
          </div>
        )}
        {isAgents && <AgentsBoard scope={{ kind: 'project', project }} />}
      </div>
      <div className="statusbar">
        <span>{project.path}</span>
        {gitStatus && (gitStatus.branch || gitStatus.detached) && (
          <span
            className={`statusbar-git ${gitStatus.dirty ? 'dirty' : ''}`}
            title={
              gitStatus.dirty
                ? 'Working tree has uncommitted changes'
                : 'Working tree clean'
            }
          >
            <GitBranch size={11} />
            <span>{gitStatus.detached ? 'detached' : gitStatus.branch}</span>
            {gitStatus.ahead > 0 && <span className="statusbar-git-ab">↑{gitStatus.ahead}</span>}
            {gitStatus.behind > 0 && <span className="statusbar-git-ab">↓{gitStatus.behind}</span>}
            {gitStatus.dirty && (
              <span className="statusbar-git-dot" aria-hidden="true">
                ●
              </span>
            )}
          </span>
        )}
        <ProjectStatusbarItems projectId={project.id} align="left" navigate={navigate} />
        <span className="grow" />
        <ProjectStatusbarItems projectId={project.id} align="right" navigate={navigate} />
        {isTerminals && activeTab && (
          <>
            <span>{activeTab.profile}</span>
            <span>pid {activeTab.pid ?? '—'}</span>
            <span>{activeTab.status}</span>
          </>
        )}
      </div>
    </div>
  );
}
