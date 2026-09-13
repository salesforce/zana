import {
  countLiveThreadsForEnvironment,
  getEnvironment,
  getThread,
  updateEnvironmentStatus,
  updateThreadStatus,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { isWithin } from '@zana-ai/zcc-path-confine';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError, threadView } from '../../http/thread-create.js';

async function closeDestroyedEnvironmentTerminals(
  ctx: ProductHttpContext,
  directory: string
): Promise<void> {
  for (const session of ctx.terminalSessions.values()) {
    if (session.status === 'exited') continue;
    if (!isWithin(session.cwd, directory)) continue;
    try {
      await ctx.hostHub.callHostOnlineRpc({
        hostId: session.hostId,
        command: { type: 'terminal.stop', sessionId: session.id }
      });
    } catch {
      // Directory destroy still proceeds if a product PTY is already gone.
    }
    session.status = 'exited';
    session.finishedAt = Date.now();
    const { hostId: _hostId, outputText: _outputText, outputTruncated: _outputTruncated, ...publicSession } = session;
    ctx.hub.emit('terminals:updated', publicSession);
  }
}

export async function destroyEnvironmentIfIdle(ctx: ProductHttpContext, environmentId: string): Promise<void> {
  const environment = getEnvironment(ctx.db, environmentId);
  if (!environment) return;
  if (countLiveThreadsForEnvironment(ctx.db, environmentId) > 0) return;
  if (countLiveCliSessionsForEnvironment(ctx, environmentId) > 0) return;
  if (!environment.managed || environment.status === 'destroyed') return;
  try {
    await destroyEnvironment(ctx, environmentId);
  } catch {
    // Last-session cleanup is best-effort; a host blip must not block archive/close.
  }
}

function countLiveCliSessionsForEnvironment(ctx: ProductHttpContext, environmentId: string): number {
  let count = 0;
  for (const session of ctx.terminalSessions.values()) {
    if (session.status === 'exited') continue;
    if (session.workspaceEnvironmentId === environmentId) count += 1;
  }
  return count;
}

export async function destroyEnvironment(ctx: ProductHttpContext, environmentId: string): Promise<void> {
  const environment = getEnvironment(ctx.db, environmentId);
  if (!environment || environment.status === 'destroyed') {
    throw new ThreadCreateError(404, 'unknown-environment', 'environment is not registered');
  }
  if (countLiveThreadsForEnvironment(ctx.db, environmentId) > 0) {
    throw new ThreadCreateError(409, 'environment_in_use', 'environment still has live threads');
  }
  if (countLiveCliSessionsForEnvironment(ctx, environmentId) > 0) {
    throw new ThreadCreateError(409, 'environment_in_use', 'environment still has live CLI agents');
  }
  if (!environment.path || environment.workspaceProvisionType === 'unmanaged') {
    updateEnvironmentStatus(ctx.db, environmentId, 'destroyed');
    return;
  }
  updateEnvironmentStatus(ctx.db, environmentId, 'destroying');
  await closeDestroyedEnvironmentTerminals(ctx, environment.path);
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
