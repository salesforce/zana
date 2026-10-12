import { IPC, type PluginViewTarget } from '@zana-ai/zcc-desktop-contract';
import {
  authorizePluginView,
  listPluginViews,
  parseMainWindowPath,
  parsePluginViewTarget,
  pluginViewMenuRoute,
  samePluginView,
  type PluginViewApp
} from './plugin-view-windows.js';

/** The part of a BrowserWindow that main's plugin view logic drives. */
export interface PluginViewHostWindow {
  readonly id: number;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  close(): void;
  readonly webContents: { isDestroyed(): boolean; send(channel: string, ...args: unknown[]): void };
}

export interface PluginViewHostDeps<W extends PluginViewHostWindow> {
  /** Main's window registry. A plugin view window carries its `view`. */
  windows: ReadonlyMap<number, { win: W; view?: PluginViewTarget }>;
  listApps(): Promise<readonly PluginViewApp[]>;
  projectIds(): Iterable<string>;
  /** Creates the window and registers it before returning. */
  createWindow(target: PluginViewTarget): void;
  ensureMainWindowReady(): Promise<boolean>;
  /** The unscoped main window. */
  mainWindow(): W | null;
  showMainWindow(): void;
  /** Sends to every window. */
  broadcast(channel: string, ...args: unknown[]): void;
  logError(context: string, err: unknown): void;
  /** E2E keeps windows hidden, so they never steal focus. */
  keepHidden: boolean;
}

export type PluginViewHost = ReturnType<typeof createPluginViewHost>;

/**
 * Main's plugin view windows: one window per project tab, opened only after
 * main checked the project and the plugin itself (Rule 1). The tab registry
 * lives in the renderer, which shows an empty state for a tab that is missing
 * or did not opt in with `detachable`.
 */
export function createPluginViewHost<W extends PluginViewHostWindow>(deps: PluginViewHostDeps<W>) {
  /** The plugin view windows open now, for `windows:listPluginViews`. */
  function list(): PluginViewTarget[] {
    return listPluginViews([...deps.windows.values()].map(({ win, view }) => ({ view, live: !win.isDestroyed() })));
  }

  function find(target: PluginViewTarget): W | null {
    for (const { win, view } of deps.windows.values()) {
      if (samePluginView(view, target) && !win.isDestroyed()) return win;
    }
    return null;
  }

  function bringForward(win: W): void {
    if (deps.keepHidden) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /** Runs `send` on the main window, then brings it forward. False when it is not there. */
  async function onMainWindow(context: string, send: (win: W) => void): Promise<boolean> {
    if (!(await deps.ensureMainWindowReady())) return false;
    const win = deps.mainWindow();
    if (!win || win.webContents.isDestroyed()) return false;
    try {
      send(win);
    } catch (err) {
      deps.logError(context, err);
      return false;
    }
    deps.showMainWindow();
    return true;
  }

  return {
    list,

    /** Every window shows a placeholder for a tab that lives in a view window. */
    broadcast(): void {
      deps.broadcast(IPC.windows.onPluginViewsChanged, list());
    },

    /** Open, or focus, the window that shows one plugin project tab. */
    async open(input: unknown): Promise<boolean> {
      const apps = await deps.listApps();
      const decision = authorizePluginView(input, { projectIds: deps.projectIds(), apps });
      if (!decision.ok) {
        deps.logError('openPluginViewWindow', `refused: ${decision.reason}`);
        return false;
      }
      // Checked after the await, and createWindow registers synchronously, so two
      // overlapping requests still open one window.
      const existing = find(decision.target);
      if (existing) bringForward(existing);
      else deps.createWindow(decision.target);
      return true;
    },

    close(input: unknown): boolean {
      const target = parsePluginViewTarget(input);
      const win = target ? find(target) : null;
      if (!win) return false;
      win.close();
      return true;
    },

    /**
     * Route the main window to a relative in-app path and bring it forward. A
     * plugin view window has no shell of its own, so its links land here.
     */
    async showPath(input: unknown): Promise<boolean> {
      const path = parseMainWindowPath(input);
      if (!path) return false;
      return onMainWindow('showPathInMainWindow', (win) => win.webContents.send(IPC.windows.onNavigate, path));
    },

    /**
     * A menu command while a plugin view window has focus. It has no tabs,
     * palette or settings of its own: Close Tab closes it, and the main window
     * runs the rest. False when `focused` is not a plugin view window.
     */
    routeMenu(focused: W | null, channel: string, args: unknown[]): boolean {
      if (!focused || !deps.windows.get(focused.id)?.view) return false;
      if (pluginViewMenuRoute(channel) === 'close') focused.close();
      else void onMainWindow(`sendToMainWindow ${channel}`, (win) => win.webContents.send(channel, ...args));
      return true;
    }
  };
}
