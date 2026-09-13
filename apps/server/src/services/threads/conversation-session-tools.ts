import { safePackPluginSession } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { mergeHostSessionTooling, type PackedSessionTooling } from './host-session-tools.js';
import { getConversationThread, getEnvironment, getHost } from '@zana-ai/zcc-db';
import type { PluginAgentConfigureContext } from '@zana-ai/zcc-plugin-sdk/server';
import { listThreadProviders } from './thread-provider-catalog.js';

/**
 * Plugin tools plus host SHARE DynamicTools. Conversation threads do not
 * inherit the PTY inbox MCP server — do not attach that URL here.
 * Pack host tools (preview_file, browser_*, inbox_*, …) instead.
 * CLI Agent / PTY is the other path: launcher MCP catalogue, not registerTool.
 */
export async function packConversationSessionTooling(
  ctx: ProductHttpContext,
  args: { threadId: string; projectId: string }
): Promise<PackedSessionTooling> {
  const packed = await safePackPluginSession(
    ctx.plugins
      ? () => ctx.plugins!.sessionTools(conversationConfigureContext(ctx, args))
      : undefined
  );
  return mergeHostSessionTooling(packed);
}

export function conversationConfigureContext(
  ctx: ProductHttpContext,
  args: { threadId: string; projectId: string }
): PluginAgentConfigureContext {
  const thread = ctx.db ? getConversationThread(ctx.db, args.threadId) : null;
  const project = ctx.projects?.list().find((row) => row.id === args.projectId);
  const environment = ctx.db && thread?.environmentId
    ? getEnvironment(ctx.db, thread.environmentId)
    : null;
  const host = ctx.db && thread ? getHost(ctx.db, thread.hostId) : null;
  const provider = thread
    ? listThreadProviders().find((row) => row.id === thread.providerId)
    : undefined;
  return {
    threadId: args.threadId,
    projectId: args.projectId,
    origin: {
      kind: thread?.originKind ?? null,
      pluginId: thread?.originPluginId ?? null
    },
    ...(thread
      ? {
          thread: {
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
            parentThreadId: thread.parentThreadId,
            title: thread.title
          }
        }
      : {}),
    ...(project
      ? {
          project: {
            id: project.id,
            name: project.name
          }
        }
      : {}),
    ...(environment
      ? {
          environment: {
            id: environment.id,
            name: environment.name,
            path: environment.path,
            workspaceProvisionType: environment.workspaceProvisionType,
            branchName: environment.branchName
          }
        }
      : {}),
    ...(host ? { host: { id: host.id, name: host.name } } : {}),
    ...(thread
      ? {
          provider: {
            id: thread.providerId,
            capabilities: {
              supportsNativeUserQuestion: provider?.capabilities.supportsNativeUserQuestion === true
            }
          }
        }
      : {})
  };
}
