function payloadEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('type' in payload)) return null;
  return String((payload as { type: unknown }).type);
}

function isInFlightRetryPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as { type?: unknown; willRetry?: unknown; reconnectAttempt?: unknown };
  if (record.type === 'provider/error') return record.willRetry === true;
  if (record.type === 'system/error') return typeof record.reconnectAttempt === 'number';
  return false;
}

/** Map a host event onto conversation-thread status. Retrying errors stay active. */
export function conversationStatusForHostEvent(event: {
  kind: string;
  payload?: unknown;
}): 'active' | 'idle' | 'error' | null {
  const eventType = payloadEventType(event.payload);
  if (isInFlightRetryPayload(event.payload)) return 'active';
  if (event.kind === 'thread.started' || eventType === 'turn/started') return 'active';
  if (event.kind === 'turn.completed' || eventType === 'turn/completed') return 'idle';
  if (event.kind === 'turn.failed' || eventType === 'turn/failed') return 'error';
  return null;
}
