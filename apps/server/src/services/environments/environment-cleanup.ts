import {
  countLiveThreadsForEnvironment,
  getEnvironment,
  getThread,
  updateEnvironmentStatus,
  updateThreadStatus,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError, threadView } from '../../http/thread-create.js';

export async function destroyEnvironmentIfIdle(ctx: ProductHttpContext, environmentId: string): Promise<void> {
  const environment = getEnvironment(ctx.db, environmentId);
  if (!environment) return;
  if (countLiveThreadsForEnvironment(ctx.db, environmentId) > 0) return;
  if (!environment.managed || environment.status === 'destroyed') return;
  try {
    await destroyEnvironment(ctx, environmentId);
  } catch {
    // Last-thread cleanup is best-effort; a host blip must not block archive.
  }
}

export async function destroyEnvironment(ctx: ProductHttpContext, environmentId: string): Promise<void> {
  const environment = getEnvironment(ctx.db, environmentId);
  if (!environment || environment.status === 'destroyed') {
    throw new ThreadCreateError(404, 'unknown-environment', 'environment is not registered');
  }
  if (countLiveThreadsForEnvironment(ctx.db, environmentId) > 0) {
    throw new ThreadCreateError(409, 'environment_in_use', 'environment still has live threads');
  }
  if (!environment.path || environment.workspaceProvisionType === 'unmanaged') {
    updateEnvironmentStatus(ctx.db, environmentId, 'destroyed');
    return;
  }
  updateEnvironmentStatus(ctx.db, environmentId, 'destroying');
  try {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: environment.hostId,
      command: {
        type: 'environment.destroy',
        environmentId: environment.id,
        workspacePath: environment.path,
        workspaceProvisionType: environment.workspaceProvisionType
      }
    });
    updateEnvironmentStatus(ctx.db, environmentId, 'destroyed');
  } catch (error) {
    updateEnvironmentStatus(ctx.db, environmentId, 'failed');
    throw error;
  }
}

export async function archiveThread(ctx: ProductHttpContext, threadId: string): Promise<boolean> {
  const thread = getThread(ctx.db as ZccDatabase, threadId);
  if (!thread) return false;
  // Complete first so a hydrate during stop cannot re-list this row as live.
  const completed = updateThreadStatus(ctx.db, threadId, 'completed') ?? { ...thread, status: 'completed' as const };
  ctx.hub.emit('threads:updated', threadView(ctx, completed));
  try {
    await ctx.hostHub.callHostOnlineRpc({
      hostId: thread.hostId,
      command: { type: 'thread.stop', threadId }
    });
  } catch {
    // Host may already have dropped the PTY (exit, disconnect). Archive anyway.
  }
  if (thread.environmentId) await destroyEnvironmentIfIdle(ctx, thread.environmentId);
  return true;
}
