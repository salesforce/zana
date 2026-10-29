import { callPluginRpc, type ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';

/** The Salesforce project tab, which also runs as the Studio window. */
export const STUDIO_TAB_ID = 'salesforce';

interface LeaseRow { id?: unknown; surface?: unknown; window?: unknown; commands?: unknown; state?: { resourceId?: unknown; path?: unknown } }

/** An identity only; every file operation still goes through server path confinement. */
export function studioAgentResource(path: unknown): string | null {
  if (typeof path !== 'string' || !path || path.length > 500 || /[\u0000-\u001f]/.test(path)) return null;
  const clean = path.replace(/\\/g, '/');
  if (clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) return null;
  const normalized = clean.split('/').filter(part => part && part !== '.').join('/');
  return /\.(agent|afscript)$/i.test(normalized) ? normalized : null;
}

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
  const resourceId = studioAgentResource(args.path);
  if (!resourceId) return false;
  const call = args.call ?? callPluginRpc;
  try {
    const listed = await call(args.pluginId, 'control.views', { projectId: args.projectId }) as { ok?: boolean; views?: LeaseRow[] } | null;
    const views = listed?.ok && Array.isArray(listed.views) ? listed.views : [];
    const lease = views.find(view => view.window === 'plugin-view' && view.surface === 'workbench'
      && Array.isArray(view.commands) && view.commands.includes('view.open')
      && studioAgentResource(view.state?.resourceId ?? view.state?.path) === resourceId);
    if (!lease || typeof lease.id !== 'string') return false;
    const input = { view: 'agentforce', path: resourceId, ...(args.line && args.line >= 1 ? { line: Math.floor(args.line) } : {}) };
    const sent = await call(args.pluginId, 'control.command', { projectId: args.projectId, viewId: lease.id, command: 'view.open', input }) as { ok?: boolean; commandId?: unknown } | null;
    if (!sent?.ok || typeof sent.commandId !== 'string') return false;
    const done = await call(args.pluginId, 'control.result', { projectId: args.projectId, commandId: sent.commandId, waitMs: STUDIO_ACK_WAIT_MS }) as { ok?: boolean; state?: unknown } | null;
    // The window's own ack sets `ok`, so a refused open falls back too.
    if (!done?.ok || done.state !== 'completed') return false;
  } catch {
    return false;
  }
  void args.navigate.openInWindow?.(args.projectId, { tabId: STUDIO_TAB_ID, resourceId });
  return true;
}

/** How long a freshly opened Studio window gets to take its lease, and how often to look. */
export const STUDIO_WINDOW_START_MS = 15000;
export const STUDIO_WINDOW_POLL_MS = 500;

/**
 * Opens an agent in this project's Studio window, opening that window first when none runs.
 * A new window takes its lease once it mounts, so the open is retried until one acknowledges.
 * Resolves false when the host cannot open the window or no window took the agent in time.
 */
export async function openAgentInStudioWindow(args: Parameters<typeof openInStudioWindow>[0] & {
  startMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const resourceId = studioAgentResource(args.path);
  if (!resourceId) return false;
  if (await openInStudioWindow(args)) return true;
  if (!args.navigate.openInWindow || !(await args.navigate.openInWindow(args.projectId, { tabId: STUDIO_TAB_ID, resourceId }))) return false;
  const sleep = args.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const pollMs = args.pollMs ?? STUDIO_WINDOW_POLL_MS;
  for (let waited = 0; waited < (args.startMs ?? STUDIO_WINDOW_START_MS); waited += pollMs) {
    await sleep(pollMs);
    if (await openInStudioWindow(args)) return true;
  }
  return false;
}
