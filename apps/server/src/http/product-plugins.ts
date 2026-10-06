import { bridgeLaunchForProvider, getThreadProvider } from '../services/threads/thread-provider-catalog.js';
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
import type { PluginSdkProject, PluginSdkThreadSummary } from '@zana-ai/zcc-plugin-sdk/server';
import { resolvePluginDefaultExecutionOptions, overlayCustomModels } from '../services/threads/thread-execution-options.js';
import { readLastThreadExecution } from '../services/threads/thread-last-execution.js';
import { asControlResult, callControlAsProductServer } from './cli-agent-ops.js';
import type { PersonaInput, TeamInput } from '@zana-ai/zcc-domain/product';
import { InteractionService } from '../services/interactions/interaction-service.js';
import { startInteractionMaintenance } from '../services/interactions/interaction-maintenance.js';

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
): PluginSdkProject[] {
  return ctx.projects.list().map((row) => ({ id: row.id, name: row.name, path: row.path, ...(row.icon ? { icon: row.icon } : {}), ...(row.quickAgent === true ? { quickAgent: true } : {}) }));
}

/**
 * Forward a plugin's declarative persona/team roster to Electron main's
 * `PersonaTeamRegistry` over the control-plane (plugins run in this separate
 * server process, never in main — Rule 1: main re-authorizes/re-namespaces by
 * `pluginId` on receipt, this call carries no authority of its own). Fire-and-
 * forget to match the synchronous `void` SDK surface; a failure is logged, not
 * thrown, so one bad contribution never crashes plugin load.
 */
export function productRegisterPersonas(
  ctx: Pick<ProductHttpContext, 'dataDir'>,
  pluginId: string,
  personas: readonly PersonaInput[]
): void {
  void callControlAsProductServer(ctx.dataDir, 'product.invoke', {
    method: 'personas.contribute',
    args: [pluginId, personas]
  }).then((value) => {
    const result = asControlResult(value);
    if (!result.ok) console.error(`[plugin:${pluginId}] registerPersonas failed: ${result.message}`);
  }).catch((error: unknown) => {
    console.error(`[plugin:${pluginId}] registerPersonas failed:`, error);
  });
}

export function productRegisterTeams(
  ctx: Pick<ProductHttpContext, 'dataDir'>,
  pluginId: string,
  teams: readonly TeamInput[]
): void {
  void callControlAsProductServer(ctx.dataDir, 'product.invoke', {
    method: 'teams.contribute',
    args: [pluginId, teams]
  }).then((value) => {
    const result = asControlResult(value);
    if (!result.ok) console.error(`[plugin:${pluginId}] registerTeams failed: ${result.message}`);
  }).catch((error: unknown) => {
    console.error(`[plugin:${pluginId}] registerTeams failed:`, error);
  });
}

/**
 * `InteractionService` is keyed by interaction id alone — ownership is
 * enforced here, one level up, so a plugin can only see/ack/cancel its own
 * rows (Rule 1: the service trusts its caller; this is the authorization
 * boundary). A mismatched or missing row reads as NOT_FOUND rather than
 * leaking another plugin's existence.
 */
function ownedInteractionOrThrow(
  service: InteractionService,
  pluginId: string,
  interactionId: string
): import('@zana-ai/zcc-domain').InteractionContract {
  const row = service.get(interactionId);
  if (!row || row.pluginId !== pluginId) throw new Error(`no interaction: ${interactionId}`);
  return row;
}

