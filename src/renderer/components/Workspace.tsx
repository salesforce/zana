import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { TerminalSquare, FolderTree, GitBranch, Columns2, Rows2, LayoutGrid, Square, Library, Clock, Bot, Target, MessageCircleQuestion, Activity, PanelRightOpen, PanelBottomOpen, ArrowLeftRight, X, ChevronDown } from 'lucide-react';
import type { SplitLayout, ProjectView } from '../store';
import { useData, useUi, visibleTerminals, backgroundTerminals } from '../store';
import { TabBar } from './TabBar';
import { PROJECTS_TERMINAL_ANCHOR_ID } from './TerminalSurface';
import { AgentLauncher } from './AgentLauncher';
import { FindBar } from './FindBar';
import { ProjectAgentsBoard } from './ProjectAgentsBoard';
import { ProjectExtensionTab } from './ProjectExtensionTab';
import { useProjectTabModules } from '../modules';
import { resolveIcon } from '../util/resolveIcon';
import { isProjectFocusedView } from '../util/windowScope';

// Lazy-load the editor surface. monaco-editor registers default editor
// extensions into a global `RegistryImpl` singleton, so it's lazy-loaded to
// keep it out of the initial bundle. LibraryView also imports monaco so it's
// lazy-loaded too.
const ExplorerView = lazy(() =>
  import('./ExplorerView').then((m) => ({ default: m.ExplorerView }))
);
const LibraryView = lazy(() =>
  import('./LibraryView').then((m) => ({ default: m.LibraryView }))
);
const ProjectGoalsView = lazy(() =>
  import('./ProjectGoalsView').then((m) => ({ default: m.ProjectGoalsView }))
);
const ProjectFollowUpsView = lazy(() =>
  import('./ProjectFollowUpsView').then((m) => ({ default: m.ProjectFollowUpsView }))
);
const ProjectFeedView = lazy(() =>
  import('./ProjectFeedView').then((m) => ({ default: m.ProjectFeedView }))
);
const SchedulerPanel = lazy(() =>
  import('./SchedulerPanel').then((m) => ({ default: m.SchedulerPanel }))
);
import type { LaunchProfileId } from '@shared/types';

