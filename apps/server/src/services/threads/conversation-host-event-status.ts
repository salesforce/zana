import type { ThreadLifecycleEvent } from '@zana-ai/zcc-domain/thread-runtime';

function payloadEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('type' in payload)) return null;
  return String((payload as { type: unknown }).type);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  if (!record) return null;
  return asRecord(record.event) ?? record;
}

function isInFlightRetryPayload(payload: unknown): boolean {
  const record = payloadRecord(payload);
  if (!record) return false;
  if (record.type === 'provider/error') return record.willRetry === true;
  if (record.type === 'system/error') return typeof record.reconnectAttempt === 'number';
  return false;
}

function parentToolCallIdOf(payload: unknown): string | null {
  const record = payloadRecord(payload);
  if (typeof record?.parentToolCallId !== 'string') return null;
  const trimmed = record.parentToolCallId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function turnIdOf(payload: unknown): string | null {
  const record = payloadRecord(payload);
  const scope = asRecord(record?.scope);
  if (!scope || scope.kind !== 'turn' || typeof scope.turnId !== 'string') return null;
  const turnId = scope.turnId.trim();
  return turnId.length > 0 ? turnId : null;
}

function turnCompletionStatus(payload: unknown): 'completed' | 'failed' | 'interrupted' {
  const record = payloadRecord(payload);
  if (record?.status === 'failed' || record?.status === 'interrupted') return record.status;
  return 'completed';
}

export function isNestedConversationTurnCompletion(
  payload: unknown,
  recentEvents: readonly { type: string; payload?: unknown }[]
): boolean {
  if (parentToolCallIdOf(payload)) return true;
  const turnId = turnIdOf(payload);
  if (!turnId) return false;
  for (const row of recentEvents) {
    const record = payloadRecord(row.payload);
    const type = typeof record?.type === 'string' ? record.type : row.type;
    if (type !== 'turn/started') continue;
    if (turnIdOf(row.payload) !== turnId) continue;
    return parentToolCallIdOf(row.payload) !== null;
  }
  return false;
}

/** Map a host event onto a lifecycle event. Retrying errors stay null
 *  (thread remains active). Nested/tool completions stay timeline evidence. */
export function conversationLifecycleEventForHostEvent(event: {
  kind: string;
  payload?: unknown;
  nestedTurn?: boolean;
}): ThreadLifecycleEvent | null {
  if (isInFlightRetryPayload(event.payload)) return null;
  const eventType = payloadEventType(event.payload);
  if (eventType === 'turn/started') {
    return parentToolCallIdOf(event.payload) ? null : { type: 'run.started' };
  }
  if (event.kind === 'thread.started') return { type: 'run.started' };
  if (event.kind === 'turn.completed' || eventType === 'turn/completed') {
    if (event.nestedTurn) return null;
    return turnCompletionStatus(event.payload) === 'failed'
      ? { type: 'run.failed' }
      : { type: 'run.succeeded' };
  }
  return null;
}
