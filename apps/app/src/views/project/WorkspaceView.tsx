import { product } from '../../lib/product-client.js';
import { lazy, Suspense, useEffect } from 'react';
import { TerminalSquare, GitBranch, Columns2, Rows2, LayoutGrid, Square, Bot } from 'lucide-react';
import type { SplitLayout, ProjectView } from '@/store';
import { useData, useUi, visibleTerminals, backgroundTerminals } from '@/store';
import { useRouteState } from '@/hooks/useRouteState';
import { TabBar } from '@/components/TabBar';
import { PROJECTS_TERMINAL_ANCHOR_ID } from '@/components/TerminalSurface';
import { AgentLauncher } from '@/components/AgentLauncher';
import { FindBar } from '@/components/FindBar';
import { AgentsBoard } from '@/views/agents/AgentsBoard';
import { NewThreadView } from '@/views/threads/NewThreadView';
import { ThreadDetail } from '@/views/threads/ThreadDetailView';
import { ProjectExtensionTab } from '@/views/project/ProjectExtensionTab';
import { useProjectTabModules } from '@/modules';
import { resolveProjectTabModule } from '@/lib/libraryPlugin';
import { DelayedStencilList } from '@/components/ui/Skeleton';

// Lazy-load the editor surface. monaco-editor registers default editor
// extensions into a global `RegistryImpl` singleton, so it's lazy-loaded to
// keep it out of the initial bundle. The Docs plugin's Library view lazy-loads
// monaco itself.
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
import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';

