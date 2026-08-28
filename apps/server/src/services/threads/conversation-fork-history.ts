import {
  copyConversationThreadEvents,
  listConversationThreadEvents,
  type ConversationThreadEventRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';

/**
 * Events that carry the conversation a fork inherits. Source bookkeeping,
 * streaming deltas, pending-interaction state, and identity rows stay on the
 * source thread.
 */
export const INHERITED_FORK_EVENT_TYPES = [
  'client/turn/requested',
  'turn/started',
  'turn/input/accepted',
  'item/completed',
  'item/backgroundTask/completed',
  'turn/completed',
  'thread/compacted',
  'system/manager/user_message'
] as const;

const inheritedTypeSet = new Set<string>(INHERITED_FORK_EVENT_TYPES);

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

export function eventTurnId(payload: unknown): string | null {
  const record = payloadRecord(payload);
  const scope = record?.scope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return null;
  const turn = scope as { kind?: unknown; turnId?: unknown };
  return turn.kind === 'turn' && typeof turn.turnId === 'string' ? turn.turnId : null;
}

function acceptedClientRequestId(payload: unknown): string | null {
  const record = payloadRecord(payload);
  return typeof record?.clientRequestId === 'string' ? record.clientRequestId : null;
}

function requestedClientRequestId(payload: unknown): string | null {
  const record = payloadRecord(payload);
  return typeof record?.requestId === 'string' ? record.requestId : null;
}

export function lastCompletedTurnSequence(
  rows: readonly ConversationThreadEventRow[]
): number | null {
  let last: number | null = null;
  for (const row of rows) {
    if (row.type === 'turn/completed') last = row.sequence;
  }
  return last;
}

/**
 * Select source rows a fork should show: completed turns only, through the
 * last `turn/completed`, plus accepted client requests. Open turns and queued
 * (unaccepted) prompts stay on the source.
 */
export function selectInheritedForkEventRows(
  rows: readonly ConversationThreadEventRow[]
): ConversationThreadEventRow[] {
  const historyEndSequence = lastCompletedTurnSequence(rows);
  if (historyEndSequence == null) return [];
  const window = rows.filter(
    (row) => row.sequence <= historyEndSequence && inheritedTypeSet.has(row.type)
  );
  const completedTurnIds = new Set<string>();
  const acceptedClientRequestIds = new Set<string>();
  for (const row of window) {
    if (row.type === 'turn/completed') {
      const turnId = eventTurnId(row.payload);
      if (turnId) completedTurnIds.add(turnId);
    } else if (row.type === 'turn/input/accepted') {
      const requestId = acceptedClientRequestId(row.payload);
      if (requestId) acceptedClientRequestIds.add(requestId);
    }
  }
  return window.filter((row) => {
    const turnId = eventTurnId(row.payload);
    if (turnId) return completedTurnIds.has(turnId);
    if (row.type !== 'client/turn/requested') return true;
    const requestId = requestedClientRequestId(row.payload);
    return requestId != null && acceptedClientRequestIds.has(requestId);
  });
}

export function copyForkSourceHistory(
  db: ZccDatabase,
  args: { sourceThreadId: string; targetThreadId: string }
): ConversationThreadEventRow[] {
  const inherited = selectInheritedForkEventRows(
    listConversationThreadEvents(db, args.sourceThreadId)
  );
  if (inherited.length === 0) return [];
  return copyConversationThreadEvents(db, {
    targetThreadId: args.targetThreadId,
    rows: inherited
  });
}
