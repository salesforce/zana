/**
 * Host wiring for the Command Center (companion rail). `host.ts` owns the
 * singletons; this module owns the small decisions made around them — the
 * opt-in gate, the Window-menu entry, minimize hand-off, menu-routing target —
 * and maps host primitives onto `CompanionDeps`, so all of it is unit-testable
 * without booting the app.
 */
import type { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';
import type { CompanionPlacement, IdleTriageResult } from '@zana-ai/zcc-domain/product';
import { CompanionController, type CompanionDeps } from './companion.js';

type CompanionHandle = {
  enter(): boolean;
  isActive(): boolean;
  resume(): void;
  hideBehindRail(win: BrowserWindow): void;
  ownsWindow(win: BrowserWindow | null | undefined): boolean;
};

export interface CompanionHostDeps {
  platform: NodeJS.Platform;
  /** The live opt-in flag (`AppConfig.companionEnabled`). */
  flag: () => boolean;
  companion: () => CompanionHandle | null;
  focusedWindow: () => BrowserWindow | null;
  mainWindow: () => BrowserWindow | null;
  applicationMenu: () => Menu | null;
  refreshTray: () => void;
}

export const COMPANION_MENU_ID = 'companion-enter';

export function createCompanionHost(deps: CompanionHostDeps) {
  /** macOS-only surface, and off unless the user opted in. */
  const enabled = () => deps.platform === 'darwin' && deps.flag();

  /** "Minimize to Command Center" — shows the rail; falls back to a plain minimize when off. */
  const enter = () => {
    if (deps.companion()?.enter()) return;
    const win = deps.focusedWindow() ?? deps.mainWindow();
    if (win && !win.isDestroyed()) win.minimize();
  };

  return {
    enabled,
    enter,

    /** Any return to an app window ends the floating companion mode. */
    onAppOpened(win?: BrowserWindow) {
      // Focus notifications can arrive after enter() has hidden the window.
      if (win && (win.isDestroyed() || !win.isVisible() || win.isMinimized())) return;
      const companion = deps.companion();
      if (companion?.isActive()) companion.resume();
    },

    /**
     * Show/hide the Window-menu entry to match the opt-in flag (no menu rebuild).
     * Disabled too: hidden menu items must not remain actionable.
     */
    syncMenu() {
      const item = deps.applicationMenu()?.getMenuItemById(COMPANION_MENU_ID);
      if (item) {
        item.visible = enabled();
        item.enabled = enabled();
      }
      deps.refreshTray();
    },

    /** The focused window for menu routing — never a companion rail/panel. */
    focusedAppWindow(): BrowserWindow | null {
      const focused = deps.focusedWindow();
      return focused && !deps.companion()?.ownsWindow(focused) ? focused : deps.mainWindow();
    },

    /**
     * An app window was minimized: hand off to the rail instead of the Dock.
     * With the rail already up, also hide the minimized window.
     */
    onWindowMinimized(win: BrowserWindow) {
      const companion = deps.companion();
      if (!enabled() || !companion) return;
      if (companion.isActive()) companion.hideBehindRail(win);
      else companion.enter();
    },

    /** The Window-menu item, built from the same gate `syncMenu` keeps in step. */
    menuItem(): MenuItemConstructorOptions {
      return {
        id: COMPANION_MENU_ID,
        label: 'Minimize to Command Center',
        // Standard Minimize (Cmd+M) already hands off through onWindowMinimized.
        // Shift+Cmd+M belongs to the renderer's maximize-pane shortcut.
        visible: enabled(),
        enabled: enabled(),
        acceleratorWorksWhenHidden: false,
        click: () => enter()
      };
    }
  };
}

type Project = { id: string; name: string; color?: string };
type OpenResult = { ok: boolean; reason?: string } | null | undefined;

/** Host primitives `companionControllerDeps` maps onto the controller's deps. */
export interface CompanionControllerHost
  extends Pick<
    CompanionDeps,
    | 'ptys'
    | 'scheduler'
    | 'agentStatus'
    | 'inboxStore'
    | 'listThreads'
    | 'theme'
    | 'isEnabled'
    | 'showMainWindow'
    | 'sendToApp'
    | 'preloadPath'
    | 'logger'
  > {
  store: {
    listProjects(): Project[];
    getConfig(): { companionPlacement?: CompanionPlacement };
    setConfig(patch: { companionPlacement: CompanionPlacement }): unknown;
  };
  /** Last idle-triage verdict per session (main's own cache). */
  triageCache: ReadonlyMap<string, IdleTriageResult>;
  /** The thread runtime, once booted — it owns the Modern thread change feed. */
  runtime: () => { onMenubarThreadsChanged(listener: () => void): () => void } | null | undefined;
  windows: ReadonlyMap<number, { win: BrowserWindow }>;
  ensureMainWindowReady: () => Promise<boolean>;
  openThread: (threadId: string, projectId: string) => Promise<OpenResult>;
  /** E2E keeps app windows hidden (never steal focus), as showMainWindow does. */
  e2e: boolean;
}

export function companionControllerDeps(host: CompanionControllerHost): CompanionDeps {
  const log = (context: string, err: unknown) => host.logger?.(context, err);
  const project = (id: string) => host.store.listProjects().find((p) => p.id === id);
  return {
    ptys: host.ptys,
    scheduler: host.scheduler,
    agentStatus: host.agentStatus,
    inboxStore: host.inboxStore,
    projectName: (id) => project(id)?.name ?? 'project',
    projectColor: (id) => project(id)?.color,
    triage: (sessionId) => host.triageCache.get(sessionId) ?? null,
    listThreads: host.listThreads,
    onThreadsChanged: (listener) => {
      const runtime = host.runtime();
      if (runtime) return runtime.onMenubarThreadsChanged(listener);
      // Bootstrap constructs the companion before the production runtime. In
      // dev it stays HTTP-backed. Poll only that gap; the controller ignores
      // hints while inactive and single-flights its bounded HTTP read.
      let off: (() => void) | undefined;
      const timer = setInterval(() => {
        const ready = host.runtime();
        if (ready) {
          off = ready.onMenubarThreadsChanged(listener);
          clearInterval(timer);
        }
        listener();
      }, 2000);
      return () => { clearInterval(timer); off?.(); };
    },
    openThread: (threadId, projectId) => {
      host.showMainWindow();
      void host
        .ensureMainWindowReady()
        .then((ready) => (ready ? host.openThread(threadId, projectId) : { ok: false, reason: 'main renderer did not become ready' }))
        .then((result) => {
          if (!result?.ok) log('companion open thread', result?.reason ?? 'thread unavailable');
        })
        .catch((err) => log('companion open thread', err));
    },
    theme: host.theme,
    isEnabled: host.isEnabled,
    getPlacement: () => host.store.getConfig().companionPlacement,
    savePlacement: (placement) => {
      host.store.setConfig({ companionPlacement: placement });
    },
    mainWindows: () => [...host.windows.values()].map(({ win }) => win),
    showMainWindow: host.showMainWindow,
    restoreWindows: (wins) => {
      if (host.e2e) return;
      for (const w of wins) {
        if (w.isDestroyed()) continue;
        if (w.isMinimized()) w.restore();
        w.showInactive();
      }
    },
    sendToApp: host.sendToApp,
    preloadPath: host.preloadPath,
    logger: host.logger
  };
}

/** macOS-only surface: elsewhere nothing is constructed or subscribed. */
export function createCompanionController(
  platform: NodeJS.Platform,
  host: CompanionControllerHost,
  make: (deps: CompanionDeps) => CompanionController = (deps) => new CompanionController(deps)
): CompanionController | null {
  return platform === 'darwin' ? make(companionControllerDeps(host)) : null;
}

/** Show a dialog as a sheet only on a visible window: one hidden behind the rail would hide it too. */
export function onVisibleParent<T>(parent: BrowserWindow | null, withParent: (win: BrowserWindow) => T, alone: () => T): T {
  return parent?.isVisible() ? withParent(parent) : alone();
}
