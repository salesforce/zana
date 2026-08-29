import {
  getConversationThread,
  listConversationThreadEventsWindow,
  setConversationProviderThreadId,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';

/** Newest-first scan cap when recovering a missing provider session from stored events. */
export const PROVIDER_IDENTITY_SCAN_CAP = 80;

export function providerThreadIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as { providerThreadId?: unknown }).providerThreadId;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function rememberConversationProviderThreadId(
  db: ZccDatabase,
  threadId: string,
  providerThreadId: string
): ConversationThreadRow | null {
  const trimmed = providerThreadId.trim();
  if (!trimmed) return getConversationThread(db, threadId);
  const current = getConversationThread(db, threadId);
  if (!current) return null;
  if (current.providerThreadId === trimmed) return current;
  return setConversationProviderThreadId(db, threadId, trimmed);
}

export function recoverConversationProviderThreadId(
  db: ZccDatabase,
  thread: ConversationThreadRow
): ConversationThreadRow {
  if (thread.providerThreadId) return thread;
  const events = listConversationThreadEventsWindow(db, thread.id, { limit: PROVIDER_IDENTITY_SCAN_CAP });
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const providerThreadId = providerThreadIdFromPayload(events[i]?.payload);
    if (!providerThreadId) continue;
    return rememberConversationProviderThreadId(db, thread.id, providerThreadId)
      ?? { ...thread, providerThreadId };
  }
  return thread;
}
