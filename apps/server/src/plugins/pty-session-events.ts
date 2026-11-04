import type { PtyLifecycleEventMainRequest } from '@zana-ai/zcc-contracts/runtime';
import type { PluginThreadEventName } from '@zana-ai/zcc-plugin-sdk/server';
import type { ProductHttpContext } from '../http/product-context.js';
import { toolPolicyProviderId } from './native-tool-policy.js';
import { emitHardenedLifecycle } from './thread-events.js';

const EVENT_NAMES: Record<PtyLifecycleEventMainRequest['kind'], PluginThreadEventName> = {
  created: 'thread.created',
  active: 'thread.active',
  idle: 'thread.idle',
  failed: 'thread.failed',
  deleted: 'thread.deleted'
};

/**
 * Fan one lifecycle moment of a PTY Electron-main owns out to live plugins.
 * Main asserted the identity from its session record. A PTY with no bound
 * thread keeps its session id as `threadId` (as native tool policy requests
 * do) and `surface: "pty"` says it is not a thread record, so no thread row is
 * looked up. Delivery is fire-and-forget from the caller's view: the reply says
 * only whether a plugin service took the event, and a plugin failure never
 * reaches the session.
 */
export function emitMainOwnedPtyLifecycle(
  ctx: Pick<ProductHttpContext, 'plugins'> | undefined,
  request: PtyLifecycleEventMainRequest
): { delivered: boolean } {
  const plugins = ctx?.plugins;
  if (!plugins) return { delivered: false };
  const event = emitHardenedLifecycle({
    name: EVENT_NAMES[request.kind],
    threadId: request.threadId ?? request.sessionId,
    sessionId: request.sessionId,
    surface: 'pty',
    projectId: request.projectId,
    providerId: toolPolicyProviderId(request.profile),
    ...(request.error !== undefined ? { error: request.error } : {})
  });
  void plugins.emitThreadEvent(event).catch((error) => {
    console.error('[plugins] pty lifecycle emitThreadEvent failed', error);
  });
  return { delivered: true };
}