export function Workspace() {
  const [resizingLayout, setResizingLayout] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 780px)').matches
  );
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const selectTab = useUi((s) => s.selectTab);
  const findOpen = useUi((s) => s.findOpen);
  const launcherOpen = useUi((s) => s.launcherOpen);
  const setLauncherOpen = useUi((s) => s.setLauncherOpen);
  const workspaceModeMap = useUi((s) => s.workspaceMode);
  const workspaceLayoutMap = useUi((s) => s.workspaceLayout);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const setWorkspaceLayout = useUi((s) => s.setWorkspaceLayout);
  const clearWorkspaceLayout = useUi((s) => s.clearWorkspaceLayout);
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
  // Default a freshly-opened project to the Agents board (not Terminals) — a
  // project the user has explicitly switched keeps its persisted mode.
  const mode: ProjectView = project
    ? workspaceModeMap[project.id] ?? 'agents'
    : 'agents';
  // The active view is an extension project tab when `mode` matches a
  // project-tab module's id (not a core mode). An id whose extension is gone is
  // tolerated: `extModule` is undefined and the view falls through to the
  // Terminals catch-all below.
  const extModule = project ? projectTabModules.find((m) => m.id === mode) : undefined;
  const isExtTab = !!extModule;
  const isAgents = mode === 'agents' && !!project;
  const isExplorer = mode === 'explorer' && !!project;
  const isLibrary = mode === 'library' && !!project;
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
    !isAgents &&
    !isExplorer &&
    !isLibrary &&
    !isScheduler &&
    !isFeed &&
    !isGoals &&
    !isFollowups &&
    !isExtTab;
  const persistedLayout = project ? workspaceLayoutMap[project.id] : undefined;
  const layout = persistedLayout && narrowViewport
    ? { ...persistedLayout, direction: 'vertical' as const }
    : persistedLayout;
  // One terminal outlet is deliberately shared by the primary and secondary
  // blocks. TerminalSurface remains the only xterm owner and moves its stable
  // portal node into this anchor; a second outlet would duplicate that surface.
  const secondaryView = layout?.secondaryView;
  const secondaryModule = project ? projectTabModules.find((m) => m.id === secondaryView) : undefined;
  const secondaryIs = (view: ProjectView) => secondaryView === view;
  const terminalVisible = isTerminals;
  // Skills is no longer a project view. If a persisted project mode still points
  // there from an older build, bounce it to terminals so the user never lands on
  // a hidden/unreachable view.
  useEffect(() => {
    if (!project) return;
    if (mode === 'skills') setWorkspaceMode(project.id, 'terminals');
  }, [project, mode, setWorkspaceMode]);

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 780px)');
    if (!media) return;
    const update = () => setNarrowViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const splitLayout: SplitLayout = (project && splitLayoutMap[project.id]) || 'single';
  const splitTabIds = (project && splitTabIdsMap[project.id]) || [];
  const splitActive = splitLayout !== 'single';

  useEffect(() => {
    const off = window.cc.terminals.onExit((id, code) => markExited(id, code));
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
    const res = await window.cc.projects.ensureQuickAgent();
    if (!res.ok) return; // ensureQuickAgent surfaces its own failure upstream
    await loadProjects();
    selectProject(res.value.id);
    setWorkspaceMode(res.value.id, 'agents');
    setLauncherOpen(true);
  };

  // Split layouts (vertical/horizontal/grid) are wired up in the store and
  // TerminalSurface but the toolbar picker is hidden for now — feels off in
  // practice. Flip this to re-enable. Right-click "Open in split" entries on
  // the TabBar are also gated below.
  const SPLIT_UI_ENABLED = false;

  const openSecondary = (direction: 'horizontal' | 'vertical', view: ProjectView) => {
    if (!project) return;
    setWorkspaceLayout(project.id, { secondaryView: view, direction, ratio: 0.5 });
  };

  const swapBlocks = () => {
    if (!project || !layout || !secondaryView || secondaryView === 'terminals') return;
    setWorkspaceMode(project.id, secondaryView);
    setWorkspaceLayout(project.id, { ...layout, secondaryView: mode });
  };

  const resizeBlocks = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!project || !layout) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    setResizingLayout(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    const update = (clientX: number, clientY: number) => {
      const raw = layout.direction === 'horizontal'
        ? (clientX - bounds.left) / bounds.width
        : (clientY - bounds.top) / bounds.height;
      setWorkspaceLayout(project.id, { ...persistedLayout!, ratio: Math.max(0.25, Math.min(0.75, raw)) });
    };
    const onMove = (move: PointerEvent) => update(move.clientX, move.clientY);
    const finish = () => {
      setResizingLayout(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', finish);
      resizeCleanupRef.current = null;
    };
    const onUp = () => finish();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', finish);
    resizeCleanupRef.current = finish;
  };

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const nudgeBlocks = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!project || !layout) return;
    const smaller = layout.direction === 'horizontal' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
    const larger = layout.direction === 'horizontal' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
    if (!smaller && !larger) return;
    event.preventDefault();
    setWorkspaceLayout(project.id, {
      ...persistedLayout!,
      ratio: Math.max(0.25, Math.min(0.75, layout.ratio + (larger ? 0.05 : -0.05)))
    });
  };

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

  // When the workspace modes live on the left rail (ProjectScopedNav) — either a
  // per-project window OR the main window drilled into a project — the
  // horizontal segmented control is redundant, so it's hidden in both.
  const modeToggle = project && !isProjectFocusedView(focusedProjectId) && (
    <div className="workspace-mode-segmented" role="group" aria-label="Workspace mode">
      <button
        type="button"
        className={isAgents ? 'active' : ''}
        onClick={() => setWorkspaceMode(project.id, 'agents')}
        title="Agents in this project"
        aria-pressed={isAgents}
      >
        <Bot size={13} />
        <span>Agents</span>
      </button>
      <button
        type="button"
        className={isTerminals ? 'active' : ''}
        onClick={() => setWorkspaceMode(project.id, 'terminals')}
        title="Terminals (⌘B toggles vs Explorer)"
        aria-pressed={isTerminals}
      >
        <TerminalSquare size={13} />
        <span>Terminals</span>
      </button>
      <button
        type="button"
        className={isExplorer ? 'active' : ''}
        onClick={() => setWorkspaceMode(project.id, 'explorer')}
        title="Explorer (⌘B toggles vs Terminals)"
        aria-pressed={isExplorer}
      >
        <FolderTree size={13} />
        <span>Explorer</span>
      </button>
      <button
        type="button"
        className={isLibrary ? 'active' : ''}
        onClick={() => setWorkspaceMode(project.id, 'library')}
        title="Library documents"
        aria-pressed={isLibrary}
      >
        <Library size={13} />
        <span>Library</span>
      </button>
      <button
        type="button"
        className={isScheduler ? 'active' : ''}
        onClick={() => setWorkspaceMode(project.id, 'scheduler')}
        title="Scheduled agents that spawn in this project"
        aria-pressed={isScheduler}
      >
        <Clock size={13} />
        <span>Scheduler</span>
      </button>
      <button
        type="button"
        className={isFeed ? 'active' : ''}
        onClick={() => setWorkspaceMode(project.id, 'feed')}
        title="Activity feed — a read-only history of this project"
        aria-pressed={isFeed}
      >
        <Activity size={13} />
        <span>Feed</span>
      </button>
      {goalsEnabled && (
        <button
          type="button"
          className={isGoals ? 'active' : ''}
          onClick={() => setWorkspaceMode(project.id, 'goals')}
          title="Goals for this project"
          aria-pressed={isGoals}
        >
          <Target size={13} />
          <span>Goals</span>
        </button>
      )}
      {followUpsEnabled && (
        <button
          type="button"
          className={isFollowups ? 'active' : ''}
          onClick={() => setWorkspaceMode(project.id, 'followups')}
          title="Follow-ups for this project"
          aria-pressed={isFollowups}
        >
          <MessageCircleQuestion size={13} />
          <span>Follow-ups</span>
        </button>
      )}
      {/* Extension-contributed project tabs, appended after the built-in tabs.
          Each mounts the extension's panel scoped to this project. */}
      {projectTabModules.map((m) => {
        const Icon = resolveIcon(m.projectTab?.icon ?? m.icon);
        const label = m.projectTab?.label ?? m.title;
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            className={active ? 'active' : ''}
            onClick={() => setWorkspaceMode(project.id, m.id)}
            title={`${label} for this project`}
            aria-pressed={active}
          >
            <Icon size={13} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );

  // Always mount TerminalSurface (preserves scrollback). When in explorer mode
  // we visually swap the middle section to ExplorerView via display:none.
  return (
    <main className="workspace">
      <div className="workspace-topbar">
        {/* Mode switcher (Terminals/Explorer/Library) on its own row
            above the tabs, so a long tab strip never squeezes it. Only mount
            the row when it actually has content — in a focused-project view
            both the layout picker and the segmented control are hidden (the
            modes live on the left rail), so rendering the wrapper would leave
            an empty padded band where the old horizontal menu used to be. */}
        {project && (layoutPicker || modeToggle) && (
          <div className="workspace-topbar-modes">
            {layoutPicker}
            {modeToggle}
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
        ) : isAgents ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Agents</span>
          </div>
        ) : isExplorer ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Explorer</span>
          </div>
        ) : isLibrary ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Library</span>
          </div>
        ) : isScheduler ? (
          <div className="explorer-topbar">
            <span className="explorer-topbar-label">Scheduler</span>
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
        {project && (
          <div className="workspace-layout-toolbar" role="group" aria-label="Workspace layout">
            {!layout ? (
              <>
                <span className="workspace-layout-kicker">Split workspace</span>
                <button type="button" title="Show the current view beside a terminal" onClick={() => {
                  const current = mode;
                  setWorkspaceMode(project.id, 'terminals');
                  openSecondary('horizontal', current === 'terminals' ? 'agents' : current);
                }}>
                  <PanelRightOpen size={13} /> With terminal
                </button>
                <button type="button" title="Show agents below this view" onClick={() => openSecondary('vertical', 'agents')}>
                  <PanelBottomOpen size={13} /> With agents
                </button>
              </>
            ) : (
              <>
                <span className="workspace-layout-kicker">{layout.direction === 'horizontal' ? 'Side by side' : 'Stacked'}</span>
                <button type="button" title="Change to side-by-side blocks" onClick={() => setWorkspaceLayout(project.id, { ...layout, direction: 'horizontal' })}>
                  <PanelRightOpen size={13} />
                </button>
                <button type="button" title="Change to stacked blocks" onClick={() => setWorkspaceLayout(project.id, { ...layout, direction: 'vertical' })}>
                  <PanelBottomOpen size={13} />
                </button>
                {secondaryView !== 'terminals' && (
                  <button type="button" title="Swap primary and secondary blocks" onClick={swapBlocks}>
                    <ArrowLeftRight size={13} /> Swap
                  </button>
                )}
                <label className="workspace-layout-view-picker">
                  <span className="sr-only">Secondary block view</span>
                  <select
                    aria-label="Secondary block view"
                    value={secondaryView ?? ''}
                    onChange={(event) => setWorkspaceLayout(project.id, { ...layout, secondaryView: event.target.value })}
                  >
                    <option value="agents">Agents</option>
                    <option value="explorer">Explorer</option>
                    <option value="library">Library</option>
                    <option value="scheduler">Scheduler</option>
                    <option value="feed">Feed</option>
                    {goalsEnabled && <option value="goals">Goals</option>}
                    {followUpsEnabled && <option value="followups">Follow-ups</option>}
                    {projectTabModules.map((module) => (
                      <option key={module.id} value={module.id}>
                        {module.projectTab?.label ?? module.title}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} aria-hidden="true" />
                </label>
                <button type="button" className="workspace-layout-close" title="Return to one block" onClick={() => clearWorkspaceLayout(project.id)}>
                  <X size={13} /> One block
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className={`workspace-body ${layout ? `workspace-body-split split-${layout.direction}` : ''} ${resizingLayout ? 'workspace-body-resizing' : ''}`} style={layout ? (layout.direction === 'horizontal'
        ? { gridTemplateColumns: `${layout.ratio}fr 8px ${1 - layout.ratio}fr` }
        : { gridTemplateRows: `${layout.ratio}fr 8px ${1 - layout.ratio}fr` }) as CSSProperties : undefined}>
        <section className="workspace-block workspace-block-primary" aria-label="Primary workspace block">
          <div
            id={PROJECTS_TERMINAL_ANCHOR_ID}
            className="terminal-host"
            style={{ display: terminalVisible ? undefined : 'none' }}
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
            <Suspense fallback={<div className="workbench-status">Loading explorer…</div>}>
              <ExplorerView project={project} />
            </Suspense>
          )}
          {isLibrary && project && (
            <Suspense fallback={<div className="workbench-status">Loading library…</div>}>
              <LibraryView project={project} />
            </Suspense>
          )}
          {isScheduler && project && (
            <Suspense fallback={<div className="workbench-status">Loading scheduler…</div>}>
              <SchedulerPanel projectId={project.id} />
            </Suspense>
          )}
          {isGoals && project && (
            <Suspense fallback={<div className="workbench-status">Loading goals…</div>}>
              <ProjectGoalsView project={project} />
            </Suspense>
          )}
          {isFollowups && project && (
            <Suspense fallback={<div className="workbench-status">Loading follow-ups…</div>}>
              <ProjectFollowUpsView project={project} />
            </Suspense>
          )}
          {isFeed && project && (
            <Suspense fallback={<div className="workbench-status">Loading feed…</div>}>
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
          {isAgents && project && (
            // Agents mode: a Kanban-style status board. Cards auto-flow across
            // lanes by live agent state; "New agent" opens the launcher modal.
            <ProjectAgentsBoard project={project} onNewAgent={() => setLauncherOpen(true)} embedded={!!layout} />
          )}
        </section>
        {layout && project && (
          <button
            type="button"
            className={`workspace-block-divider divider-${layout.direction}`}
            aria-label={`Resize ${layout.direction === 'horizontal' ? 'side-by-side' : 'stacked'} blocks`}
            onPointerDown={resizeBlocks}
            onKeyDown={nudgeBlocks}
          />
        )}
        {layout && project && (
          <section className="workspace-block workspace-block-secondary" aria-label="Secondary workspace block">
            <div className="workspace-block-heading">
              {secondaryIs('agents') ? 'Agents' : secondaryIs('terminals') ? 'Terminals' : secondaryIs('explorer') ? 'Explorer' : secondaryIs('library') ? 'Library' : secondaryIs('scheduler') ? 'Scheduler' : secondaryIs('feed') ? 'Feed' : secondaryModule?.projectTab?.label ?? secondaryModule?.title ?? 'Unavailable view'}
            </div>
            <div className="workspace-block-content">
              {secondaryIs('terminals') && <div className="workspace-terminal-secondary-note">Terminals are shown in the shared terminal block.</div>}
              {secondaryIs('agents') && <ProjectAgentsBoard project={project} onNewAgent={() => setLauncherOpen(true)} embedded />}
              {secondaryIs('explorer') && <div className="workspace-terminal-secondary-note">Explorer is available in the primary workspace block.</div>}
              {secondaryIs('library') && <Suspense fallback={<div className="workbench-status">Loading library...</div>}><LibraryView project={project} /></Suspense>}
              {secondaryIs('scheduler') && <Suspense fallback={<div className="workbench-status">Loading scheduler...</div>}><SchedulerPanel projectId={project.id} /></Suspense>}
              {secondaryIs('goals') && goalsEnabled && <Suspense fallback={<div className="workbench-status">Loading goals...</div>}><ProjectGoalsView project={project} /></Suspense>}
              {secondaryIs('followups') && followUpsEnabled && <Suspense fallback={<div className="workbench-status">Loading follow-ups...</div>}><ProjectFollowUpsView project={project} /></Suspense>}
              {secondaryIs('feed') && <Suspense fallback={<div className="workbench-status">Loading feed...</div>}><ProjectFeedView project={project} /></Suspense>}
              {secondaryModule && <div className="project-ext-tab"><ProjectExtensionTab moduleId={secondaryModule.id} project={project} /></div>}
              {!secondaryIs('terminals') && !secondaryIs('agents') && !secondaryIs('explorer') && !secondaryIs('library') && !secondaryIs('scheduler') && !secondaryIs('goals') && !secondaryIs('followups') && !secondaryIs('feed') && !secondaryModule && <div className="workspace-terminal-secondary-note">This view is no longer available. Choose another project view, or return to one block.</div>}
            </div>
          </section>
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
      {launcherOpen && project && (
        <AgentLauncher
          project={project}
          backgroundTabs={backgroundTabs}
          onClose={() => setLauncherOpen(false)}
        />
      )}
    </main>
  );
}
