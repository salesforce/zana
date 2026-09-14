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
  getEnvironment,
  listConversationThreadEventsWindow,
  queryConversationThreads
} from '@zana-ai/zcc-db';
import {
  archiveConversation,
  forkConversation,
  sendConversationTurn,
  stopConversation,
  unarchiveConversation
} from '../services/threads/conversation-lifecycle.js';
import { createQueuedMessage, listQueuedMessages } from '../services/threads/queued-messages.js';
import { createConversationFromRequest } from '../services/threads/conversation-create.js';
import {
  readConversationPluginMetadata,
  updateConversationPluginMetadata
} from '../services/threads/conversation-plugin-metadata.js';
import { listThreadProviders } from '../services/threads/thread-provider-catalog.js';
import type { ProductHttpContext } from './product-context.js';
import { conversationThreadOutput } from '../plugins/thread-events.js';
import { readHostFile } from './files-via-host.js';
import type { PluginSdkThreadSummary } from '@zana-ai/zcc-plugin-sdk/server';
import { pluginHostModelCatalog, resolvePluginDefaultExecutionOptions } from '../services/threads/thread-execution-options.js';
import { readLastThreadExecution } from '../services/threads/thread-last-execution.js';

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

function toPluginThreadSummary(row: {
  id: string;
  projectId: string;
  hostId: string;
  environmentId: string | null;
  providerId: string;
  status: string;
  originKind?: string | null;
  originPluginId?: string | null;
  visibility?: string;
  archivedAt?: number | null;
  createdAt?: number;
  parentThreadId?: string | null;
}): PluginSdkThreadSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    hostId: row.hostId,
    environmentId: row.environmentId,
    providerId: row.providerId,
    status: row.status,
    originKind: row.originKind,
    originPluginId: row.originPluginId,
    visibility: row.visibility,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    parentThreadId: row.parentThreadId
  };
}

function fallbackModelCatalog(providerId: string) {
  return pluginHostModelCatalog(providerId);
}

