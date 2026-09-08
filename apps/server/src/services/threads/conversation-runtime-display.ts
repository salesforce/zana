import {
  getLatestSessionForHost,
  type ConversationThreadRow,
  type HostSessionRow
} from '@zana-ai/zcc-db';
import type {
  ThreadRuntimeDisplayStatus,
  ThreadRuntimeState,
  ThreadStatus
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';

/** Active-work grace after a host socket drop (BB DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS). */
export const HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS = 30_000;

export function isRunningThreadRuntimeDisplayStatus(
  status: ThreadRuntimeDisplayStatus
): boolean {
  switch (status) {
    case 'active':
    case 'host-reconnecting':
    case 'provisioning':
    case 'starting':
    case 'stopping':
      return true;
    case 'error':
    case 'idle':
    case 'waiting-for-host':
      return false;
    default:
      return false;
  }
}

function statusRuntimeState(status: ThreadStatus): ThreadRuntimeState {
  return { displayStatus: status, hostReconnectGraceExpiresAt: null };
}

function graceExpiresAt(session: HostSessionRow | null, now: number): number | null {
  if (!session || session.status !== 'closed' || session.closedAt == null) return null;
  const expires = session.closedAt + HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS;
  return expires > now ? expires : null;
}

export function resolveConversationRuntimeState(
  ctx: Pick<ProductHttpContext, 'db' | 'hostHub'>,
  thread: Pick<ConversationThreadRow, 'status' | 'hostId'>,
  now = Date.now()
): ThreadRuntimeState {
  if (thread.status !== 'active') {
    return statusRuntimeState(thread.status);
  }
  const hostConnected = ctx.hostHub.connectedHostIds?.().includes(thread.hostId) === true;
  if (hostConnected) {
    return statusRuntimeState('active');
  }
  const latest = getLatestSessionForHost(ctx.db, thread.hostId);
  const expires = graceExpiresAt(latest, now);
  if (expires != null) {
    return {
      displayStatus: 'host-reconnecting',
      hostReconnectGraceExpiresAt: expires
    };
  }
  return {
    displayStatus: 'waiting-for-host',
    hostReconnectGraceExpiresAt: null
  };
}
