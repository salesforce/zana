import type { JsonObject } from '@zana-ai/zcc-domain/thread-runtime';
import {
  getConversationThread,
  getThreadPluginMetadata,
  listPanelAgentThreads,
  revealConversationThread,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { PluginService } from '../plugins/plugin-service.js';
import { ThreadCreateError } from './thread-create.js';

/** Route-like text only: panel and view are echoed into the agent's grounding instructions. */
const ROUTE_PATTERN = /^[\p{L}\p{N}/._~:@!$&'()*+,;=?#%-]{1,256}$/u;

export interface PluginPanelBinding {
  originPluginId: string;
  pluginMetadata: JsonObject;
  visibility: 'hidden';
}

/**
 * A thread started from a plugin page's side-panel Agent tab. The renderer only
 * names the plugin, panel and (optionally) the view it was showing; main checks
 * the plugin is running and writes the metadata itself, so a caller cannot forge
 * another plugin's namespace values. The thread is hidden: it belongs to the
 * panel, not the Agents list, until the user opens it as a thread.
 */
export function resolvePluginPanelBinding(
  body: Record<string, unknown>,
  plugins: Pick<PluginService, 'status'> | undefined
): PluginPanelBinding | undefined {
  const raw = body.pluginPanel;
  if (raw === undefined) return undefined;
  if (body.originPluginId !== undefined || body.pluginMetadata !== undefined || body.origin !== undefined) {
    throw new ThreadCreateError(400, 'invalid-input', 'pluginPanel cannot be combined with origin or pluginMetadata');
  }
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const pluginId = typeof rec?.pluginId === 'string' ? rec.pluginId.trim() : '';
  const panel = typeof rec?.panel === 'string' ? rec.panel.trim() : '';
  if (!pluginId || pluginId === 'sdk' || !ROUTE_PATTERN.test(panel)) {
    throw new ThreadCreateError(400, 'invalid-input', 'pluginPanel needs a pluginId and panel');
  }
  if (plugins?.status(pluginId) !== 'running') {
    throw new ThreadCreateError(409, 'plugin-unavailable', `plugin ${pluginId} is not running`);
  }
  // The view is optional context, so a malformed one is dropped, not refused.
  const rawView = typeof rec?.view === 'string' ? rec.view.trim().replace(/^\/+/, '') : '';
  const view = ROUTE_PATTERN.test(rawView) ? rawView : null;
  return {
    originPluginId: pluginId,
    pluginMetadata: { panelAgent: view ? { panel, view } : { panel } },
    visibility: 'hidden'
  };
}

const PANEL_THREADS_DEFAULT_LIMIT = 20;

/**
 * The conversations a plugin page's side panel offers to reopen. Panel threads
 * are hidden, so this is their way back; only installed plugins are listed.
 */
export function pluginPanelThreads(
  db: ZccDatabase,
  plugins: Pick<PluginService, 'get'> | undefined,
  pluginId: string,
  limitParam: string | null,
  panel: string | null = null
): { ok: true; threads: ConversationThreadRow[] } | { ok: false; status: number; message: string } {
  if (!pluginId || pluginId === 'sdk' || !plugins?.get(pluginId)) {
    return { ok: false, status: 404, message: `plugin ${pluginId} is not installed` };
  }
  const limit = limitParam === null ? PANEL_THREADS_DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1) {
    return { ok: false, status: 400, message: 'limit must be a positive integer' };
  }
  return { ok: true, threads: listPanelAgentThreads(db, pluginId, limit, panel?.trim() || undefined) };
}

/**
 * "Open as thread": a panel conversation that grew into real work joins the
 * Agents list. Only host-bound panel threads qualify, so this cannot surface
 * other hidden threads (side-chat forks, plugin workers).
 */
export function revealPluginPanelThread(
  db: ZccDatabase,
  threadId: string
): { ok: true; thread: ConversationThreadRow } | { ok: false; status: number; message: string } {
  const thread = getConversationThread(db, threadId);
  if (!thread) return { ok: false, status: 404, message: 'thread is not registered' };
  const binding = thread.originPluginId
    ? getThreadPluginMetadata(db, thread.id, thread.originPluginId).metadata.panelAgent
    : undefined;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { ok: false, status: 409, message: 'only side-panel conversations can be opened as threads' };
  }
  return { ok: true, thread: revealConversationThread(db, thread.id) ?? thread };
}
