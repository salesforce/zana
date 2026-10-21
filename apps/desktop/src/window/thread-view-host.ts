import { IPC, type ThreadViewTarget } from '@zana-ai/zcc-desktop-contract';
import { pluginViewMenuRoute } from './plugin-view-windows.js';
import type { PluginViewHostWindow } from './plugin-view-host.js';
import { authorizeThreadView, listThreadViews, parseThreadViewTarget, sameThreadView } from './thread-view-windows.js';

export interface ThreadViewHostDeps<W extends PluginViewHostWindow> {
  /** Main's window registry. A thread view window carries its `threadView`. */
  windows: ReadonlyMap<number, { win: W; threadView?: ThreadViewTarget }>;
  projectIds(): Iterable<string>;
  /** Creates the window and registers it before returning. */
  createWindow(target: ThreadViewTarget): void;
  /** Sends a menu command on to the main window and brings it forward. */
  sendToMainWindow(channel: string, args: unknown[]): void;
  /** Sends to every window. */
  broadcast(channel: string, ...args: unknown[]): void;
  logError(context: string, err: unknown): void;
  /** E2E keeps windows hidden, so they never steal focus. */
  keepHidden: boolean;
}

export type ThreadViewHost = ReturnType<typeof createThreadViewHost>;

/**
 * Main's thread view windows: one window per thread, opened only after main
 * checked the target (Rule 1). Every other window shows a placeholder for a
 * thread that lives in one, so a single window runs its timeline and panel.
 */
export function createThreadViewHost<W extends PluginViewHostWindow>(deps: ThreadViewHostDeps<W>) {
  function list(): ThreadViewTarget[] {
    return listThreadViews([...deps.windows.values()].map(({ win, threadView }) => ({ threadView, live: !win.isDestroyed() })));
  }

  function find(target: ThreadViewTarget): W | null {
    for (const { win, threadView } of deps.windows.values()) {
      if (sameThreadView(threadView, target) && !win.isDestroyed()) return win;
    }
    return null;
  }

  return {
    list,

    broadcast(): void {
      deps.broadcast(IPC.windows.onThreadViewsChanged, list());
    },

    /** Open, or focus, the window that shows one thread. */
    open(input: unknown): boolean {
      const decision = authorizeThreadView(input, { projectIds: deps.projectIds() });
      if (!decision.ok) {
        deps.logError('openThreadViewWindow', `refused: ${decision.reason}`);
        return false;
      }
      const existing = find(decision.target);
      if (!existing) {
        deps.createWindow(decision.target);
        return true;
      }
      if (deps.keepHidden) return true;
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return true;
    },

    close(input: unknown): boolean {
      const target = parseThreadViewTarget(input);
      const win = target ? find(target) : null;
      if (!win) return false;
      win.close();
      return true;
    },

    /**
     * A menu command while a thread view window has focus. It has no tabs of
     * its own: Close Tab closes it, and the main window runs the rest. False
     * when `focused` is not a thread view window.
     */
    routeMenu(focused: W | null, channel: string, args: unknown[]): boolean {
      if (!focused || !deps.windows.get(focused.id)?.threadView) return false;
      if (pluginViewMenuRoute(channel) === 'close') focused.close();
      else deps.sendToMainWindow(channel, args);
      return true;
    }
  };
}