function toPluginThreadSummary(row: {
  id: string;
  title?: string | null;
  updatedAt?: number;
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
    title: row.title ?? null,
    titleFallback: null,
    updatedAt: row.updatedAt ?? row.createdAt ?? 0,
    deletedAt: null,
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

export async function attachProductPluginService(
  ctx: ProductHttpContext,
  opts?: Pick<
    PluginServiceOptions,
    'onAgentCapabilitiesChanged' | 'onAppsChanged' | 'watchBuiltinPluginSources' | 'hostAgentToolSource'
  >
    & { bundledRoot?: string }
): Promise<PluginService> {
  const interactions = new InteractionService(ctx.db);
  const plugins = createPluginService({
    dataDir: ctx.dataDir,
    bundledRoot: opts?.bundledRoot ?? defaultBundledRoot(),
    pluginHostArtifacts: ctx.pluginHostArtifacts,
    ...(opts?.hostAgentToolSource ? { hostAgentToolSource: opts.hostAgentToolSource } : {}),
    requestPluginInteraction: (args) => ctx.pendingInteractions.requestPluginInteraction(args),
    interruptPluginInteractions: (pluginId) => {
      ctx.pendingInteractions.interruptPluginInteractions(pluginId);
    },
    getInteraction: async ({ pluginId, interactionId }) => {
      const row = interactions.get(interactionId);
      return row && row.pluginId === pluginId ? row : null;
    },
    upsertInteraction: async ({ pluginId, projectId, correlationId, kind, payload }) =>
      interactions.upsertInteraction({ pluginId, projectId, correlationId, kind, payload }),
    acknowledgeInteraction: async ({ pluginId, interactionId, generation }) => {
      ownedInteractionOrThrow(interactions, pluginId, interactionId);
      return interactions.acknowledge({ interactionId, generation });
    },
    cancelInteraction: async ({ pluginId, interactionId, generation }) => {
      ownedInteractionOrThrow(interactions, pluginId, interactionId);
      return interactions.resolve(interactionId, generation, 'cancelled');
    },
    onAgentCapabilitiesChanged: opts?.onAgentCapabilitiesChanged,
    onAppsChanged: opts?.onAppsChanged,
    getAppConfig: () => ctx.config.getConfig(),
    watchBuiltinPluginSources:
      opts?.watchBuiltinPluginSources ?? process.env.ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD === '1',
    pushInbox: (args) => productPushInbox(ctx, args),
    listProjects: async () => productListProjects(ctx),
    registerPersonas: (pluginId, personas) => productRegisterPersonas(ctx, pluginId, personas),
    registerTeams: (pluginId, teams) => productRegisterTeams(ctx, pluginId, teams),
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
      const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
      const provider = getThreadProvider(thread.providerId);
      const discovered = await ctx.modelCatalogs.read({
        hostId: thread.hostId,
        providerId: thread.providerId,
        scope: provider?.models?.scope ?? 'workspace',
        bridgeLaunch: bridgeLaunchForProvider(thread.providerId, ctx.pluginHostArtifacts),
        ...(environment?.path ? { cwd: environment.path } : {}),
        ...(last.model ? { requiredModel: last.model } : {})
      });
      const catalog = overlayCustomModels(discovered, ctx.config.getConfig(), provider);
      return resolvePluginDefaultExecutionOptions({
        providerId: thread.providerId,
        lastModel: last.model,
        lastReasoningLevel: last.reasoningLevel,
        catalog
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
        displayName: provider.displayName,
        available: true,
        capabilities: {
          permissionModes: [...(provider.capabilities.permissionModes ?? [])],
          supportsServiceTier: provider.capabilities.supportsServiceTier
        }
      }));
    },
    loadProviderModels: async ({ providerId, hostId, environmentId }) => {
      const environment = environmentId ? getEnvironment(ctx.db, environmentId) : null;
      if (environmentId && !environment) throw new Error('unknown-environment');
      if (environment && hostId && environment.hostId !== hostId) throw new Error('environment does not belong to host');
      const provider = getThreadProvider(providerId);
      const result = await ctx.modelCatalogs.read({
        hostId: ctx.hostHub.resolveHostId(environment?.hostId ?? hostId),
        providerId,
        scope: provider?.models?.scope ?? 'workspace',
        bridgeLaunch: bridgeLaunchForProvider(providerId, ctx.pluginHostArtifacts),
        ...(environment?.path ? { cwd: environment.path } : {})
      });
      return { ...result, ...overlayCustomModels(result, ctx.config.getConfig(), provider) };
    },
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
      }).map(toPluginThreadSummary);
    },
    listQueuedMessages: async ({ threadId }) => {
      return (await listQueuedMessages(ctx.dataDir, threadId)).map((row) => ({ id: row.id }));
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
      hostId,
      serviceTier,
      pluginMetadata
    }) => {
      const providers = listThreadProviders();
      if (providerId && !providers.some((row) => row.id === providerId)) throw new Error(`unknown thread provider: ${providerId}`);
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
        ...(environment ? { environment } : {}),
        ...(hostId ? { hostId } : {}),
        ...(serviceTier ? { serviceTier } : {}),
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
  const stopInteractionMaintenance = startInteractionMaintenance(ctx.db);
  const originalStop = plugins.stop.bind(plugins);
  plugins.stop = () => {
    stopInteractionMaintenance();
    originalStop();
  };
  await plugins.start();
  for (const hostId of ctx.hostHub.connectedHostIds()) {
    for (const provider of listThreadProviders().filter((row) => row.models?.scope === 'host')) {
      try {
        void ctx.modelCatalogs.read({
          hostId,
          providerId: provider.id,
          scope: 'host',
          prewarm: true,
          bridgeLaunch: bridgeLaunchForProvider(provider.id, ctx.pluginHostArtifacts)
        }).catch(() => undefined);
      } catch {
        // Host artifacts may still be settling during plugin startup.
      }
    }
  }
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
