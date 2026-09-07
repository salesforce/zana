import {
  getConversationThread,
  listConversationThreadEventsWindow,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { PluginSdkThreadSummary, PluginThreadEvent } from '@zana-ai/zcc-plugin-sdk/server';
import type { ProductHttpContext } from '../http/product-context.js';

function threadSummary(row: ConversationThreadRow): PluginSdkThreadSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    hostId: row.hostId,
    environmentId: row.environmentId,
    providerId: row.providerId,
    status: row.status
  };
}

function textFromUnknown(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const found = textFromUnknown(value[i], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') {
    const trimmed = record.text.trim();
    if (trimmed) return trimmed;
  }
  if (typeof record.text === 'string') {
    const trimmed = record.text.trim();
    if (trimmed) return trimmed;
  }
  if (typeof record.error === 'string') {
    const trimmed = record.error.trim();
    if (trimmed) return trimmed;
  }
  if (typeof record.message === 'string' && (record.type === 'system/error' || record.kind === 'error')) {
    const trimmed = record.message.trim();
    if (trimmed) return trimmed;
  }
  for (const key of ['payload', 'event', 'item', 'output', 'content']) {
    const found = textFromUnknown(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function lastMatchingText(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string,
  match: (type: string, payload: unknown) => boolean
): string | null {
  try {
    const rows = listConversationThreadEventsWindow(ctx.db, threadId, { limit: 80 });
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i]!;
      if (!match(row.type, row.payload)) continue;
      const text = textFromUnknown(row.payload);
      if (text) return text;
    }
  } catch {
    return null;
  }
  return null;
}

export function enrichPluginThreadEvent(
  ctx: Pick<ProductHttpContext, 'db'>,
  event: PluginThreadEvent
): PluginThreadEvent {
  try {
    const row = getConversationThread(ctx.db, event.threadId);
    const thread = row ? threadSummary(row) : event.thread;
    const lastAssistantText = event.name === 'thread.idle'
      ? (event.lastAssistantText ?? lastMatchingText(
        ctx,
        event.threadId,
        (type) => type !== 'client/turn/requested' && !type.startsWith('system/')
      ))
      : event.lastAssistantText;
    const error = event.name === 'thread.failed'
      ? (event.error ?? lastMatchingText(
        ctx,
        event.threadId,
        (type) => type === 'system/error' || type === 'turn/failed' || type.includes('error')
      ))
      : event.error;
    return {
      ...event,
      ...(thread ? { thread, projectId: event.projectId ?? thread.projectId } : {}),
      ...(lastAssistantText !== undefined ? { lastAssistantText } : {}),
      ...(error !== undefined ? { error } : {})
    };
  } catch {
    return event;
  }
}

/** Fan thread lifecycle out to live plugins. Failures must not wedge the thread. */
export function emitPluginThreadEvent(ctx: ProductHttpContext, event: PluginThreadEvent): void {
  const enriched = ctx.db ? enrichPluginThreadEvent(ctx, event) : event;
  void ctx.plugins?.emitThreadEvent(enriched).catch((error) => {
    console.error('[plugins] emitThreadEvent failed', error);
  });
}
