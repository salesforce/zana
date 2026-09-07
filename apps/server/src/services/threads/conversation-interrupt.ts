import {
  appendConversationThreadEvent,
  applyConversationThreadLifecycleEvent,
  getConversationThread,
  listConversationThreadEventsWindow,
  type ConversationThreadEventRow,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  threadEventSchema,
  threadScope,
  turnScope,
  type SystemThreadInterruptedReason,
  type ThreadEvent,
  type ThreadLifecycleEvent
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHub } from '../../http/product-hub.js';
import { findOpenConversationTurn, HOST_RECOVERY_TURN_SCAN_CAP } from './conversation-host-recovery.js';
import { settleDanglingBackgroundTasksForStoppedThread } from './conversation-background-task-reconciliation.js';

function parseThreadEvent(value: unknown): ThreadEvent | null {
  const parsed = threadEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function appendEvent(
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

function emitStored(hub: ProductHub, stored: ConversationThreadEventRow): void {
  hub.emit('threads:event', {
    threadId: stored.threadId,
    sequence: stored.sequence,
    kind: 'thread.event',
    type: stored.type,
    payload: stored.payload
  });
}

function payloadType(row: ConversationThreadEventRow): string | null {
  const payload = row.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return row.type;
  const record = payload as { type?: unknown; event?: { type?: unknown } };
  if (typeof record.type === 'string') return record.type;
  if (record.event && typeof record.event.type === 'string') return record.event.type;
  return row.type;
}

function alreadyInterrupted(db: ZccDatabase, threadId: string): boolean {
  const rows = listConversationThreadEventsWindow(db, threadId, { limit: HOST_RECOVERY_TURN_SCAN_CAP });
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const type = payloadType(rows[i]!);
    if (type === 'system/thread/interrupted') return true;
    if (type === 'turn/started') return false;
  }
  return false;
}

function applySettleEvent(
  db: ZccDatabase,
  thread: ConversationThreadRow,
  reason: SystemThreadInterruptedReason
): void {
  if (reason === 'host-daemon-restarted') {
    applyConversationThreadLifecycleEvent(db, {
      threadId: thread.id,
      event: { type: 'run.failed' }
    });
    return;
  }
  if (thread.status === 'active' || thread.status === 'starting') {
    applyConversationThreadLifecycleEvent(db, {
      threadId: thread.id,
      event: { type: 'stop.requested' }
    });
  }
  applyConversationThreadLifecycleEvent(db, {
    threadId: thread.id,
    event: { type: 'stop.settled' }
  });
}

export function appendStopRequestedEvent(
  db: ZccDatabase,
  hub: ProductHub,
  threadId: string
): ConversationThreadEventRow | null {
  const stored = appendEvent(db, threadId, {
    type: 'system/operation',
    threadId,
    scope: threadScope(),
    operation: 'thread.stop',
    status: 'started',
    message: 'Stop requested',
    operationId: `stop:${threadId}`
  });
  if (stored) emitStored(hub, stored);
  return stored;
}

export function finalizeInterruptedConversation(
  db: ZccDatabase,
  hub: ProductHub,
  args: {
    threadId: string;
    reason?: SystemThreadInterruptedReason;
    settleEvent?: ThreadLifecycleEvent;
  }
): ConversationThreadRow | null {
  const thread = getConversationThread(db, args.threadId);
  if (!thread) return null;
  const reason = args.reason ?? 'manual-stop';
  const storedEvents: ConversationThreadEventRow[] = [];
  db.transaction(() => {
    const openTurn = findOpenConversationTurn(db, thread.id);
    if (openTurn) {
      const completed = appendEvent(db, thread.id, {
        type: 'turn/completed',
        threadId: thread.id,
        scope: turnScope(openTurn.turnId),
        providerThreadId: openTurn.providerThreadId,
        status: 'interrupted'
      });
      if (completed) storedEvents.push(completed);
    }
    if (!alreadyInterrupted(db, thread.id)) {
      const stopped = appendEvent(db, thread.id, {
        type: 'system/thread/interrupted',
        threadId: thread.id,
        scope: threadScope(),
        reason
      });
      if (stopped) storedEvents.push(stopped);
    }
    if (args.settleEvent) {
      applyConversationThreadLifecycleEvent(db, {
        threadId: thread.id,
        event: args.settleEvent
      });
    } else {
      applySettleEvent(db, getConversationThread(db, thread.id) ?? thread, reason);
    }
  });

  for (const stored of storedEvents) emitStored(hub, stored);
  settleDanglingBackgroundTasksForStoppedThread({ db, hub }, { threadId: thread.id });
  return getConversationThread(db, thread.id) ?? thread;
}
