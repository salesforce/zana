import { authorizedServiceTier } from './provider-service-tier.js';
import { getConversationThread, getEnvironment, getThreadExecutionState, getLatestConversationCheckpoint, type ConversationThreadRow } from '@zana-ai/zcc-db';
import type { ThreadResumeFields, ThreadResumeResult } from '@zana-ai/zcc-contracts/host-rpc';
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
import { threadAutomatedSkillIds } from './thread-automated-skill-selection.js';

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
  const automatedSkillIds = threadAutomatedSkillIds(ctx.db, thread.id);
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
    ...(automatedSkillIds !== undefined ? { automatedSkillIds } : {}),
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

export type StrictResumeFailure = 'native_load_unconfirmed' | 'provider_thread_mismatch';

/** Strict resume could not prove the provider reloaded the expected session. */
export class StrictResumeError extends Error {
  constructor(
    readonly code: StrictResumeFailure,
    message: string
  ) {
    super(message);
    this.name = 'StrictResumeError';
  }
}

/**
 * Resume a conversation and require the provider to natively reload exactly
 * `expectedProviderThreadId`. Unlike resumeConversationOnHost, it never accepts
 * a fresh replacement session: anything but `nativeLoaded === true` with a
 * matching providerThreadId (including a missing or older-host result) throws.
 */
export async function resumeConversationStrict(
  ctx: ProductHttpContext,
  threadId: string,
  expectedProviderThreadId: string,
  assertCurrent?: () => void
): Promise<ThreadResumeResult> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) throw new ThreadCreateError(404, 'thread_not_found', 'thread not found');
  if (!thread.environmentId || !thread.providerThreadId) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  const resume = await threadResumeFields(ctx, thread);
  if (!resume) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  assertCurrent?.();
  const result = await ctx.hostHub.callHostOnlineRpc<ThreadResumeResult>({
    hostId: thread.hostId,
    command: {
      type: 'thread.resume',
      threadId: thread.id,
      environmentId: thread.environmentId,
      ...resume,
      providerThreadId: expectedProviderThreadId,
      requireNativeLoad: true
    }
  });
  if (result?.nativeLoaded !== true) {
    throw new StrictResumeError(
      'native_load_unconfirmed',
      'provider did not confirm a native session load for the strict resume'
    );
  }
  if (result.providerThreadId !== expectedProviderThreadId) {
    throw new StrictResumeError(
      'provider_thread_mismatch',
      'strict resume returned a different provider thread than expected'
    );
  }
  return result;
}
