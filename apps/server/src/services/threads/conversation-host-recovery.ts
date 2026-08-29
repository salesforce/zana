import {
  appendConversationThreadEvent,
  getConversationThread,
  getEnvironment,
  listConversationThreadEventsWindow,
  listLiveConversationThreadsForHost,
  updateConversationThreadStatus,
  type ConversationThreadEventRow,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  threadEventSchema,
  threadScope,
  turnScope,
  type SystemThreadInterruptedReason,
  type ThreadEvent
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHub } from '../../http/product-hub.js';

/** Newest-first window used to find an open turn after a host restart. */
export const HOST_RECOVERY_TURN_SCAN_CAP = 80;

export function shouldInterruptLiveThreadsOnNewHostInstance(
  previousInstanceId: string | null | undefined,
  nextInstanceId: string
): boolean {
  return previousInstanceId !== nextInstanceId;
}

interface OpenTurn {
  turnId: string;
  providerThreadId: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function eventTypeOf(payload: Record<string, unknown>): string | null {
  return typeof payload.type === 'string' ? payload.type : null;
}

function turnIdOf(payload: Record<string, unknown>): string | null {
  const scope = asRecord(payload.scope);
  if (!scope || scope.kind !== 'turn' || typeof scope.turnId !== 'string') return null;
  const turnId = scope.turnId.trim();
  return turnId.length > 0 ? turnId : null;
}

function providerThreadIdOf(payload: Record<string, unknown>): string | null {
  if (typeof payload.providerThreadId !== 'string') return null;
  const trimmed = payload.providerThreadId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function payloadRecord(row: ConversationThreadEventRow): Record<string, unknown> | null {
  const payload = asRecord(row.payload);
  if (!payload) return null;
  const nested = asRecord(payload.event);
  return nested ?? payload;
}

export function findOpenConversationTurn(
  db: ZccDatabase,
  threadId: string
): OpenTurn | null {
  const rows = listConversationThreadEventsWindow(db, threadId, { limit: HOST_RECOVERY_TURN_SCAN_CAP });
  const completed = new Set<string>();
  let latestStarted: OpenTurn | null = null;
  for (const row of rows) {
    const payload = payloadRecord(row);
    if (!payload) continue;
    const type = eventTypeOf(payload) ?? row.type;
    const turnId = turnIdOf(payload);
    if (!turnId) continue;
    if (type === 'turn/completed') completed.add(turnId);
    if (type === 'turn/started') {
      latestStarted = {
        turnId,
        providerThreadId: providerThreadIdOf(payload)
      };
    }
  }
  if (!latestStarted || completed.has(latestStarted.turnId)) return null;
  return latestStarted;
}

function parseThreadEvent(value: unknown): ThreadEvent | null {
  const parsed = threadEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function appendRecoveredEvent(
  db: ZccDatabase,
  threadId: string,
  value: unknown
): ConversationThreadEventRow | null {
  const event = parseThreadEvent(value);
  if (!event) return null;
  return appendConversationThreadEvent(db, {
    threadId,
    type: event.type,
    payload: event
  });
}

function threadListView(db: ZccDatabase, thread: ConversationThreadRow) {
  const environment = thread.environmentId ? getEnvironment(db, thread.environmentId) : null;
  return {
    ...thread,
    cwd: environment?.path ?? null,
    branchName: environment?.branchName ?? null,
    isWorktree: environment?.isWorktree ?? false
  };
}

function emitRecoveredEvent(
  hub: ProductHub,
  stored: ConversationThreadEventRow
): void {
  hub.emit('threads:event', {
    threadId: stored.threadId,
    sequence: stored.sequence,
    kind: 'thread.event',
    type: stored.type,
    payload: stored.payload
  });
}

export interface InterruptLiveConversationThreadsForHostArgs {
  hostId: string;
  reason?: SystemThreadInterruptedReason;
}

export function interruptLiveConversationThreadsForHost(
  db: ZccDatabase,
  hub: ProductHub,
  args: InterruptLiveConversationThreadsForHostArgs
): ConversationThreadRow[] {
  const reason = args.reason ?? 'host-daemon-restarted';
  const live = listLiveConversationThreadsForHost(db, args.hostId);
  if (live.length === 0) return [];

  const interrupted: ConversationThreadRow[] = [];
  const storedEvents: ConversationThreadEventRow[] = [];
  db.transaction(() => {
    for (const thread of live) {
      const openTurn = findOpenConversationTurn(db, thread.id);
      if (openTurn) {
        const completed = appendRecoveredEvent(db, thread.id, {
          type: 'turn/completed',
          threadId: thread.id,
          scope: turnScope(openTurn.turnId),
          providerThreadId: openTurn.providerThreadId,
          status: 'interrupted'
        });
        if (completed) storedEvents.push(completed);
      }
      if (reason === 'host-daemon-restarted') {
        const failed = appendRecoveredEvent(db, thread.id, {
          type: 'system/error',
          threadId: thread.id,
          scope: openTurn ? turnScope(openTurn.turnId) : threadScope(),
          code: 'thread_command_failed',
          message: 'Thread interrupted because the host daemon disconnected',
          detail: 'Please retry the thread to continue.'
        });
        if (failed) storedEvents.push(failed);
      }
      const stopped = appendRecoveredEvent(db, thread.id, {
        type: 'system/thread/interrupted',
        threadId: thread.id,
        scope: threadScope(),
        reason
      });
      if (stopped) storedEvents.push(stopped);
      const next = updateConversationThreadStatus(db, thread.id, 'error')
        ?? getConversationThread(db, thread.id);
      if (next) interrupted.push(next);
    }
  });

  for (const stored of storedEvents) emitRecoveredEvent(hub, stored);
  for (const thread of interrupted) {
    hub.emit('threads:updated', threadListView(db, thread));
  }
  return interrupted;
}
