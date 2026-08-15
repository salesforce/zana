import { useEffect, useState, lazy, Suspense } from 'react';
import { Bell, Star } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ListPane } from './components/ListPane';
import { Workspace } from './components/Workspace';
import { TerminalSurface } from './components/TerminalSurface';
import { GlobalAgentsBoard } from './components/GlobalAgentsBoard';
import { ProjectScopedNav } from './components/ProjectScopedNav';
import { SettingsPanel } from './components/SettingsPanel';
import { SchedulerPanel } from './components/SchedulerPanel';
import { PersonasPanel } from './components/PersonasPanel';
import { SquadsPanel } from './components/SquadsPanel';
import { ExtensionsPanel } from './components/ExtensionsPanel';
import { UsagePanel } from './components/UsagePanel';
import { InboxView } from './components/InboxView';
import { HomePanel } from './components/HomePanel';
import { FollowUpsPanel } from './components/FollowUpsPanel';
import { SuggestionsView } from './components/SuggestionsView';
import { CommandPalette } from './components/CommandPalette';
import { QuickOpen } from './components/QuickOpen';
import { ResumePicker } from './components/ResumePicker';
import { SearchPanel } from './components/SearchPanel';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { AgentTerminalModal } from './components/AgentTerminalModal';
import { FavoriteAgentsDrawer } from './components/FavoriteAgentsDrawer';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { Walkthrough } from './components/Walkthrough';
import { SetupChecklistHost } from './components/SetupChecklist';
import { Toaster } from './components/Toaster';
import { PendingLaunches } from './components/PendingLaunches';
import { HostDialogs } from './components/HostDialogs';
import { nextHostDialogId as hostDialogId } from './modules/host';
import { UpdateBanner } from './components/UpdateBanner';
import { WhatsNewModal } from './components/WhatsNewModal';
import { StatusBar } from './components/StatusBar';
import { ExtensionConsent } from './components/ExtensionConsent';
import { ModulePanelHost } from './modules/ModulePanelHost';
import { ModuleBackgroundHost } from './modules/ModuleBackgroundHost';
import { useMergedModules } from './modules';
import { initExtensionModules, reconcileExtensionModules } from './modules/loader';
import {
  CORE_NAV_IDS,
  scheduleGitRefresh,
  useData,
  useUi,
  usePersonas,
  useAgentStatus,
  useUnreadInboxCount,
  useInbox,
  useInboxRead,
  useUpdates,
  useUpdateBanner,
  isUpdateBannerVisible,
  visibleTerminals,
  installInboxCrossWindowSync,
  useFavoriteAgents,
  type PendingLaunch
} from './store';
import { useFavoriteCount } from './util/useAgentCards';
import { focusInboxEntry } from './util/inboxNavigation';
import { projectDefaultLaunch } from './util/launchProfile';
import { getScopedProjectId } from './util/windowScope';
import { shouldHideListPane } from './util/agentsLayout';
import { installShortcuts } from './shortcuts';

// Lazy-load: LibraryPanel's doc preview pulls in monaco-editor, which registers
// default editor extensions into a global `RegistryImpl` singleton, so it's
// kept out of the initial bundle — same reasoning as ExplorerView/LibraryView
// in Workspace.tsx.
const LibraryPanel = lazy(() =>
  import('./components/LibraryPanel').then((m) => ({ default: m.LibraryPanel }))
);

