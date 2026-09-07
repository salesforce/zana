import {
  appendConversationThreadEvent,
  getConversationThread,
  getEnvironment,
  listConversationThreadEventsWindow,
  listLiveConversationThreadsForHost,
  applyConversationThreadLifecycleEvent,
  type ConversationThreadEventRow,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { settleDanglingBackgroundTasks } from './conversation-background-task-reconciliation.js';
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
  threadIds?: readonly string[];
}

export function interruptLiveConversationThreadsForHost(
  db: ZccDatabase,
  hub: ProductHub,
  args: InterruptLiveConversationThreadsForHostArgs
): ConversationThreadRow[] {
  const reason = args.reason ?? 'host-daemon-restarted';
  const allowed = args.threadIds ? new Set(args.threadIds) : null;
  const live = listLiveConversationThreadsForHost(db, args.hostId).filter((thread) => {
    return allowed ? allowed.has(thread.id) : true;
  });
  if (live.length === 0) {
    settleDanglingBackgroundTasks({ db, hub }, { hostId: args.hostId });
    return [];
  }

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
      if (reason === 'host-daemon-restarted') {
        applyConversationThreadLifecycleEvent(db, {
          threadId: thread.id,
          event: { type: 'run.failed' }
        });
      } else {
        const current = getConversationThread(db, thread.id) ?? thread;
        if (current.status === 'active' || current.status === 'starting') {
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
      const next = getConversationThread(db, thread.id);
      if (next) interrupted.push(next);
    }
  });

  for (const stored of storedEvents) emitRecoveredEvent(hub, stored);
  for (const thread of interrupted) {
    hub.emit('threads:updated', threadListView(db, thread));
  }
  settleDanglingBackgroundTasks({ db, hub }, { hostId: args.hostId });
  return interrupted;
}

/** After disconnect grace: active/starting become error; stopping settles idle. */
export function healDisconnectedConversationThreadsForHost(
  db: ZccDatabase,
  hub: ProductHub,
  hostId: string
): ConversationThreadRow[] {
  const live = listLiveConversationThreadsForHost(db, hostId);
  const runningIds = live
    .filter((thread) => thread.status === 'active' || thread.status === 'starting')
    .map((thread) => thread.id);
  const healed = runningIds.length > 0
    ? interruptLiveConversationThreadsForHost(db, hub, {
      hostId,
      reason: 'host-daemon-restarted',
      threadIds: runningIds
    })
    : [];
  const settled: ConversationThreadRow[] = [];
  for (const thread of live.filter((row) => row.status === 'stopping')) {
    const storedEvents: ConversationThreadEventRow[] = [];
    db.transaction(() => {
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
      applyConversationThreadLifecycleEvent(db, {
        threadId: thread.id,
        event: { type: 'stop.settled' }
      });
    });
    for (const stored of storedEvents) emitRecoveredEvent(hub, stored);
    const next = getConversationThread(db, thread.id);
    if (next) {
      hub.emit('threads:updated', threadListView(db, next));
      settled.push(next);
    }
  }
  settleDanglingBackgroundTasks({ db, hub }, { hostId });
  return [...healed, ...settled];
}

