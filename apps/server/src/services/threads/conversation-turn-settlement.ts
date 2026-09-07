import {
  appendConversationThreadEvent,
  getConversationThread,
  listConversationThreadEventsWindow,
  type ConversationThreadEventRow,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import {
  threadEventSchema,
  threadScope,
  type ThreadEvent
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { emitPluginThreadEvent } from '../../plugins/thread-events.js';
import { applyLoggedConversationLifecycleEvent } from './conversation-lifecycle-outcome.js';
import { findOpenConversationTurn, HOST_RECOVERY_TURN_SCAN_CAP } from './conversation-host-recovery.js';

export { startLiveTurnCommand } from './conversation-live-turn.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function payloadRecord(row: ConversationThreadEventRow): Record<string, unknown> | null {
  const payload = asRecord(row.payload);
  if (!payload) return null;
  return asRecord(payload.event) ?? payload;
}

function eventTypeOf(row: ConversationThreadEventRow): string {
  const payload = payloadRecord(row);
  return typeof payload?.type === 'string' ? payload.type : row.type;
}

function requestIdOf(payload: Record<string, unknown>): string | null {
  if (typeof payload.requestId === 'string' && payload.requestId.length > 0) return payload.requestId;
  if (typeof payload.clientRequestId === 'string' && payload.clientRequestId.length > 0) {
    return payload.clientRequestId;
  }
  return null;
}

function parentToolCallIdOf(payload: Record<string, unknown>): string | null {
  if (typeof payload.parentToolCallId !== 'string') return null;
  const trimmed = payload.parentToolCallId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function turnIdOf(payload: Record<string, unknown>): string | null {
  const scope = asRecord(payload.scope);
  if (!scope || scope.kind !== 'turn' || typeof scope.turnId !== 'string') return null;
  const turnId = scope.turnId.trim();
  return turnId.length > 0 ? turnId : null;
}

function emitStored(ctx: ProductHttpContext, stored: ConversationThreadEventRow): void {
  ctx.hub.emit('threads:event', {
    threadId: stored.threadId,
    sequence: stored.sequence,
    kind: 'thread.event',
    type: stored.type,
    payload: stored.payload
  });
}

function appendParsedEvent(
  ctx: ProductHttpContext,
  threadId: string,
  value: unknown
): ConversationThreadEventRow | null {
  const parsed = threadEventSchema.safeParse(value);
  if (!parsed.success) return null;
  const event = parsed.data as ThreadEvent;
  const stored = appendConversationThreadEvent(ctx.db, {
    threadId,
    type: event.type,
    payload: event
  });
  emitStored(ctx, stored);
  return stored;
}

export function hasTerminalClientTurnRequestEvent(
  ctx: Pick<ProductHttpContext, 'db'>,
  args: { threadId: string; requestId: string }
): boolean {
  const rows = listConversationThreadEventsWindow(ctx.db, args.threadId, {
    limit: HOST_RECOVERY_TURN_SCAN_CAP
  });
  for (const row of rows) {
    const type = eventTypeOf(row);
    if (type !== 'turn/input/accepted' && type !== 'client/turn/rejected') continue;
    const payload = payloadRecord(row);
    if (!payload) continue;
    if (requestIdOf(payload) === args.requestId) return true;
  }
  return false;
}

/** True when the latest root turn already has `turn/completed`. */
export function hasLatestRootTurnCompleted(
  ctx: Pick<ProductHttpContext, 'db'>,
  threadId: string
): boolean {
  const rows = listConversationThreadEventsWindow(ctx.db, threadId, {
    limit: HOST_RECOVERY_TURN_SCAN_CAP
  });
  const completed = new Set<string>();
  let latestRootStarted: string | null = null;
  for (const row of rows) {
    const payload = payloadRecord(row);
    if (!payload) continue;
    if (parentToolCallIdOf(payload)) continue;
    const type = eventTypeOf(row);
    const turnId = turnIdOf(payload);
    if (!turnId) continue;
    if (type === 'turn/completed') completed.add(turnId);
    if (type === 'turn/started') latestRootStarted = turnId;
  }
  return latestRootStarted != null && completed.has(latestRootStarted);
}

export function failActiveConversationTurn(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow
): ConversationThreadRow {
  const outcome = applyLoggedConversationLifecycleEvent(ctx, {
    threadId: thread.id,
    event: { type: 'run.failed' }
  });
  const failed = outcome.applied ? outcome.thread : {
    ...thread,
    status: 'error' as const
  };
  emitPluginThreadEvent(ctx, {
    name: 'thread.failed',
    threadId: failed.id,
    projectId: failed.projectId
  });
  return failed;
}

function commandFailureReason(error: unknown): { reason: string; message: string } {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    const code = (error as { code: string }).code.trim() || 'live_command_failed';
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : `Command failed (${code})`;
    return { reason: code, message };
  }
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : 'Live host command failed';
  return { reason: 'live_command_failed', message };
}

export function settleLiveTurnCommandFailure(
  ctx: ProductHttpContext,
  args: {
    thread: ConversationThreadRow;
    commandType: string;
    clientRequestId?: string;
    error: unknown;
  }
): void {
  try {
    const live = getConversationThread(ctx.db, args.thread.id) ?? args.thread;
    if (args.clientRequestId && hasTerminalClientTurnRequestEvent(ctx, {
      threadId: live.id,
      requestId: args.clientRequestId
    })) {
      return;
    }
    const failure = commandFailureReason(args.error);
    if (args.clientRequestId) {
      appendParsedEvent(ctx, live.id, {
        type: 'client/turn/rejected',
        threadId: live.id,
        scope: threadScope(),
        requestId: args.clientRequestId,
        reason: failure.reason,
        message: failure.message
      });
    }
    if (hasLatestRootTurnCompleted(ctx, live.id)) {
      return;
    }
    if (findOpenConversationTurn(ctx.db, live.id)) {
      return;
    }
    appendParsedEvent(ctx, live.id, {
      type: 'system/error',
      threadId: live.id,
      scope: threadScope(),
      code: 'thread_command_failed',
      message: `Command ${args.commandType} failed`,
      detail: failure.message
    });
    failActiveConversationTurn(ctx, live);
  } catch {
    /* Teardown may close the DB while a background RPC is still settling. */
  }
}