export function WorkspaceView() {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const selectTab = useUi((s) => s.selectTab);
  const findOpen = useUi((s) => s.findOpen);
  const launcherOpen = useUi((s) => s.launcherOpen);
  const setLauncherOpen = useUi((s) => s.setLauncherOpen);
  const workspaceModeMap = useUi((s) => s.workspaceMode);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const splitLayoutMap = useUi((s) => s.splitLayout);
  const splitTabIdsMap = useUi((s) => s.splitTabIds);
  const setSplitLayout = useUi((s) => s.setSplitLayout);
  const openInSplit = useUi((s) => s.openInSplit);
  const removeFromSplit = useUi((s) => s.removeFromSplit);
  const closeSplit = useUi((s) => s.closeSplit);
  const createTerminal = useData((s) => s.createTerminal);
  const loadProjects = useData((s) => s.loadProjects);
  const selectProject = useUi((s) => s.selectProject);
  const closeTerminal = useData((s) => s.closeTerminal);
  const hideTerminal = useData((s) => s.hideTerminal);
  const reorderTerminal = useData((s) => s.reorderTerminal);
  const renameTerminal = useData((s) => s.renameTerminal);
  const restartTerminal = useData((s) => s.restartTerminal);
  const reconnectRemote = useData((s) => s.reconnectRemote);
  const setPinned = useData((s) => s.setPinned);
  const markExited = useData((s) => s.markExited);

  // Extension-contributed project tabs (modules that declared `projectTab`).
  // Generic — core never names a concrete extension here (Rule 6).
  const projectTabModules = useProjectTabModules();

  const route = useRouteState();
  const workspaceShown = route.nav === 'projects' && !!route.focusedProjectId;
  const project = projects.find((p) => p.id === selectedProjectId) ?? null;
  const gitStatus = useData((s) => (project ? s.gitStatus[project.id] : null)) ?? null;
  // Terminals mode is shells-only. Claude agents (whether launched manually,
  // spawned, or promoted from a background job) live on the Agents board — the
  // tab strip would otherwise fill up with them and bury the actual terminals,
  // losing all visibility (see the "Terminals mode only ever creates a plain
  // shell" note on handleNewTerminal below). Filtering by profile keeps the
  // strip a view of real shells; agents stay fully accessible in Agents mode.
  // (`visibleTerminals` already drops headless/hidden sessions.)
  const terminalTabs = project
    ? visibleTerminals(terminals[project.id]).filter((t) => t.profile === 'shell')
    : [];
  const backgroundTabs = project ? backgroundTerminals(terminals[project.id]) : [];
  const activeTabId = project ? selectedTabId[project.id] : undefined;
  const activeTab = terminalTabs.find((t) => t.id === activeTabId) ?? terminalTabs[0];
  // Opening a project writes 'agents' in enterProjectFocus. This fallback
  // covers first paint / a project with no saved mode yet.
  const mode: ProjectView = project
    ? workspaceModeMap[project.id] ?? 'agents'
    : 'agents';
  // The active view is an extension project tab when `mode` matches a
  // project-tab module's id (not a core mode). An id whose extension is gone is
  // tolerated: `extModule` is undefined and the view falls through to the
  // Terminals catch-all below.
  const extModule = project ? resolveProjectTabModule(mode, projectTabModules) : undefined;
  const isExtTab = !!extModule;
  const isNewThread = route.isNewThread && !!project;
  const isThreadView = route.isThreadView && !!project && !!route.threadId;
  const isAgents = mode === 'agents' && !!project && !isNewThread && !isThreadView;
  const isExplorer = mode === 'explorer' && !!project;
  const isScheduler = mode === 'scheduler' && !!project;
  const isFeed = mode === 'feed' && !!project;
  // Goals + Follow-ups are opt-in experimental features. The ProjectScopedNav
  // rail bounces a project off a disabled mode, but gate here too so the tab
  // buttons + panels never show when the flag is off (belt-and-suspenders).
  const goalsEnabled = useData((s) => s.goalsEnabled);
  const followUpsEnabled = useData((s) => s.followUpsEnabled);
  const isGoals = mode === 'goals' && !!project && goalsEnabled;
  const isFollowups = mode === 'followups' && !!project && followUpsEnabled;
  // Terminals is the catch-all. Agents mode shows the Kanban-style status
  // board, so the terminal-host is hidden for it — same as explorer/
  // library/goals/followups and any extension project tab.
  const isTerminals =
    !isNewThread &&
    !isThreadView &&
    !isAgents &&
    !isExplorer &&
    !isScheduler &&
    !isFeed &&
    !isGoals &&
    !isFollowups &&
    !isExtTab;
  // Skills is no longer a project view. If a persisted project mode still points
  // there from an older build, bounce it to terminals so the user never lands on
  // a hidden/unreachable view.
  useEffect(() => {
    if (!project) return;
    if (mode === 'skills') setWorkspaceMode(project.id, 'terminals');
  }, [project, mode, setWorkspaceMode]);

  const splitLayout: SplitLayout = (project && splitLayoutMap[project.id]) || 'single';
  const splitTabIds = (project && splitTabIdsMap[project.id]) || [];
  const splitActive = splitLayout !== 'single';

  useEffect(() => {
    const off = product.terminals.onExit((id, code) => markExited(id, code));
    return off;
  }, [markExited]);

  // Keep the Terminals strip's selection valid — but only while Terminals mode
  // is showing. `selectedTabId` is shared with the Agents board (which tracks
  // the selected agent through the same field), so clamping it to a shell tab
  // outside Terminals mode would fight the board and steal its selection.
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

  // Terminals mode only ever creates a plain shell — agent profiles (claude /
  // claude --yolo / personas) belong to the Agents view's launcher. The "+"
  // and the empty-state button route straight here, no launcher modal.
  const handleNewTerminal = () => handleNewTab('shell');

  // Empty-state escape hatch: with no project selected there's nothing to
  // launch into, so offer the built-in scratch workspace. Ensure it exists,
  // select it, drop into Agents mode, and open the Quick Agent launcher — the
  // same path the Agents nav uses, reachable from the bare Workspace.
  const handleStartQuickAgent = async () => {
    const res = await product.projects.ensureQuickAgent();
    if (!res.ok) return; // ensureQuickAgent surfaces its own failure upstream
    await loadProjects();
    selectProject(res.value.id);
    setWorkspaceMode(res.value.id, 'agents');
  };

  // Split layouts (vertical/horizontal/grid) are wired up in the store and
  // TerminalSurface but the toolbar picker is hidden for now — feels off in
  // practice. Flip this to re-enable. Right-click "Open in split" entries on
  // the TabBar are also gated below.
  const SPLIT_UI_ENABLED = false;

  // Layout picker: only meaningful when terminals are visible (not explorer
  // mode) and the project has at least one tab. Hidden otherwise.
  const layoutPicker = SPLIT_UI_ENABLED && project && isTerminals && terminalTabs.length > 0 && (
    <div className="workspace-layout-picker" role="group" aria-label="Terminal layout">
      <button
        type="button"
        className={splitLayout === 'single' ? 'active' : ''}
        title="Single pane"
        onClick={() => closeSplit(project.id)}
      >
        <Square size={13} />
      </button>
      <button
        type="button"
        className={splitLayout === 'vertical' ? 'active' : ''}
        title="Vertical split"
        onClick={() => setSplitLayout(project.id, 'vertical')}
      >
        <Columns2 size={13} />
      </button>
      <button
        type="button"
        className={splitLayout === 'horizontal' ? 'active' : ''}
        title="Horizontal split"
        onClick={() => setSplitLayout(project.id, 'horizontal')}
      >
        <Rows2 size={13} />
      </button>
      <button
        type="button"
        className={splitLayout === 'grid' ? 'active' : ''}
        title="2×2 grid"
        onClick={() => setSplitLayout(project.id, 'grid')}
      >
        <LayoutGrid size={13} />
      </button>
    </div>
  );

  // Always mount TerminalSurface (preserves scrollback). When in explorer mode
  // we visually swap the middle section to ExplorerView via display:none.
  return (
    <div className="workspace panel-body--full">
      {!isThreadView && (
      <div className="workspace-topbar">
        {/* Layout picker only. Mode switching lives on ProjectScopedNav; mounting
            an empty modes row would leave a padded band where the old horizontal
            menu used to be. */}
        {project && layoutPicker && (
          <div className="workspace-topbar-modes">
            {layoutPicker}
          </div>
        )}
        <div className="workspace-topbar-tabs">
        {isTerminals ? (
          <TabBar
            tabs={terminalTabs}
            activeTabId={activeTab?.id}
            onSelect={(id) => project && selectTab(project.id, id)}
            onClose={(id) => project && closeTerminal(id, project.id)}
            onDetach={(id) => project && hideTerminal(id, project.id)}
            onNewTerminal={handleNewTerminal}
            onReorder={(from, to) => project && reorderTerminal(project.id, from, to)}
            onRename={(id, title) => project && renameTerminal(project.id, id, title)}
            onDuplicate={(id) => {
              if (!project) return;
              const src = terminalTabs.find((t) => t.id === id);
              if (!src) return;
              handleNewTab(src.profile, { extraArgs: src.extraArgs, title: src.title });
            }}
            onRestart={(id) => {
              if (!project) return;
              const src = terminalTabs.find((t) => t.id === id);
              if (!src) return;
              if (
                src.status !== 'exited' &&
                !window.confirm(`Kill and restart "${src.title}"?`)
              ) {
                return;
              }
              void restartTerminal(id, project.id);
            }}
            onReconnect={
              project?.remote
                ? (id) => project && void reconnectRemote(id, project.id)
                : undefined
            }
            onPin={(id, pinned) => project && setPinned(project.id, id, pinned)}
            splitTabIds={SPLIT_UI_ENABLED ? splitTabIds : undefined}
            splitActive={SPLIT_UI_ENABLED && splitActive}
            onOpenInSplit={SPLIT_UI_ENABLED ? (id) => project && openInSplit(project.id, id) : undefined}
            onRemoveFromSplit={SPLIT_UI_ENABLED ? (id) => project && removeFromSplit(project.id, id) : undefined}
            onCloseSplit={SPLIT_UI_ENABLED && project ? () => closeSplit(project.id) : undefined}
          />
        ) : isNewThread ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">New agent</span>
          </div>
        ) : isAgents ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Agents</span>
          </div>
        ) : isExplorer ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Explorer</span>
          </div>
        ) : isScheduler ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Scheduler</span>
          </div>
        ) : isFeed ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Feed</span>
          </div>
        ) : isGoals ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Goals</span>
          </div>
        ) : isFollowups ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Follow-ups</span>
          </div>
        ) : (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">
              {extModule?.projectTab?.label ?? extModule?.title}
            </span>
          </div>
        )}
        </div>
      </div>
      )}
      <div className="workspace-body">
          <div
            id={PROJECTS_TERMINAL_ANCHOR_ID}
            className="terminal-host"
            style={{ display: isTerminals ? undefined : 'none' }}
          >
            {/* The single app-level TerminalSurface portals its grid in here when
               nav === 'projects'. FindBar / overlays sit above it via z-index,
               so portal DOM order (appended last) doesn't affect stacking. */}
            {findOpen && activeTab && <FindBar sessionId={activeTab.id} />}
            {!project ? (
              <div className="empty-workspace overlay">
                <div className="empty-inner">
                  <h3>Select a project</h3>
                  <p>Or add one with the + button on the left.</p>
                  <p className="empty-or">— or —</p>
                  <button className="btn primary" onClick={handleStartQuickAgent}>
                    <Bot size={14} />
                    Start a quick agent
                  </button>
                  <p className="empty-hint">
                    A scratch Claude session in <code>~/zcc-workspace</code> — no project needed.
                  </p>
                </div>
              </div>
            ) : terminalTabs.length === 0 ? (
              <div className="empty-workspace overlay">
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
          {isExplorer && project && (
            <Suspense fallback={<DelayedStencilList label="Loading explorer" className="zcc-stencil-padded" />}>
              <ExplorerView project={project} />
            </Suspense>
          )}
          {isScheduler && project && (
            <Suspense fallback={<DelayedStencilList label="Loading scheduler" className="zcc-stencil-padded" />}>
              <SchedulerPanel projectId={project.id} />
            </Suspense>
          )}
          {isGoals && project && (
            <Suspense fallback={<DelayedStencilList label="Loading goals" className="zcc-stencil-padded" />}>
              <ProjectGoalsView project={project} />
            </Suspense>
          )}
          {isFollowups && project && (
            <Suspense fallback={<DelayedStencilList label="Loading follow-ups" className="zcc-stencil-padded" />}>
              <ProjectFollowUpsView project={project} />
            </Suspense>
          )}
          {isFeed && project && (
            <Suspense fallback={<DelayedStencilList label="Loading feed" className="zcc-stencil-padded" />}>
              <ProjectFeedView project={project} />
            </Suspense>
          )}
          {isExtTab && project && extModule && (
            // Extension-contributed project tab: the extension's own panel,
            // mounted scoped to this project. Wrapped in its own error boundary
            // inside ProjectExtensionTab so a throwing extension is contained.
            <div className="project-ext-tab">
              <ProjectExtensionTab moduleId={extModule.id} project={project} />
            </div>
          )}
          {isNewThread && project && <NewThreadView project={project} />}
          {isThreadView && route.threadId && <ThreadDetail key={route.threadId} threadId={route.threadId} />}
          {isAgents && project && (
            // Agents mode: a Kanban-style status board. Cards auto-flow across
            // lanes by live agent state; New agent opens the shared modal host.
            <AgentsBoard scope={{ kind: 'project', project }} />
          )}
      </div>
      <div className="statusbar">
        <span>{project?.path ?? '—'}</span>
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
            {gitStatus.dirty && <span className="statusbar-git-dot" aria-hidden="true">●</span>}
          </span>
        )}
        <span className="grow" />
        {isTerminals && activeTab && (
          <>
            <span>{activeTab.profile}</span>
            <span>pid {activeTab.pid ?? '—'}</span>
            <span>{activeTab.status}</span>
          </>
        )}
      </div>
      {launcherOpen && project && workspaceShown && (
        <AgentLauncher
          project={project}
          backgroundTabs={backgroundTabs}
          onClose={() => setLauncherOpen(false)}
        />
      )}
    </div>
  );
}

export { WorkspaceView as Workspace };
