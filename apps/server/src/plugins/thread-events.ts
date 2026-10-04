import {
  appendConversationThreadEvent,
  getConversationThread,
  listConversationThreadEventsWindow,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import { randomUUID } from 'node:crypto';
import {
  PLUGIN_THREAD_EVENT_SCHEMA_VERSION,
  type PluginSdkThreadSummary,
  type PluginThreadEvent,
  type PluginThreadEventInput
} from '@zana-ai/zcc-plugin-sdk/server';
import type { ProductHttpContext } from '../http/product-context.js';

export const DISPATCH_OVERRIDE_AUDIT_EVENT_TYPE = 'dispatch/override/audited';

/**
 * Redacted record of a human "send now" override of a non-overrideable-false
 * dispatch wait. No prompt/args/results — only identity, lineage, and outcome.
 */
export interface DispatchOverrideAuditEvent {
  dispatchId: string;
  threadId: string;
  projectId: string;
  overriddenBy: string;
  pluginId?: string;
  reason?: string;
  priorGeneration: number;
  timestamp: number;
  outcome: 'accepted' | 'stale';
}

export const PLUGIN_LIFECYCLE_TEXT_MAX_CHARS = 4_096;
let lifecycleSequence = 0;

export function threadSummary(row: ConversationThreadRow): PluginSdkThreadSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    hostId: row.hostId,
    environmentId: row.environmentId,
    providerId: row.providerId,
    status: row.status,
    originKind: row.originKind,
    originPluginId: row.originPluginId,
    visibility: row.visibility,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    parentThreadId: row.parentThreadId,
    title: row.title,
    titleFallback: null,
    updatedAt: row.updatedAt,
    deletedAt: null
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

export function conversationThreadOutput(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string
): { output: string } {
  return {
    output: lastMatchingText(
      ctx,
      threadId,
      (type) => type !== 'client/turn/requested' && !type.startsWith('system/')
    ) ?? ''
  };
}

export function enrichPluginThreadEvent(
  ctx: Pick<ProductHttpContext, 'db'>,
  event: PluginThreadEventInput
): PluginThreadEventInput {
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

function redactAndBoundLifecycleText(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  const redacted = value
    .replace(/\b(?:api[_-]?key|token|secret|password|authorization|cookie)\b\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '[redacted]')
    .replace(/\bhttps?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[redacted]@');
  return redacted.length <= PLUGIN_LIFECYCLE_TEXT_MAX_CHARS
    ? redacted
    : `${redacted.slice(0, PLUGIN_LIFECYCLE_TEXT_MAX_CHARS)}…`;
}

/**
 * Build the only lifecycle shape delivered to plugins. This intentionally
 * projects known fields so callers cannot smuggle unbounded or secret payloads
 * through an object cast.
 */
export function emitHardenedLifecycle(event: PluginThreadEventInput): PluginThreadEvent {
  lifecycleSequence += 1;
  return {
    id: randomUUID(),
    schemaVersion: PLUGIN_THREAD_EVENT_SCHEMA_VERSION,
    sequence: lifecycleSequence,
    timestamp: Date.now(),
    name: event.name,
    threadId: event.threadId,
    ...(event.projectId !== undefined ? { projectId: event.projectId } : {}),
    ...(event.thread !== undefined ? { thread: event.thread } : {}),
    ...(event.lastAssistantText !== undefined
      ? { lastAssistantText: redactAndBoundLifecycleText(event.lastAssistantText) }
      : {}),
    ...(event.error !== undefined ? { error: redactAndBoundLifecycleText(event.error) } : {}),
    ...(event.providerId !== undefined ? { providerId: event.providerId } : {}),
    ...(event.model !== undefined ? { model: event.model } : {}),
    ...(event.reasoningLevel !== undefined ? { reasoningLevel: event.reasoningLevel } : {}),
    ...(event.executionState !== undefined ? { executionState: event.executionState } : {}),
    ...(event.hadAttachments !== undefined ? { hadAttachments: event.hadAttachments } : {})
  };
}

/** Fan thread lifecycle out to live plugins. Failures must not wedge the thread. */
export function emitPluginThreadEvent(ctx: ProductHttpContext, event: PluginThreadEventInput): void {
  const enriched = ctx.db ? enrichPluginThreadEvent(ctx, event) : event;
  const hardened = emitHardenedLifecycle(enriched);
  void ctx.plugins?.emitThreadEvent(hardened).catch((error) => {
    console.error('[plugins] emitThreadEvent failed', error);
  });
}

/** Persist + fan out a redacted audit trail entry for a dispatch-admission override. Never throws. */
export function emitDispatchOverrideAudit(
  ctx: ProductHttpContext,
  event: DispatchOverrideAuditEvent
): void {
  try {
    const stored = appendConversationThreadEvent(ctx.db, {
      threadId: event.threadId,
      type: DISPATCH_OVERRIDE_AUDIT_EVENT_TYPE,
      payload: event
    });
    ctx.hub.emit('threads:event', {
      threadId: event.threadId,
      sequence: stored.sequence,
      kind: 'thread.event',
      type: stored.type,
      payload: stored.payload
    });
  } catch (error) {
    console.error('[plugins] dispatch override audit emit failed', error);
  }
}

/** Applied root-turn transitions from the host must reach the same plugin bus as UI actions. */
export function emitPluginThreadStatus(ctx: ProductHttpContext, thread: Pick<ConversationThreadRow, 'id' | 'projectId' | 'status'>): void {
  const name = thread.status === 'idle' ? 'thread.idle' : thread.status === 'error' ? 'thread.failed' : thread.status === 'active' ? 'thread.active' : null;
  if (name) emitPluginThreadEvent(ctx, { name, threadId: thread.id, projectId: thread.projectId });
}
