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

/** True when the provider can clone a session (`thread/fork`) rather than start blank. */
export function canCloneProviderSession(forkCapability: ProviderFork | undefined): boolean {
  return forkCapability === 'tip' || forkCapability === 'checkpoint';
}

/** Newest-kept character budget for a transcript-only fork seed (Rule 5). */
export const FORK_TRANSCRIPT_SEED_MAX_CHARS = 24_000;

export const FORK_TRANSCRIPT_SEED_PREFIX = 'Prior conversation:\n\n';

const TRANSCRIPT_TRUNCATION_MARK = '…(earlier conversation omitted)\n\n';

function visibleRequestedText(payload: unknown): string | null {
  const input = payloadRecord(payload)?.input;
  if (!Array.isArray(input)) return null;
  const texts: string[] = [];
  for (const part of input) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const item = part as { type?: unknown; text?: unknown; visibility?: unknown };
    if (item.visibility === 'agent-only') continue;
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      texts.push(item.text.trim());
    }
  }
  return texts.length > 0 ? texts.join('\n') : null;
}

function agentMessageText(payload: unknown): string | null {
  const item = payloadRecord(payload)?.item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as { type?: unknown; text?: unknown };
  if (record.type === 'agentMessage' && typeof record.text === 'string' && record.text.trim()) {
    return record.text.trim();
  }
  return null;
}

function capNewestTranscript(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  const keep = body.slice(Math.max(0, body.length - maxChars));
  const cut = keep.indexOf('\n\n');
  const tail = cut >= 0 ? keep.slice(cut + 2) : keep;
  return `${TRANSCRIPT_TRUNCATION_MARK}${tail}`;
}

export interface ForkTranscriptSeed {
  type: 'text';
  text: string;
  mentions: [];
  visibility: 'agent-only';
}

/**
 * Agent-only context for a fork whose provider cannot clone the source session.
 * Copied events still render in the UI; this is what the new session actually sees.
 */
export function buildForkTranscriptSeed(
  rows: readonly ConversationThreadEventRow[],
  maxChars = FORK_TRANSCRIPT_SEED_MAX_CHARS
): ForkTranscriptSeed | null {
  const segments: string[] = [];
  for (const row of rows) {
    if (row.type === 'client/turn/requested') {
      const text = visibleRequestedText(row.payload);
      if (text) segments.push(`User:\n${text}`);
      continue;
    }
    if (row.type === 'item/completed') {
      const text = agentMessageText(row.payload);
      if (text) segments.push(`Assistant:\n${text}`);
    }
  }
  if (segments.length === 0) return null;
  return {
    type: 'text',
    text: `${FORK_TRANSCRIPT_SEED_PREFIX}${capNewestTranscript(segments.join('\n\n'), maxChars)}`,
    mentions: [],
    visibility: 'agent-only'
  };
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
  if (!canCloneProviderSession(forkCapability)) return null;
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
