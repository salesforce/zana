import { join } from 'node:path';
import {
  createPluginService,
  defaultBundledRoot,
  toPluginAppSnapshot,
  type PluginService,
  type PluginServiceOptions
} from '../plugins/plugin-service.js';
import {
  getConversationThread,
  listConversationThreadEventsWindow
} from '@zana-ai/zcc-db';
import {
  archiveConversation,
  forkConversation,
  sendConversationTurn,
  unarchiveConversation
} from '../services/threads/conversation-lifecycle.js';
import type { ProductHttpContext } from './product-context.js';

export async function productPushInbox(
  ctx: Pick<ProductHttpContext, 'projects' | 'inbox'>,
  args: { pluginId: string; projectId: string; comments: string }
): Promise<{ id: string }> {
  const project = ctx.projects.list().find((row) => row.id === args.projectId);
  if (!project) throw new Error('unrecognized projectId');
  const entry = await ctx.inbox.append({
    projectId: args.projectId,
    projectLabel: project.name,
    comments: args.comments,
    extensionSource: { extensionId: args.pluginId }
  });
  return { id: entry.id };
}

export function productListProjects(
  ctx: Pick<ProductHttpContext, 'projects'>
): Array<{ id: string; name: string; path?: string }> {
  return ctx.projects.list().map((row) => ({ id: row.id, name: row.name, path: row.path }));
}

export async function attachProductPluginService(
  ctx: ProductHttpContext,
  opts?: Pick<PluginServiceOptions, 'bundledRoot' | 'onAgentCapabilitiesChanged' | 'onAppsChanged'>
): Promise<PluginService> {
  const plugins = createPluginService({
    dataDir: ctx.dataDir,
    bundledRoot: opts?.bundledRoot ?? defaultBundledRoot(),
    pluginHostArtifacts: ctx.pluginHostArtifacts,
    requestPluginInteraction: (args) => ctx.pendingInteractions.requestPluginInteraction(args),
    interruptPluginInteractions: (pluginId) => {
      ctx.pendingInteractions.interruptPluginInteractions(pluginId);
    },
    onAgentCapabilitiesChanged: opts?.onAgentCapabilitiesChanged,
    onAppsChanged: opts?.onAppsChanged,
    pushInbox: (args) => productPushInbox(ctx, args),
    listProjects: async () => productListProjects(ctx),
    getThread: async ({ threadId }) => {
      const row = getConversationThread(ctx.db, threadId);
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.projectId,
        hostId: row.hostId,
        environmentId: row.environmentId,
        providerId: row.providerId,
        status: row.status
      };
    },
    listThreadEvents: async ({ threadId, limit, types, order }) => {
      const cap = Math.min(500, Math.max(1, Math.floor(limit ?? 500)));
      const rows = listConversationThreadEventsWindow(ctx.db, threadId, { limit: cap });
      const filtered =
        types && types.length > 0 ? rows.filter((row) => types.includes(row.type)) : rows;
      const mapped = filtered.map((row) => ({
        seq: row.sequence,
        type: row.type,
        payload: row.payload
      }));
      return order === 'desc' ? mapped.slice().reverse() : mapped;
    },
    sendThread: async ({ threadId, prompt }) => {
      const thread = await sendConversationTurn(
        ctx,
        threadId,
        [{ type: 'text', text: prompt, mentions: [] }],
        'start'
      );
      return { id: thread.id };
    },
    archiveThread: async ({ threadId }) => {
      const ok = await archiveConversation(ctx, threadId);
      if (!ok) throw new Error('unknown-thread');
      return { id: threadId };
    },
    forkThread: async ({ threadId }) => {
      const thread = await forkConversation(ctx, threadId);
      return { id: thread.id };
    },
    unarchiveThread: async ({ threadId }) => {
      const thread = await unarchiveConversation(ctx, threadId);
      return { id: thread.id };
    }
  });
  ctx.plugins = plugins;
  await plugins.start();
  return plugins;
}

export function bundledPluginsRootFromDataDir(dataDir: string, override?: string): string {
  return override ?? join(dataDir, '..', 'plugins');
}

/** Contained plugin root for `/plugins/:id/assets/*`, or null when that id has no renderer bundle. */
export function pluginAssetRootFromService(
  plugins: PluginService | undefined,
  pluginId: string
): string | null {
  const row = plugins?.get(pluginId);
  return row?.enabled && row.appEntry ? row.rootDir : null;
}

export { toPluginAppSnapshot };
