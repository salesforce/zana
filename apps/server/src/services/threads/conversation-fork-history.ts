import {
  copyConversationThreadEvents,
  listConversationThreadEvents,
  type ConversationThreadEventRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProviderFork } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';

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

function checkpointFromPayload(payload: unknown): string | null {
  const record = payloadRecord(payload);
  if (!record) return null;
  if (typeof record.providerCheckpointId === 'string' && record.providerCheckpointId.trim()) {
    return record.providerCheckpointId.trim();
  }
  if (record.event && record.event !== payload) return checkpointFromPayload(record.event);
  if (record.payload && record.payload !== payload) return checkpointFromPayload(record.payload);
  return null;
}

function latestCheckpoint(
  rows: readonly ConversationThreadEventRow[]
): { sequence: number; checkpoint: string } | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    const checkpoint = checkpointFromPayload(row.payload);
    if (checkpoint) return { sequence: row.sequence, checkpoint };
  }
  return null;
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

export interface ConversationForkDescriptor {
  sourceProviderThreadId: string;
  sourceProviderCheckpointId?: string;
}

function providerThreadIdFromPayload(payload: unknown): string | null {
  const record = payloadRecord(payload);
  return typeof record?.providerThreadId === 'string' && record.providerThreadId.trim()
    ? record.providerThreadId.trim()
    : null;
}

function lastCompletedRow(
  rows: readonly ConversationThreadEventRow[],
  atOrBefore?: number
): ConversationThreadEventRow | null {
  const cap = atOrBefore ?? Number.POSITIVE_INFINITY;
  let last: ConversationThreadEventRow | null = null;
  for (const row of rows) {
    if (row.type === 'turn/completed' && row.sequence <= cap) last = row;
  }
  return last;
}

function forkPointUnavailable(message: string): never {
  throw new ThreadCreateError(409, 'fork_source_session_unavailable', message);
}

/**
 * Where a fork branches off its source. `sourceSeqEnd` on a tip-only provider
 * that is not the latest completed turn is unavailable: the clone would keep
 * turns the caller asked to leave out.
 */
export function resolveConversationForkPoint(args: {
  events: readonly ConversationThreadEventRow[];
  forkCapability: ProviderFork | undefined;
  sourceProviderThreadId: string | null;
  sourceSeqEnd?: number;
}): ConversationForkDescriptor | null {
  const { events, forkCapability, sourceSeqEnd } = args;
  if (sourceSeqEnd !== undefined) {
    const completion = lastCompletedRow(events, sourceSeqEnd);
    if (!completion) {
      forkPointUnavailable(
        `Cannot fork at sequence ${sourceSeqEnd}: no turn has completed at or before it`
      );
    }
    const latest = lastCompletedRow(events);
    const anchorIsTip = latest?.sequence === completion.sequence;
    const sourceProviderThreadId = providerThreadIdFromPayload(completion.payload)
      ?? args.sourceProviderThreadId;
    if (!sourceProviderThreadId) {
      forkPointUnavailable(
        `Cannot fork at sequence ${sourceSeqEnd}: the turn containing it has no provider session`
      );
    }
    if (forkCapability !== 'checkpoint' && !anchorIsTip) {
      forkPointUnavailable(
        'This provider can only fork at the end of a session, not from an earlier point in it'
      );
    }
    if (forkCapability === 'checkpoint') {
      const checkpoint = latestCheckpoint(
        events.filter((row) => row.sequence <= completion.sequence)
      );
      if (!checkpoint) {
        forkPointUnavailable(
          `Cannot fork at sequence ${sourceSeqEnd}: the turn containing it recorded no provider checkpoint`
        );
      }
      return {
        sourceProviderThreadId,
        sourceProviderCheckpointId: checkpoint.checkpoint
      };
    }
    return { sourceProviderThreadId };
  }

  const lastCompletion = lastCompletedRow(events);
  const sourceProviderThreadId = lastCompletion
    ? providerThreadIdFromPayload(lastCompletion.payload) ?? args.sourceProviderThreadId
    : args.sourceProviderThreadId;
  if (!sourceProviderThreadId) return null;
  if (forkCapability !== 'checkpoint' || lastCompletion == null) {
    return { sourceProviderThreadId };
  }
  const hasLaterStartedTurn = events.some(
    (row) => row.type === 'turn/started' && row.sequence > lastCompletion.sequence
  );
  if (!hasLaterStartedTurn) return { sourceProviderThreadId };
  const checkpoint = latestCheckpoint(
    events.filter((row) => row.sequence <= lastCompletion.sequence)
  );
  return checkpoint
    ? { sourceProviderThreadId, sourceProviderCheckpointId: checkpoint.checkpoint }
    : { sourceProviderThreadId };
}

/**
 * Infer the clone point from history already copied onto a fork: the last
 * inherited `turn/completed` still carries the source session id and checkpoint.
 */
export function describeCopiedForkStart(
  events: readonly ConversationThreadEventRow[],
  forkCapability: ProviderFork | undefined
): ConversationForkDescriptor | null {
  const completion = lastCompletedRow(events);
  if (!completion) return null;
  const sourceProviderThreadId = providerThreadIdFromPayload(completion.payload);
  if (!sourceProviderThreadId) return null;
  if (forkCapability !== 'checkpoint') return { sourceProviderThreadId };
  const checkpoint = latestCheckpoint(events);
  return checkpoint
    ? { sourceProviderThreadId, sourceProviderCheckpointId: checkpoint.checkpoint }
    : { sourceProviderThreadId };
}
