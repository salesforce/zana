import { authorizedServiceTier } from './provider-service-tier.js';
import { getEnvironment, getThreadExecutionState, getLatestConversationCheckpoint, type ConversationThreadRow } from '@zana-ai/zcc-db';
import type { ThreadResumeFields } from '@zana-ai/zcc-contracts/host-rpc';
import type { PermissionMode } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { packConversationSessionTooling } from './conversation-session-tools.js';
import { derivedProviderOptionsForCommand } from './derived-provider-options.js';
import {
  bridgeLaunchForProvider,
  getThreadProvider
} from './thread-provider-catalog.js';
import { claudeCodePermissionModeForTurn } from './conversation-execution-mode.js';
import { threadPermissionMode } from './thread-permission-mode.js';
import { readLastThreadExecution } from './thread-last-execution.js';

export function isUnknownThreadHostError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code: unknown }).code === 'unknown_thread'
  );
}

export async function threadResumeFields(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow,
  requestedPermissionMode?: PermissionMode
): Promise<ThreadResumeFields | undefined> {
  if (!thread.providerThreadId) return undefined;
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : undefined;
  const sessionTooling = await packConversationSessionTooling(ctx, {
    threadId: thread.id,
    projectId: thread.projectId
  });
  const permissionMode = threadPermissionMode(ctx, thread, requestedPermissionMode);
  const { model, reasoningLevel, acpMode, serviceTier: inheritedTier } = readLastThreadExecution(ctx, thread.id);
  const serviceTier = authorizedServiceTier(ctx, thread.providerId, inheritedTier, {inherited:true});
  const requestedMode = getThreadExecutionState(ctx.db, thread.id)?.requestedMode;
  const claudeCodePermissionMode = requestedMode
    ? claudeCodePermissionModeForTurn(thread.providerId, requestedMode)
    : undefined;
  const providerOptions = await derivedProviderOptionsForCommand({
    providerId: thread.providerId,
    threadId: thread.id,
    projectId: thread.projectId,
    permissionMode,
    ...(claudeCodePermissionMode ? { claudeCodePermissionMode } : {}),
    plugins: ctx.plugins
  });
  return {
    projectId: thread.projectId,
    providerId: thread.providerId,
    providerThreadId: thread.providerThreadId,
    cwd: environment?.path ?? undefined,
    bridgeLaunch: bridgeLaunchForProvider(thread.providerId, ctx.pluginHostArtifacts),
    permissionMode,
    ...sessionTooling,
    ...(model ? { model } : {}),
    ...(reasoningLevel ? { reasoningLevel } : {}),
    ...(acpMode ? { acpMode } : {}),
    ...(serviceTier ? { serviceTier } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(getThreadProvider(thread.providerId)?.capabilities.fork === 'checkpoint'
      ? (() => {
        const checkpoint = getLatestConversationCheckpoint(ctx.db, thread.id);
        return checkpoint ? { providerCheckpointId: checkpoint.checkpoint } : {};
      })()
      : {})
  };
}

export async function resumeConversationOnHost(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow,
  assertCurrent?: () => void
): Promise<void> {
  if (!thread.environmentId || !thread.providerThreadId) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  const resume = await threadResumeFields(ctx, thread);
  if (!resume) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  assertCurrent?.();
  await ctx.hostHub.callHostOnlineRpc({
    hostId: thread.hostId,
    command: {
      type: 'thread.resume',
      threadId: thread.id,
      environmentId: thread.environmentId,
      ...resume
    }
  });
}
