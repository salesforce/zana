import {
  appendConversationThreadEvent,
  type ConversationThreadEventRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  isApprovalPendingInteractionPayload,
  isPluginPendingInteraction,
  isUserQuestionPendingInteractionPayload,
  threadEventSchema,
  threadScope,
  turnScope,
  type PendingInteraction,
  type ProviderPendingInteraction,
  type ThreadEvent
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHub } from '../../http/product-hub.js';

function emitStoredEvent(hub: ProductHub, stored: ConversationThreadEventRow): void {
  hub.emit('threads:event', {
    threadId: stored.threadId,
    sequence: stored.sequence,
    kind: 'thread.event',
    type: stored.type,
    payload: stored.payload
  });
}

function appendEvent(
  db: ZccDatabase,
  hub: ProductHub,
  event: ThreadEvent
): void {
  const parsed = threadEventSchema.safeParse(event);
  if (!parsed.success) return;
  const stored = appendConversationThreadEvent(db, {
    threadId: event.threadId,
    type: event.type,
    payload: parsed.data
  });
  emitStoredEvent(hub, stored);
}

function providerScope(interaction: ProviderPendingInteraction) {
  return turnScope(interaction.turnId);
}

export function appendPendingInteractionTimelineEvent(
  db: ZccDatabase,
  hub: ProductHub,
  interaction: PendingInteraction
): void {
  if (isPluginPendingInteraction(interaction)) {
    appendEvent(db, hub, {
      type: 'system/operation',
      threadId: interaction.threadId,
      scope: threadScope(),
      operation: 'plugin_interaction',
      status: interaction.status,
      message: interaction.payload.title,
      operationId: interaction.id,
      metadata: {
        pluginId: interaction.origin.pluginId,
        rendererId: interaction.origin.rendererId
      }
    });
    return;
  }
  if (isUserQuestionPendingInteractionPayload(interaction.payload)) {
    appendEvent(db, hub, {
      type: 'system/userQuestion/lifecycle',
      threadId: interaction.threadId,
      scope: providerScope(interaction),
      interactionId: interaction.id,
      providerId: interaction.providerId,
      providerRequestId: interaction.providerRequestId,
      status: interaction.status,
      resolution: isUserQuestionPendingInteractionPayload(interaction.payload)
        && interaction.resolution
        && 'kind' in interaction.resolution
        && interaction.resolution.kind === 'user_answer'
        ? interaction.resolution
        : null,
      statusReason: interaction.statusReason,
      payload: interaction.payload
    });
    return;
  }
  if (!isApprovalPendingInteractionPayload(interaction.payload)) return;
  const subject = interaction.payload.subject;
  const approvalResolution =
    interaction.resolution && 'decision' in interaction.resolution
      ? interaction.resolution
      : null;
  if (subject.kind === 'permission_grant') {
    appendEvent(db, hub, {
      type: 'system/permissionGrant/lifecycle',
      threadId: interaction.threadId,
      scope: providerScope(interaction),
      interactionId: interaction.id,
      providerId: interaction.providerId,
      providerRequestId: interaction.providerRequestId,
      status: interaction.status,
      resolution: approvalResolution,
      statusReason: interaction.statusReason,
      subject
    });
    return;
  }
  if (subject.kind === 'plan') return;
  const status = interaction.status === 'interrupted' || interaction.status === 'resolved'
    ? interaction.status === 'interrupted' ? 'interrupted' : 'completed'
    : 'pending';
  const approvalStatus = interaction.status === 'resolved' && approvalResolution?.decision === 'deny'
    ? 'denied'
    : interaction.status === 'pending' || interaction.status === 'resolving'
      ? 'waiting_for_approval'
      : null;
  if (subject.kind === 'command') {
    appendEvent(db, hub, {
      type: status === 'pending' ? 'item/started' : 'item/completed',
      threadId: interaction.threadId,
      providerThreadId: interaction.providerThreadId,
      scope: providerScope(interaction),
      item: {
        type: 'commandExecution',
        id: subject.itemId,
        command: subject.command,
        cwd: subject.cwd ?? '',
        status,
        approvalStatus
      }
    });
    return;
  }
  appendEvent(db, hub, {
    type: status === 'pending' ? 'item/started' : 'item/completed',
    threadId: interaction.threadId,
    providerThreadId: interaction.providerThreadId,
    scope: providerScope(interaction),
    item: {
      type: 'fileChange',
      id: subject.itemId,
      changes: [],
      status,
      approvalStatus
    }
  });
}
