import { getEnvironment, type ConversationThreadRow } from '@zana-ai/zcc-db';
import type { ThreadResumeFields } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { safePackPluginSession } from '../../plugins/plugin-agent-tools.js';
import {
  bridgeLaunchForProvider,
  permissionModeForLaunchProfile
} from './thread-provider-catalog.js';

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
  thread: ConversationThreadRow
): Promise<ThreadResumeFields | undefined> {
  if (!thread.providerThreadId) return undefined;
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : undefined;
  const sessionTooling = await safePackPluginSession(
    ctx.plugins
      ? () => ctx.plugins!.sessionTools({ threadId: thread.id, projectId: thread.projectId })
      : undefined
  );
  return {
    projectId: thread.projectId,
    providerId: thread.providerId,
    providerThreadId: thread.providerThreadId,
    cwd: environment?.path ?? undefined,
    bridgeLaunch: bridgeLaunchForProvider(thread.providerId, ctx.pluginHostArtifacts),
    permissionMode: permissionModeForLaunchProfile(thread.providerId),
    ...sessionTooling
  };
}

export async function resumeConversationOnHost(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow
): Promise<void> {
  if (!thread.environmentId || !thread.providerThreadId) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  const resume = await threadResumeFields(ctx, thread);
  if (!resume) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
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