export function App() {
  const init = useData((s) => s.init);
  const nav = useUi((s) => s.nav);
  const agentsBoardView = useUi((s) => s.agentsBoardView);
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const suggestionsEnabled = useData((s) => s.suggestionsEnabled);
  useEffect(() => {
    if (nav === 'suggestions' && !suggestionsEnabled) useUi.getState().setNav('projects');
  }, [nav, suggestionsEnabled]);
  const unreadInbox = useUnreadInboxCount();
  const favoritesOpen = useUi((s) => s.favoritesDrawerOpen);
  const notificationsOpen = useUi((s) => s.notificationsDrawerOpen);
  // Count only LIVE followed agents — the same intersection the drawer renders —
  // so the badge can't say "3" while the drawer shows "0" after a relaunch
  // (favorites key on the stable claudeSessionId; a stale star with no live
  // agent isn't shown OR counted).
  const favoriteCount = useFavoriteCount();
  // Whether the update banner is showing — adds a grid row to the shell so the
  // full-width banner sits below the titlebar without overlap. Uses the SAME
  // shared predicate as the banner's own render gate so the two can't diverge.
  const updateKind = useUpdates((s) => s.status.kind);
  const updateDismissed = useUpdateBanner((s) => s.dismissed);
  const updateBannerVisible = isUpdateBannerVisible(updateKind, updateDismissed);
  const modules = useMergedModules();
  // Dangling-nav guard: if `nav` points at an app-module id that is no longer
  // loaded (extension disabled / uninstalled / crash-dropped from the merged
  // registry) while its panel was focused, ModulePanelHost renders null and no
  // core panel matches — the content area goes blank with no way back except
  // the sidebar. Bounce home whenever `nav` is neither a core id nor a live
  // module id. (Core ids like 'goals' are project-scoped workspace modes, not
  // top-level panels, but are still valid nav and must NOT bounce. 'followups'
  // is BOTH — a project-scoped mode AND now a top-level panel, above.)
  useEffect(() => {
    if (CORE_NAV_IDS.has(nav as never)) return;
    if (modules.some((m) => m.id === nav)) return;
    useUi.getState().setNav('projects');
  }, [nav, modules]);
  // App version shown next to the "beta" tag in the titlebar.
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => {
    window.cc.app.version().then(setAppVersion).catch(() => {});
  }, []);
  // In a per-project window, the project this window is locked to (else null).
  // Drives scoped rendering of the Agents board (and is the anchor the other
  // panels filter against via getScopedProjectId).
  const scopedProjectId = getScopedProjectId();
  const scopedProject = scopedProjectId
    ? projects.find((p) => p.id === scopedProjectId) ?? null
    : null;

  // Main window drilled into a project (focus mode). Distinct from a scoped
  // WINDOW: focus is a soft, store-driven state the user enters/leaves with the
  // back button. Only meaningful when this isn't already a scoped window (that
  // rail wins). Drives the 'focus'-variant ProjectScopedNav below.
  const focusedProject =
    !scopedProject && focusedProjectId
      ? projects.find((p) => p.id === focusedProjectId) ?? null
      : null;

  // Reflect the current project + active tab into the OS window title so
  // ⌘-Tab / Mission Control disambiguates Zana across projects.
  useEffect(() => {
    const base = import.meta.env.DEV ? 'Zana [DEV]' : 'Zana';
    const inboxBadge = unreadInbox > 0 && nav !== 'inbox' ? `(${unreadInbox}) ` : '';
    // A per-project window always leads with its project so the OS window
    // chrome / ⌘-Tab tells you which project it is, whatever sub-view is open.
    if (scopedProject) {
      const tabs = visibleTerminals(terminals[scopedProject.id]);
      const active = tabs.find((t) => t.id === selectedTabId[scopedProject.id]);
      const view = nav === 'inbox' ? 'Inbox' : active?.title;
      document.title = `${inboxBadge}${scopedProject.name}${view ? ` · ${view}` : ''} — ${base}`;
      return;
    }
    if (nav === 'settings') {
      document.title = `${inboxBadge}Settings · ${base}`;
      return;
    }
    if (nav === 'inbox') {
      document.title = `Inbox · ${base}`;
      return;
    }
    if (nav === 'scheduler') {
      document.title = `${inboxBadge}Scheduler · ${base}`;
      return;
    }
    if (nav === 'personas') {
      document.title = `${inboxBadge}Personas · ${base}`;
      return;
    }
    if (nav === 'squads') {
      document.title = `${inboxBadge}Squads · ${base}`;
      return;
    }
    if (nav === 'usage') {
      document.title = `${inboxBadge}Usage · ${base}`;
      return;
    }
    if (nav === 'extensions') {
      document.title = `${inboxBadge}Extensions · ${base}`;
      return;
    }
    if (nav === 'library') {
      document.title = `${inboxBadge}Library · ${base}`;
      return;
    }
    const activeModule = modules.find((m) => m.id === nav);
    if (activeModule) {
      document.title = `${inboxBadge}${activeModule.titleLabel ?? activeModule.title} · ${base}`;
      return;
    }
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project) {
      document.title = `${inboxBadge}${base}`;
      return;
    }
    const tabs = visibleTerminals(terminals[project.id]);
    const activeId = selectedTabId[project.id];
    const active = tabs.find((t) => t.id === activeId);
    document.title = active
      ? `${inboxBadge}${active.title} · ${project.name} — ${base}`
      : `${inboxBadge}${project.name} — ${base}`;
  }, [nav, selectedProjectId, selectedTabId, projects, terminals, unreadInbox, modules, scopedProject]);

  // Tell main which session is the foreground/active tab so auto-close-idle can
  // spare it. Advisory only (main can never authorize a close off this) — so a
  // simple derivation is fine: the active project's currently-selected tab, or
  // null when the user is on a non-terminal view (Inbox/Settings/etc.). Emitted
  // on every change; fire-and-forget.
  useEffect(() => {
    const activeProjectId = scopedProject?.id ?? selectedProjectId;
    // Only a project's terminal views put a specific session in the foreground;
     // on Inbox/Scheduler/etc. no agent tab is "being viewed", so clear it.
    const viewingTerminals = nav === 'agents' || nav === 'projects';
    const activeSessionId =
      viewingTerminals && activeProjectId ? selectedTabId[activeProjectId] ?? null : null;
    window.cc.terminals.setActiveSession(activeSessionId).catch(() => {});
  }, [nav, scopedProject, selectedProjectId, selectedTabId]);

  // Tell main which agents the user has starred so auto-close-idle can spare
  // them (a pinned agent is never reclaimed by the idle timer — only an explicit
  // close may). Advisory only, so a plain report of the persisted key set is
  // enough; every window mirrors the same set (cross-window synced), so
  // last-write-wins on main is idempotent. Fire-and-forget on every change.
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
  useEffect(() => {
    window.cc.terminals.setFavorites(Object.keys(favoriteIds)).catch(() => {});
  }, [favoriteIds]);

  // The menu-bar popover can toggle a pin (favorite) from main. Reflect main's
  // resulting key set back into the persisted star set so the sidebar star and
  // the popover pin stay one concept. Guard against a redundant write (same set)
  // to avoid a ping-pong with the report effect above.
  useEffect(() => {
    return window.cc.app.onFavoritesChanged((keys) => {
      const current = useFavoriteAgents.getState().favoriteIds;
      const next: Record<string, true> = {};
      for (const k of keys) next[k] = true;
      const currentKeys = Object.keys(current);
      const same =
        currentKeys.length === keys.length && keys.every((k) => current[k]);
      if (!same) useFavoriteAgents.setState({ favoriteIds: next });
    });
  }, []);

  // Discover + load runtime extension panels at startup, then re-reconcile on
  // every `extensions:onChanged` push (enable/disable/install/remove). The
  // loaded set lands in the extension-modules store, which feeds the merged
  // module set the shell renders from. Renderer-only / already-loaded
  // extensions reconcile live; enabling a not-yet-loaded main side still needs
  // a relaunch (per P1-B), and that relaunch re-runs this init.
  useEffect(() => {
    let cancelled = false;
    // initExtensionModules() may async-update the extension store; guard it so
    // an unmount mid-init doesn't trigger state writes on a stale component.
    void initExtensionModules().then(() => {
      if (cancelled) return;
      // initExtensionModules itself writes to the extension-modules store, which
      // is fine (it's a separate store); this guard just prevents any follow-on
      // work (like reconciliation callbacks) from firing after unmount.
    });
    const off = window.cc.extensions.onChanged((entries) => {
      // Reconciliation is an external store write (extension-modules store), so
      // it's safe even if this component unmounts — but guard the call itself to
      // avoid invoking a stale closure if the component remounts quickly.
      if (!cancelled) void reconcileExtensionModules(entries);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    init();
    const offShortcuts = installShortcuts();
    // Keep inbox read/answered/saved/kept state live across windows: these are
    // localStorage-backed and shared by every window, but only read at boot —
    // this re-hydrates them when another window writes (e.g. a per-project
    // window marks an entry read, the main window reflects it immediately).
    const offInboxSync = installInboxCrossWindowSync();
    const offData = window.cc.terminals.onData((id) => {
      const ui = useUi.getState();
      const data = useData.getState();
      // find which project owns this session
      let owningProjectId: string | null = null;
      for (const pid of Object.keys(data.terminals)) {
        if (data.terminals[pid].some((t) => t.id === id)) {
          owningProjectId = pid;
          break;
        }
      }
      if (!owningProjectId) return;
      // `onData` fans out to every window. A scoped project window only shows
      // its one project, so it ignores other projects' output — otherwise each
      // open window would fire a redundant `git status` spawn per burst.
      const scoped = getScopedProjectId();
      if (scoped && owningProjectId !== scoped) return;
      const isActive =
        ui.selectedProjectId === owningProjectId &&
        ui.selectedTabId[owningProjectId] === id;
      if (!isActive) ui.markUnread(id);
      // Coalesce bursts of terminal output into a single git status refresh
      // so commits/pulls/branch swaps inside a tab show up promptly.
      scheduleGitRefresh(owningProjectId);
    });
    const onFocus = () => {
      useData.getState().refreshAllGitStatus();
    };
    window.addEventListener('focus', onFocus);
    // Bridge native menu items (File / View / Help submenus) back to the
    // same store actions the in-renderer keyboard shortcuts use.
    const offMenu = window.cc.app.onMenuEvent((event) => {
      const ui = useUi.getState();
      const data = useData.getState();
      const projectId = ui.selectedProjectId;
      switch (event) {
        case 'app:openSettings':
          ui.setNav(ui.nav === 'settings' ? 'projects' : 'settings');
          return;
        case 'app:toggleInbox':
          ui.setNav(ui.nav === 'inbox' ? 'projects' : 'inbox');
          return;
        case 'app:openPalette':
          ui.setPaletteOpen(true);
          return;
        case 'app:openShortcuts':
          ui.setShortcutsOpen(!ui.shortcutsOpen);
          return;
        case 'app:toggleWorkspaceMode':
          if (projectId) ui.toggleWorkspaceMode(projectId);
          return;
        case 'app:newClaudeTab':
          if (projectId) {
            const project = data.projects.find((p) => p.id === projectId);
            // One-click default: the project's pinned persona (on its
            // baseProfile) or the profile default. Shared resolver so the menu,
            // the "+" button, and ⌘T all agree.
            const launch = project
              ? projectDefaultLaunch(project, usePersonas.getState().personas)
              : { profile: 'claude' as const };
            data.createTerminal(projectId, launch.profile, 80, 24, {
              personaId: launch.personaId
            }).then((s) => {
              if (s) ui.selectTab(projectId, s.id);
            });
          }
          return;
        case 'app:reopenTab':
          if (projectId) {
            // Mirror ⌘⇧T: resume the newest detached session first, else
            // reopen the last closed tab.
            data.restoreLastDetached(projectId).then((restored) => {
              if (restored) return;
              data.reopenLastClosed(projectId).then((s) => {
                if (s) ui.selectTab(projectId, s.id);
              });
            });
          }
          return;
        case 'app:closeTab': {
          if (!projectId) return;
          const activeId = ui.selectedTabId[projectId];
          if (!activeId) return;
          const tab = (data.terminals[projectId] ?? []).find((t) => t.id === activeId);
          if (tab?.pinned) return;
          // ⌘W hides the active tab (does NOT kill the process): a live session
          // detaches to the background, an exited tombstone is dismissed.
          // Terminating is only via the tab's right-click → Delete. ⌘⇧T reopens.
          if (tab && tab.status !== 'exited') {
            data.hideTerminal(activeId, projectId);
          } else {
            data.closeTerminal(activeId, projectId);
          }
          return;
        }
      }
    });
    const offFocusSession = window.cc.app.onFocusSession((sessionId, projectId) => {
      const ui = useUi.getState();
      ui.setNav('projects');
      ui.selectProject(projectId);
      // restoreTerminal un-hides a headless session (e.g. a scheduled run)
      // AND selects it. selectTab alone silently no-ops for a headless id, so
      // the tray "focus session" click would otherwise focus nothing. Safe for
      // already-visible sessions too.
      void useData.getState().restoreTerminal(sessionId, projectId);
      // Also pop the agent-inspector modal — a menu-bar "Open in workspace" click
      // lands the user on the live terminal peek + status/actions right away,
      // rather than just switching tabs behind the still-open popover.
      ui.openAgentModal(sessionId, projectId);
    });
    // Tray "Open Scheduler" / per-schedule "Show in Scheduler". With a task id
    // we jump to that schedule's scope and reveal the row; without one we land
    // on the overview (matching the plain menu item).
    const offOpenScheduler = window.cc.app.onOpenScheduler((taskId) => {
      const ui = useUi.getState();
      if (taskId) ui.revealSchedule(taskId);
      else ui.setNav('scheduler');
    });
    // Menu-bar popover footer "Agents" — land on the global Agents board.
    const offOpenAgents = window.cc.app.onOpenAgents(() => {
      useUi.getState().setNav('agents');
    });
    // A native loud-tier notification was clicked (Phase D) — resolve the
    // click destination via the shared resolver (default: the SPECIFIC Inbox
    // entry, not just the overview; an extension-targeted entry may redirect
    // elsewhere — see inboxNavigation.ts). Main only sends the id pair, so look
    // the full entry up from the already-loaded inbox store; if it's not
    // loaded yet (e.g. a fresh window), fall back to the plain project+nav
    // landing rather than dropping the click.
    const offFocusInboxEntry = window.cc.app.onFocusInboxEntry((entryId, projectId) => {
      const entry = useInbox.getState().entries.find((e) => e.id === entryId);
      if (entry) {
        focusInboxEntry(entry);
        return;
      }
      const ui = useUi.getState();
      ui.selectProject(projectId);
      ui.setNav('inbox');
      useInboxRead.getState().markRead(entryId);
    });
    return () => {
      offShortcuts();
      offData();
      offMenu();
      offFocusSession();
      offOpenScheduler();
      offOpenAgents();
      offFocusInboxEntry();
      offInboxSync();
      window.removeEventListener('focus', onFocus);
    };
  }, [init]);

  // W1-4 trust inversion: react to shell commands a MAIN extension module issued
  // via `ctx.host.*`. toast/navigate/selectProject are ephemeral and applied
  // immediately; a `launch` (built-in immediate) or `launchParked` (durable
  // queue) routes into the pendingLaunches confirm surface. We DRAIN main's
  // durable park queue on mount AND on each launchParked nudge, so a launch
  // requested while this listener wasn't attached is picked up on the next
  // attach — never dropped (the orchestrator's fail-closed fold-in).
  useEffect(() => {
    const drainParked = () => {
      void window.cc.modules
        .drainParkedLaunches()
        .then((parked) => useUi.getState().addPendingLaunches(parked))
        .catch(() => {});
    };
    const off = window.cc.modules.onHostCommand((cmd) => {
      const p = (cmd.payload ?? {}) as Record<string, unknown>;
      switch (cmd.kind) {
        case 'toast':
          useUi
            .getState()
            .pushToast(String(p.message ?? ''), p.kind === 'error' ? 'error' : 'info');
          return;
        case 'navigate':
          if (typeof p.target === 'string' && p.target) useUi.getState().setNav(p.target);
          return;
        case 'selectProject':
          useUi.getState().selectProject((p.projectId as string | null) ?? null);
          return;
        case 'launch':
          // Built-in immediate: still surfaced for confirm (main never spawns).
          if (p.requestId && p.spec) {
            useUi.getState().addPendingLaunches([
              {
                requestId: String(p.requestId),
                moduleId: cmd.moduleId,
                spec: p.spec as PendingLaunch['spec'],
                parkedAt: new Date().toISOString()
              }
            ]);
          }
          return;
        case 'launchParked':
          // Durable: pull the full queue (this nudge only signals "something's
          // waiting"; the spec lives in main until drained).
          drainParked();
          return;
        case 'confirm': {
          // W1-5 main-reachable confirm. Render the SAME host dialog as a
          // renderer host.confirm and reply the human's answer back to main so
          // the requesting main module's Promise resolves.
          const requestId = p.requestId ? String(p.requestId) : '';
          const spec = (p.spec ?? {}) as Record<string, unknown>;
          if (!requestId) return;
          useUi.getState().pushHostDialog({
            id: hostDialogId(),
            moduleId: cmd.moduleId,
            kind: 'confirm',
            opts: {
              title: String(spec.title ?? ''),
              body: spec.body as string | undefined,
              confirmLabel: spec.confirmLabel as string | undefined,
              cancelLabel: spec.cancelLabel as string | undefined,
              danger: !!spec.danger
            },
            resolve: (answer) => void window.cc.modules.replyHostDialog(requestId, answer)
          });
          return;
        }
        case 'alert': {
          // W1-5 main-reachable alert. Reply the picked action id (or null).
          const requestId = p.requestId ? String(p.requestId) : '';
          const spec = (p.spec ?? {}) as Record<string, unknown>;
          if (!requestId) return;
          useUi.getState().pushHostDialog({
            id: hostDialogId(),
            moduleId: cmd.moduleId,
            kind: 'alert',
            opts: {
              title: String(spec.title ?? ''),
              body: spec.body as string | undefined,
              kind: spec.kind === 'error' ? 'error' : 'info',
              actions: Array.isArray(spec.actions)
                ? (spec.actions as Array<{ id: string; label: string }>).map((a) => ({
                    id: String(a.id),
                    label: String(a.label)
                  }))
                : undefined
            },
            resolve: (answer) => void window.cc.modules.replyHostDialog(requestId, answer)
          });
          return;
        }
      }
    });
    // Catch anything parked before this listener attached.
    drainParked();
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In a project's workspace modes (terminals/explorer/…), column 2 (the
  // ListPane session list) is redundant with the Workspace's own tab bar, so we
  // drop it and reclaim its column. This applies both to a per-project WINDOW
  // (scopedProject) and to the MAIN WINDOW drilled into a project (focusedProject)
  // — the project rail + tab bar already cover navigation, so the middle session
  // list is just noise. The global Agents List view also owns its agent list, so
  // its monitor expands into column 2 instead of repeating the quick-agent list.
  // The Inbox view still needs column 2 (its entry list lives there), so keep it
  // when nav==='inbox'.
  const hideListPane = shouldHideListPane(
    nav,
    agentsBoardView,
    !!scopedProject || !!focusedProject
  );

  return (
    <div
      className={`app-shell has-statusbar nav-${nav} ${hideListPane ? 'scoped-no-list' : ''} ${
        updateBannerVisible ? 'has-update-banner' : ''
      }`}
    >
      <div className="titlebar">
        <span className="titlebar-title">
          Zana
          <span className="titlebar-beta">beta</span>
          {import.meta.env.DEV && <span className="titlebar-version">DEV</span>}
          {appVersion && <span className="titlebar-version">v{appVersion}</span>}
        </span>
        <button
          type="button"
          className={`titlebar-fav ${favoriteCount > 0 ? 'has-favs' : ''} ${favoritesOpen ? 'active' : ''}`}
          onClick={() => useUi.getState().toggleFavoritesDrawer()}
          aria-pressed={favoritesOpen}
          aria-label={favoriteCount > 0 ? `Followed agents — ${favoriteCount}` : 'Followed agents'}
          title={favoriteCount > 0 ? `Followed agents — ${favoriteCount}` : 'Followed agents'}
        >
          <Star size={15} fill={favoritesOpen ? 'currentColor' : 'none'} />
          {favoriteCount > 0 && (
            <span className="titlebar-fav-badge" aria-hidden="true">
              {favoriteCount > 99 ? '99+' : favoriteCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`titlebar-bell ${unreadInbox > 0 ? 'has-unread' : ''} ${notificationsOpen ? 'active' : ''}`}
          onClick={() => useUi.getState().toggleNotificationsDrawer()}
          aria-pressed={notificationsOpen}
          aria-label={unreadInbox > 0 ? `Notifications — ${unreadInbox} unread` : 'Notifications'}
          title={unreadInbox > 0 ? `Notifications — ${unreadInbox} unread` : 'Notifications'}
        >
          <Bell size={15} fill={notificationsOpen ? 'currentColor' : 'none'} />
          {unreadInbox > 0 && (
            <span className="titlebar-bell-badge" aria-hidden="true">
              {unreadInbox > 99 ? '99+' : unreadInbox}
            </span>
          )}
        </button>
      </div>
      {/* Full-width update banner, in its own grid row below the titlebar (the
          `has-update-banner` class above adds that row). Renders null when no
          newer release / dismissed, so it costs nothing when up to date. */}
      <UpdateBanner />
      {/* Left rail. Three cases, same purpose-built ProjectScopedNav for the
          first two (Filtered Inbox + workspace modes promoted to rail entries):
          - per-project window  → 'window' variant (hard URL-locked, no back)
          - main window, drilled into a project → 'focus' variant (back button +
            slim global footer so nothing is trapped)
          - main window, project home → the full cross-project Sidebar */}
      {scopedProject ? (
        <ProjectScopedNav project={scopedProject} variant="window" />
      ) : focusedProject ? (
        <ProjectScopedNav
          project={focusedProject}
          variant="focus"
          onBack={() => {
            const ui = useUi.getState();
            ui.exitProjectFocus();
            ui.selectProject(null);
          }}
        />
      ) : (
        <Sidebar />
      )}
      {!hideListPane && <ListPane />}
      {/* Column 3 under Projects: the opened project's Workspace when a project
          is focused, else the cross-project Agents board (the default home).
          Workspace stays mounted (just hidden) so its TerminalSurface anchor is
          available the instant a project is opened. */}
      <div
        className={`main-slot ${nav === 'projects' && focusedProjectId ? 'show' : 'hide'}`}
      >
        <Workspace />
      </div>
      {/* The single source of truth for live terminals. Mounted once, for every
          nav, so its xterm instances (and scrollback) are never disposed; it
          portals its grid into the Workspace's column-3 anchor under 'projects',
          and parks in its own hidden host node otherwise. Must stay OUTSIDE the
          conditionally-rendered views above so it isn't unmounted on nav change. */}
      <TerminalSurface />
      {/* The cross-project Agents Kanban owns column 3 both on the Projects home
          (no project focused) AND under the dedicated Agents nav — same board,
          same lanes. Clicking a card graduates that agent into Projects. In a
          per-project window the Agents view is reached via the scoped rail's
          Agents item, which sets workspaceMode='agents' so the Workspace renders
          its own per-project ProjectAgentsBoard — this global board stays for the
          main window only. */}
      {((nav === 'projects' && !focusedProjectId) || nav === 'agents') && <GlobalAgentsBoard />}
      {nav === 'home' && <HomePanel />}
      {nav === 'followups' && <FollowUpsPanel />}
      {nav === 'inbox' && <InboxView />}
      {nav === 'suggestions' && suggestionsEnabled && <SuggestionsView />}
      {nav === 'scheduler' && <SchedulerPanel />}
      {nav === 'personas' && <PersonasPanel />}
      {nav === 'squads' && <SquadsPanel />}
      {nav === 'usage' && <UsagePanel />}
      {nav === 'extensions' && <ExtensionsPanel />}
      {nav === 'library' && (
        <Suspense fallback={<div className="workbench-status">Loading library…</div>}>
          <LibraryPanel />
        </Suspense>
      )}
      {nav === 'settings' && <SettingsPanel />}
      <ModulePanelHost />
      {/* Headless, always-mounted module backgrounds. Runtime activation results
          retain valid background components, which mount here outside nav-conditional
          views so long-lived work keeps running when a panel is not selected. */}
      <ModuleBackgroundHost />
      <CommandPaletteHost />
      <QuickOpenHost />
      <ResumePickerHost />
      <SearchPanelHost />
      <ShortcutsHelpHost />
      <AgentModalHost />
      <FavoriteAgentsDrawer />
      <NotificationsDrawer />
      <WalkthroughHost />
      <SetupChecklistHost />
      <WhatsNewModal />
      <PendingLaunches />
      <HostDialogs />
      <Toaster />
      <ExtensionConsent />
      {/* Always-on status strip pinned to the bottom row of the shell grid
          (see `.app-shell.has-statusbar`). Spans all columns. */}
      <StatusBar />
    </div>
  );
}

function CommandPaletteHost() {
  const open = useUi((s) => s.paletteOpen);
  const close = () => useUi.getState().setPaletteOpen(false);
  if (!open) return null;
  return <CommandPalette onClose={close} />;
}

function QuickOpenHost() {
  const open = useUi((s) => s.quickOpenOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const close = () => useUi.getState().setQuickOpenOpen(false);
  if (!open) return null;
  const project = projects.find((p) => p.id === selectedProjectId);
  if (!project) return null;
  return <QuickOpen project={project} onClose={close} />;
}

function ResumePickerHost() {
  const open = useUi((s) => s.resumeOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const close = () => useUi.getState().setResumeOpen(false);
  if (!open) return null;
  const project = projects.find((p) => p.id === selectedProjectId);
  if (!project) return null;
  return <ResumePicker project={project} onClose={close} />;
}

function SearchPanelHost() {
  const open = useUi((s) => s.searchOpen);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const close = () => useUi.getState().setSearchOpen(false);
  if (!open) return null;
  const project = projects.find((p) => p.id === selectedProjectId);
  if (!project) return null;
  return <SearchPanel project={project} onClose={close} />;
}

function WalkthroughHost() {
  const open = useUi((s) => s.walkthroughOpen);
  // Closing the walkthrough (finished OR skipped) marks it done so it never
  // auto-opens again. Persisted to AppConfig; failure is non-fatal — at worst
  // it shows once more next launch.
  const close = () => {
    useUi.getState().setWalkthroughOpen(false);
    window.cc.config.set({ walkthroughCompleted: true }).catch(() => {});
  };
  if (!open) return null;
  return <Walkthrough onClose={close} />;
}

function ShortcutsHelpHost() {
  const open = useUi((s) => s.shortcutsOpen);
  const close = () => useUi.getState().setShortcutsOpen(false);
  if (!open) return null;
  return <ShortcutsHelp onClose={close} />;
}

function AgentModalHost() {
  const agentModal = useUi((s) => s.agentModal);
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const state = useAgentStatus((s) => (agentModal ? s.byId[agentModal.sessionId] : undefined));
  const close = () => useUi.getState().closeAgentModal();
  if (!agentModal) return null;
  const session = (terminals[agentModal.projectId] ?? []).find(
    (t) => t.id === agentModal.sessionId
  );
  // The session can vanish while the modal is open (process terminated and the
  // tombstone dismissed). Drop the modal rather than render an empty shell.
  if (!session) return null;
  const project = projects.find((p) => p.id === agentModal.projectId);
  return (
    <AgentTerminalModal
      session={session}
      projectId={agentModal.projectId}
      projectName={project?.name ?? 'Unknown'}
      projectColor={project?.color}
      projectRemote={!!project?.remote}
      state={state ?? 'unknown'}
      onClose={close}
    />
  );
}
