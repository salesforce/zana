import { getConversationThread, getEnvironment, type ConversationThreadRow } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { recoverConversationProviderThreadId } from './conversation-provider-identity.js';
import { isUnknownThreadHostError, resumeConversationOnHost } from './conversation-host-rpc.js';
import { bridgeLaunchForProvider, getThreadProvider } from './thread-provider-catalog.js';

export function providerSupportsThreadRename(providerId: string): boolean {
  return getThreadProvider(providerId)?.capabilities.supportsThreadRename === true;
}

export function providerSupportsThreadArchive(providerId: string): boolean {
  return getThreadProvider(providerId)?.capabilities.supportsThreadArchive === true;
}

export function providerSupportsSessionRewind(providerId: string): boolean {
  return getThreadProvider(providerId)?.capabilities.fork === 'checkpoint';
}

function tryBridgeLaunch(ctx: ProductHttpContext, providerId: string) {
  try {
    return bridgeLaunchForProvider(providerId, ctx.pluginHostArtifacts);
  } catch {
    return undefined;
  }
}

export async function renameConversationOnHost(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow,
  title: string
): Promise<void> {
  if (!thread.environmentId || !providerSupportsThreadRename(thread.providerId)) return;
  try {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: thread.hostId,
      command: {
        type: 'thread.rename',
        threadId: thread.id,
        environmentId: thread.environmentId,
        title
      }
    });
  } catch {
    /* live rename is best-effort; the product title is already persisted */
  }
}

export async function archiveConversationOnHost(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow
): Promise<void> {
  const live = recoverConversationProviderThreadId(ctx.db, thread);
  if (!live.environmentId || !live.providerThreadId) return;
  if (!providerSupportsThreadArchive(live.providerId)) return;
  const environment = getEnvironment(ctx.db, live.environmentId);
  if (!environment?.path) return;
  const bridgeLaunch = tryBridgeLaunch(ctx, live.providerId);
  if (!bridgeLaunch) return;
  try {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: live.hostId,
      command: {
        type: 'thread.archive',
        threadId: live.id,
        environmentId: live.environmentId,
        providerId: live.providerId,
        providerThreadId: live.providerThreadId,
        cwd: environment.path,
        bridgeLaunch
      }
    });
  } catch {
    /* provider archive is best-effort; the product row is already archived */
  }
}

export async function unarchiveConversationOnHost(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow
): Promise<void> {
  const live = recoverConversationProviderThreadId(ctx.db, thread);
  if (!live.environmentId || !live.providerThreadId) return;
  if (!providerSupportsThreadArchive(live.providerId)) return;
  const environment = getEnvironment(ctx.db, live.environmentId);
  if (!environment?.path) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not registered');
  }
  const bridgeLaunch = tryBridgeLaunch(ctx, live.providerId);
  if (!bridgeLaunch) return;
  try {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: live.hostId,
      command: {
        type: 'thread.unarchive',
        threadId: live.id,
        environmentId: live.environmentId,
        providerId: live.providerId,
        providerThreadId: live.providerThreadId,
        cwd: environment.path,
        bridgeLaunch
      }
    });
  } catch {
    /* provider unarchive is best-effort; the product row is already restored */
  }
}

export async function clearConversationGoal(
  ctx: ProductHttpContext,
  threadId: string
): Promise<{ ok: true }> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (thread.providerId !== 'codex') {
    throw new ThreadCreateError(409, 'invalid_request', 'This provider does not support active Goals');
  }
  const live = recoverConversationProviderThreadId(ctx.db, thread);
  if (!live.environmentId) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const command = {
    type: 'thread.goal.clear' as const,
    threadId: live.id,
    environmentId: live.environmentId
  };
  try {
    await ctx.hostHub.callHostOnlineRpc({ hostId: live.hostId, command });
  } catch (error) {
    if (!isUnknownThreadHostError(error)) throw error;
    await resumeConversationOnHost(ctx, live);
    await ctx.hostHub.callHostOnlineRpc({ hostId: live.hostId, command });
  }
  return { ok: true };
}
