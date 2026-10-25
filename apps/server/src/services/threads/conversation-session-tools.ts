import { remoteInteractionSurface } from './interaction-surface.js';
import { safePackPluginSession } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { mergeHostSessionTooling, type PackedSessionTooling } from './host-session-tools.js';
import { getConversationThread, getEnvironment, getHost } from '@zana-ai/zcc-db';
import type { PluginAgentConfigureContext } from '@zana-ai/zcc-plugin-sdk/server';
import { listThreadProviders, THREAD_PROVIDER_STARTUP_WAIT_MS, waitForPluginStartup } from './thread-provider-catalog.js';

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
  // The tool list is fixed when the session starts, so wait for every plugin to
  // activate, not only the provider; otherwise a thread started right after
  // launch never sees tools like ask_user_question.
  if (ctx.plugins && !(await waitForPluginStartup())) {
    console.warn(
      `[threads] plugin startup still running after ${THREAD_PROVIDER_STARTUP_WAIT_MS}ms; `
      + `thread ${args.threadId} (project ${args.projectId}) starts with the plugin tools activated so far`
    );
  }
  const packed = await safePackPluginSession(
    ctx.plugins
      ? () => ctx.plugins!.sessionTools(conversationConfigureContext(ctx, args))
      : undefined,
    args
  );
  return mergeHostSessionTooling(packed, {
    remoteSurface: ctx.db ? remoteInteractionSurface(ctx.db, args.threadId) : null,
    inAppAgentTerminalsEnabled: ctx.config?.getConfig?.().inAppAgentTerminalsEnabled === true
  });
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
    ...(thread && remoteInteractionSurface(ctx.db, args.threadId) ? { desktopPresentation: false } : {}),
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
