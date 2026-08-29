import { randomUUID } from 'node:crypto';
import {
  deleteConversationThreadEventsAfter,
  getConversationThread,
  getEnvironment,
  listConversationThreadEvents,
  setConversationProviderThreadId
} from '@zana-ai/zcc-db';
import type { EditMessageRequest, EditMessageResponse } from '@zana-ai/zcc-server-contract';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { recoverConversationProviderThreadId } from './conversation-provider-identity.js';
import { threadResumeFields } from './conversation-host-rpc.js';
import { sendConversationTurn, stopConversation } from './conversation-lifecycle.js';
import { providerSupportsSessionRewind } from './thread-host-commands.js';
import { bridgeLaunchForProvider, permissionModeForLaunchProfile } from './thread-provider-catalog.js';

function checkpointFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { providerCheckpointId?: unknown; event?: unknown; payload?: unknown };
  if (typeof record.providerCheckpointId === 'string' && record.providerCheckpointId.trim()) {
    return record.providerCheckpointId.trim();
  }
  if (record.event && record.event !== payload) return checkpointFromPayload(record.event);
  if (record.payload && record.payload !== payload) return checkpointFromPayload(record.payload);
  return null;
}

export function latestProviderCheckpoint(events: Array<{ sequence: number; payload: unknown }>): {
  sequence: number;
  checkpoint: string;
} | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const row = events[i]!;
    const checkpoint = checkpointFromPayload(row.payload);
    if (checkpoint) return { sequence: row.sequence, checkpoint };
  }
  return null;
}

export async function editConversationMessage(
  ctx: ProductHttpContext,
  threadId: string,
  payload: EditMessageRequest
): Promise<EditMessageResponse> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  if (!providerSupportsSessionRewind(thread.providerId)) {
    throw new ThreadCreateError(
      409,
      'invalid_request',
      `Editing messages is not supported for ${thread.providerId}`
    );
  }
  if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) {
    throw new ThreadCreateError(
      409,
      'awaiting_user_interaction',
      'Resolve the pending interaction before editing the message'
    );
  }
  const live = recoverConversationProviderThreadId(ctx.db, thread);
  if (!live.environmentId || !live.providerThreadId) {
    throw new ThreadCreateError(409, 'not_resumable', 'thread has no provider session to resume');
  }
  const environment = getEnvironment(ctx.db, live.environmentId);
  if (!environment?.path) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'thread has no environment');
  }
  const retained = latestProviderCheckpoint(listConversationThreadEvents(ctx.db, live.id));
  if (!retained) {
    throw new ThreadCreateError(409, 'invalid_request', 'The thread has no editable user message');
  }
  if (live.status === 'active' || live.status === 'starting' || live.status === 'stopping') {
    await stopConversation(ctx, live.id);
  }

  const leaseId = randomUUID();
  try {
    const resume = await threadResumeFields(ctx, live);
    const prepared = await ctx.hostHub.callHostOnlineRpc<{
      threadId: string;
      prepared: true;
      providerThreadId: string;
    }>({
      hostId: live.hostId,
      command: {
        type: 'thread.rewind.prepare',
        threadId: live.id,
        environmentId: live.environmentId,
        leaseId,
        projectId: live.projectId,
        providerId: live.providerId,
        sourceProviderThreadId: live.providerThreadId,
        retainThroughProviderCheckpoint: retained.checkpoint,
        cwd: environment.path,
        bridgeLaunch: resume?.bridgeLaunch
          ?? bridgeLaunchForProvider(live.providerId, ctx.pluginHostArtifacts),
        permissionMode: resume?.permissionMode ?? permissionModeForLaunchProfile(live.providerId)
      }
    });
    setConversationProviderThreadId(ctx.db, live.id, prepared.providerThreadId);
    // Local history follows the provider rewind. If submit fails, discard the
    // staged rewind; the truncated events are already gone.
    deleteConversationThreadEventsAfter(ctx.db, live.id, retained.sequence);
    await sendConversationTurn(ctx, live.id, payload.input, 'auto', {
      model: payload.model,
      reasoningLevel: payload.reasoningLevel
    });
  } catch (error) {
    try {
      await ctx.hostHub.callHostOnlineRpc({
        hostId: live.hostId,
        command: {
          type: 'thread.rewind.discard',
          threadId: live.id,
          environmentId: live.environmentId,
          leaseId
        }
      });
    } catch {
      /* discard is best-effort */
    }
    throw error;
  }
  return {
    ok: true,
    operationId: payload.operationId,
    requestSequence: retained.sequence
  };
}
