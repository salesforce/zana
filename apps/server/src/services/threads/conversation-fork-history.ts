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
  rows: readonly ConversationThreadEventRow[],
  atOrBefore?: number
): number | null {
  const cap = atOrBefore ?? Number.POSITIVE_INFINITY;
  let last: number | null = null;
  for (const row of rows) {
    if (row.type === 'turn/completed' && row.sequence <= cap) last = row.sequence;
  }
  return last;
}

function historyEndSequenceForFork(
  rows: readonly ConversationThreadEventRow[],
  sourceSeqEnd?: number
): number | null {
  if (sourceSeqEnd == null) return lastCompletedTurnSequence(rows);
  const atOrBefore = rows.filter((row) => row.sequence <= sourceSeqEnd);
  const last = atOrBefore[atOrBefore.length - 1];
  const turnId = last ? eventTurnId(last.payload) : null;
  if (turnId) {
    const completed = rows.find(
      (row) => row.type === 'turn/completed' && eventTurnId(row.payload) === turnId
    );
    if (completed) return completed.sequence;
  }
  return lastCompletedTurnSequence(atOrBefore);
}

/**
 * Select source rows a fork should show: completed turns only, through the
 * last `turn/completed`, plus accepted client requests. Open turns and queued
 * (unaccepted) prompts stay on the source.
 */
export function selectInheritedForkEventRows(
  rows: readonly ConversationThreadEventRow[],
  sourceSeqEnd?: number
): ConversationThreadEventRow[] {
  const historyEndSequence = historyEndSequenceForFork(rows, sourceSeqEnd);
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
  args: { sourceThreadId: string; targetThreadId: string; sourceSeqEnd?: number }
): ConversationThreadEventRow[] {
  const inherited = selectInheritedForkEventRows(
    listConversationThreadEvents(db, args.sourceThreadId),
    args.sourceSeqEnd
  );
  if (inherited.length === 0) return [];
  return copyConversationThreadEvents(db, {
    targetThreadId: args.targetThreadId,
    rows: inherited
  });
}
