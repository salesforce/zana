import { callPluginRpc, type ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';

/** The Salesforce project tab, which also runs as the Studio window. */
export const STUDIO_TAB_ID = 'salesforce';

interface LeaseRow { id?: unknown; surface?: unknown; window?: unknown; commands?: unknown }

/**
 * A live window acknowledges within a second (a realtime wake delivers the command). A window that
 * just closed keeps its lease until it expires, so only an acknowledged open counts as delivered.
 */
export const STUDIO_ACK_WAIT_MS = 3000;

/**
 * Opens an agent in this project's Studio window and brings that window forward.
 * Resolves false when no Studio window holds a live lease, so the caller opens it where it is.
 * The open travels as a command on the window's own lease: module state does not cross windows.
 */
export async function openInStudioWindow(args: {
  pluginId: string;
  projectId: string;
  path: string;
  line?: number;
  navigate: Pick<ZccNavigate, 'openInWindow'>;
  call?: typeof callPluginRpc;
}): Promise<boolean> {
  const call = args.call ?? callPluginRpc;
  try {
    const listed = await call(args.pluginId, 'control.views', { projectId: args.projectId }) as { ok?: boolean; views?: LeaseRow[] } | null;
    const views = listed?.ok && Array.isArray(listed.views) ? listed.views : [];
    const lease = views.find(view => view.window === 'plugin-view' && view.surface === 'workbench'
      && Array.isArray(view.commands) && view.commands.includes('view.open'));
    if (!lease || typeof lease.id !== 'string') return false;
    const input = { view: 'agentforce', path: args.path, ...(args.line && args.line >= 1 ? { line: Math.floor(args.line) } : {}) };
    const sent = await call(args.pluginId, 'control.command', { projectId: args.projectId, viewId: lease.id, command: 'view.open', input }) as { ok?: boolean; commandId?: unknown } | null;
    if (!sent?.ok || typeof sent.commandId !== 'string') return false;
    const done = await call(args.pluginId, 'control.result', { projectId: args.projectId, commandId: sent.commandId, waitMs: STUDIO_ACK_WAIT_MS }) as { ok?: boolean; state?: unknown } | null;
    // The window's own ack sets `ok`, so a refused open falls back too.
    if (!done?.ok || done.state !== 'completed') return false;
  } catch {
    return false;
  }
  void args.navigate.openInWindow?.(args.projectId, { tabId: STUDIO_TAB_ID });
  return true;
}
