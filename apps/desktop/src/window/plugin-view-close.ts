import { randomUUID } from 'node:crypto';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import type { BrowserWindow } from 'electron';

export const PLUGIN_VIEW_CLOSE_TIMEOUT_MS = 15_000;
interface CloseWindow {
  id: number;
  isDestroyed(): boolean;
  close(): void;
  webContents: { isDestroyed(): boolean; send(channel: string, value: unknown): void };
}

/** Attach native lifecycle invalidation to the same guard used by sender-bound IPC. */
export function bindPluginViewCloseLifecycle(win: BrowserWindow, guard: ReturnType<typeof createPluginViewCloseGuard>, shuttingDown: () => boolean): void {
  win.on('close', event => { if (!shuttingDown() && guard.intercept(win)) event.preventDefault(); });
  win.webContents.on('render-process-gone', () => guard.forget(win.id));
  win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) guard.forget(win.id);
  });
}

type SafeWindowHandle = <TArgs extends unknown[], TResult>(
  channel: string,
  handler: (win: BrowserWindow, ...args: TArgs) => TResult | Promise<TResult>,
  onError: (err: unknown, ...args: TArgs) => TResult
) => void;

/** The host supplies actual sender windows; only registered plugin views may participate. */
export function registerPluginViewCloseIpc(handle: SafeWindowHandle, guard: ReturnType<typeof createPluginViewCloseGuard>, windows: ReadonlyMap<number, { view?: unknown }>): void {
  handle<[unknown], boolean>(IPC.windows.pluginViewCloseReady, (win, value) => windows.get(win.id)?.view ? guard.setReady(win, value) : false, () => false);
  handle<[unknown, unknown], boolean>(IPC.windows.pluginViewCloseComplete, (win, id, result) => windows.get(win.id)?.view ? guard.complete(win, id, result) : false, () => false);
}
/** Native close remains pending until the owning renderer confirms durable handoff. No resource grants occur here. */
export function createPluginViewCloseGuard(timeoutMs = PLUGIN_VIEW_CLOSE_TIMEOUT_MS) {
  const ready = new Map<number, CloseWindow>();
  const pending = new Map<number, { id: string; timer: ReturnType<typeof setTimeout> }>();
  const approved = new Set<number>();
  const clear = (id: number) => {
    const request = pending.get(id);
    if (request) clearTimeout(request.timer);
    pending.delete(id);
  };
  const error = (win: CloseWindow, message: string) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      try { win.webContents.send(IPC.windows.onPluginViewCloseRequest, { error: message }); } catch { /* renderer went away */ }
    }
  };
  return {
    setReady(win: CloseWindow, value: unknown): boolean {
      if (typeof value !== 'boolean') return false;
      if (value) ready.set(win.id, win);
      else { ready.delete(win.id); clear(win.id); }
      return true;
    },
    /** Returns true when native close must be prevented. */
    intercept(win: CloseWindow): boolean {
      if (approved.delete(win.id)) return false;
      if (!ready.has(win.id) || win.isDestroyed() || win.webContents.isDestroyed()) return false;
      if (pending.has(win.id)) return true;
      const id = randomUUID();
      const timer = setTimeout(() => {
        clear(win.id);
        error(win, 'Closing took too long. Your window remains open; try again.');
      }, timeoutMs);
      pending.set(win.id, { id, timer });
      try { win.webContents.send(IPC.windows.onPluginViewCloseRequest, { requestId: id }); }
      catch { clear(win.id); error(win, 'Could not prepare this window to close. Try again.'); }
      return true;
    },
    /** IPC must supply the sender's actual window, never a renderer-provided window id. */
    complete(win: CloseWindow, id: unknown, result: unknown): boolean {
      const request = pending.get(win.id);
      if (!request || id !== request.id || !result || typeof result !== 'object') return false;
      const value = result as { ok?: unknown; error?: unknown };
      if (typeof value.ok !== 'boolean') return false;
      clear(win.id);
      if (!value.ok) {
        const message = typeof value.error === 'string' ? value.error.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 500) : '';
        error(win, message || 'Could not finish saving your workspace. Your window remains open.');
        return true;
      }
      approved.add(win.id);
      win.close();
      return true;
    },
    forget(id: number): void { clear(id); ready.delete(id); approved.delete(id); }
  };
}