export async function attachProductPluginService(
  ctx: ProductHttpContext,
  opts?: Pick<
    PluginServiceOptions,
    'onAgentCapabilitiesChanged' | 'onAppsChanged' | 'watchBuiltinPluginSources' | 'hostAgentToolSource'
  >
    & { bundledRoot?: string }
): Promise<PluginService> {
  const plugins = createPluginService({
    dataDir: ctx.dataDir,
    bundledRoot: opts?.bundledRoot ?? defaultBundledRoot(),
    pluginHostArtifacts: ctx.pluginHostArtifacts,
    ...(opts?.hostAgentToolSource ? { hostAgentToolSource: opts.hostAgentToolSource } : {}),
    requestPluginInteraction: (args) => ctx.pendingInteractions.requestPluginInteraction(args),
    interruptPluginInteractions: (pluginId) => {
      ctx.pendingInteractions.interruptPluginInteractions(pluginId);
    },
    onAgentCapabilitiesChanged: opts?.onAgentCapabilitiesChanged,
    onAppsChanged: opts?.onAppsChanged,
    getAppConfig: () => ctx.config.getConfig(),
    watchBuiltinPluginSources:
      opts?.watchBuiltinPluginSources ?? process.env.ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD === '1',
    pushInbox: (args) => productPushInbox(ctx, args),
    listProjects: async () => productListProjects(ctx),
    productContext: ctx,
    getThread: async ({ threadId }) => {
      const row = getConversationThread(ctx.db, threadId);
      if (!row) return null;
      return toPluginThreadSummary(row);
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
    sendThread: async ({ threadId, prompt, visibility, mode }) => {
      const thread = await sendConversationTurn(
        ctx,
        threadId,
        [{ type: 'text', text: prompt, mentions: [], ...(visibility ? { visibility } : {}) }],
        mode ?? 'start'
      );
      return { id: thread.id };
    },
    stopThread: async ({ threadId }) => {
      await stopConversation(ctx, threadId);
      return { ok: true as const };
    },
    threadOutput: async ({ threadId }) => conversationThreadOutput(ctx, threadId),
    defaultExecutionOptions: async ({ threadId }) => {
      const thread = getConversationThread(ctx.db, threadId);
      if (!thread) throw new Error('unknown-thread');
      const last = readLastThreadExecution(ctx, threadId);
      return resolvePluginDefaultExecutionOptions({
        providerId: thread.providerId,
        lastModel: last.model,
        lastReasoningLevel: last.reasoningLevel
      });
    },
    getEnvironment: async ({ environmentId }) => {
      const environment = getEnvironment(ctx.db, environmentId);
      if (!environment) throw new Error('unknown-environment');
      return {
        id: environment.id,
        projectId: environment.projectId,
        hostId: environment.hostId,
        path: environment.path
      };
    },
    readWorkspaceFile: async ({ hostId, path, rootPath }) => {
      if (!path.trim()) throw new Error('path is required');
      const result = await readHostFile(ctx, {
        hostId,
        path,
        ...(rootPath?.trim() ? { rootPath } : {})
      });
      return {
        content: result.content,
        contentEncoding: result.contentEncoding,
        sizeBytes: result.sizeBytes
      };
    },
    listProviders: async () => {
      return listThreadProviders().map((provider) => ({
        id: provider.id,
        available: true,
        capabilities: {
          permissionModes: [...(provider.capabilities.permissionModes ?? [])]
        }
      }));
    },
    loadProviderModels: async ({ providerId }) => fallbackModelCatalog(providerId),
    archiveThread: async ({ threadId }) => {
      const ok = await archiveConversation(ctx, threadId);
      if (!ok) throw new Error('unknown-thread');
      return { id: threadId };
    },
    forkThread: async ({ threadId, sourceSeqEnd, visibility, agentContextSeed, title, pluginId }) => {
      const thread = await forkConversation(ctx, threadId, {
        sourceSeqEnd,
        visibility,
        originPluginId: pluginId,
        agentContextSeed,
        title
      });
      return { id: thread.id };
    },
    listThreads: async ({ includeHidden, originKind, originPluginId, archived, limit, offset }) => {
      return queryConversationThreads(ctx.db, {
        includeHidden,
        originKind,
        originPluginId,
        archived,
        limit,
        offset
      }).map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        hostId: thread.hostId,
        environmentId: thread.environmentId,
        providerId: thread.providerId,
        status: thread.status,
        originKind: thread.originKind,
        originPluginId: thread.originPluginId,
        visibility: thread.visibility,
        archivedAt: thread.archivedAt,
        createdAt: thread.createdAt,
        parentThreadId: thread.parentThreadId
      }));
    },
    listQueuedMessages: async ({ threadId }) => {
      return listQueuedMessages(ctx.dataDir, threadId).map((row) => ({ id: row.id }));
    },
    createQueuedMessage: async ({ threadId, input, senderThreadId }) => {
      const message = await createQueuedMessage(ctx.dataDir, threadId, input as never, {
        senderThreadId
      });
      return { id: message.id };
    },
    spawnThread: async ({
      pluginId,
      projectId,
      prompt,
      providerId,
      parentThreadId,
      title,
      model,
      reasoningLevel,
      permissionMode,
      visibility,
      environment,
      pluginMetadata
    }) => {
      const providers = listThreadProviders();
      const resolvedProvider = providerId
        && providers.some((row) => row.id === providerId)
        ? providerId
        : providers[0]?.id;
      if (!resolvedProvider) throw new Error('no thread provider is registered');
      const thread = await createConversationFromRequest(ctx, {
        projectId,
        providerId: resolvedProvider,
        input: [prompt],
        promptInput: [{ type: 'text', text: prompt, mentions: [] }],
        title: title?.trim() || `Plugin: ${pluginId}`,
        parentThreadId,
        originPluginId: pluginId,
        ...(visibility ? { visibility } : {}),
        ...(environment?.kind === 'reuse' ? { environment: { kind: 'reuse', environmentId: environment.environmentId } } : {}),
        ...(model ? { model } : {}),
        ...(reasoningLevel ? { reasoningLevel: reasoningLevel as never } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(pluginMetadata ? { pluginMetadata } : {})
      });
      return { id: thread.id };
    },
    unarchiveThread: async ({ threadId }) => {
      const thread = await unarchiveConversation(ctx, threadId);
      return { id: thread.id };
    },
    getPluginMetadata: async ({ threadId, pluginId }) => {
      return readConversationPluginMetadata(ctx.db, threadId, pluginId);
    },
    updatePluginMetadata: async ({ threadId, pluginId, set, remove }) => {
      return updateConversationPluginMetadata(ctx.db, { threadId, pluginId, set, remove });
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
