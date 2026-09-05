import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendConversationThreadEvent,
  createConversationThread,
  createEnvironment,
  getConversationThread,
  listConversationThreadEvents,
  openDatabase,
  updateConversationThreadStatus,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { threadScope, turnScope } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHub } from '../../http/product-hub.js';
import {
  settleDanglingBackgroundTasks,
  settleDanglingBackgroundTasksForStoppedThread
} from './conversation-background-task-reconciliation.js';
import {
  healDisconnectedConversationThreadsForHost,
  interruptLiveConversationThreadsForHost
} from './conversation-host-recovery.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function openTestDb(): ZccDatabase {
  dir = mkdtempSync(join(tmpdir(), 'zcc-bg-task-'));
  db = openDatabase(join(dir, 'zcc.sqlite'));
  return db;
}

function hub(): ProductHub {
  return { emit: vi.fn() } as unknown as ProductHub;
}

function backgroundTaskItemData(args: {
  itemId: string;
  taskStatus: string;
  status: string;
}): Record<string, unknown> {
  return {
    providerThreadId: 'claude-session-1',
    item: {
      id: args.itemId,
      type: 'backgroundTask',
      taskType: 'local_workflow',
      description: 'fixture workflow',
      status: args.status,
      taskStatus: args.taskStatus,
      skipTranscript: false,
      workflowName: 'fixture-mini',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 1500 }
    }
  };
}

function seedHost(database: ZccDatabase, name = 'laptop') {
  return upsertHost(database, { name, hostKeyHash: `${name[0] ?? 'h'}`.repeat(64) });
}

function seedThread(
  database: ZccDatabase,
  hostId: string,
  over: { status?: 'starting' | 'active' | 'stopping' | 'idle' | 'error'; title?: string } = {}
) {
  const environment = createEnvironment(database, {
    projectId: 'proj-1',
    hostId,
    path: `/tmp/${over.title ?? 'thread'}`
  });
  const thread = createConversationThread(database, {
    projectId: 'proj-1',
    hostId,
    environmentId: environment.id,
    providerId: 'claude-code',
    status: over.status ?? 'idle',
    title: over.title ?? 'Live'
  });
  if (over.status && over.status !== 'starting' && over.status !== 'idle') {
    updateConversationThreadStatus(database, thread.id, over.status);
  }
  return getConversationThread(database, thread.id)!;
}

function seedOpenBackgroundTask(
  database: ZccDatabase,
  threadId: string,
  args: { itemId?: string; taskStatus?: string; status?: string } = {}
) {
  const itemId = args.itemId ?? 'task:wf-1';
  appendConversationThreadEvent(database, {
    threadId,
    type: 'turn/started',
    payload: {
      type: 'turn/started',
      threadId,
      scope: turnScope('turn-1'),
      providerThreadId: 'claude-session-1'
    }
  });
  appendConversationThreadEvent(database, {
    threadId,
    type: 'item/started',
    payload: {
      type: 'item/started',
      threadId,
      providerThreadId: 'claude-session-1',
      item: backgroundTaskItemData({
        itemId,
        status: 'pending',
        taskStatus: 'running'
      }).item
    }
  });
  appendConversationThreadEvent(database, {
    threadId,
    type: 'item/backgroundTask/progress',
    payload: {
      type: 'item/backgroundTask/progress',
      threadId,
      scope: threadScope(),
      ...backgroundTaskItemData({
        itemId,
        status: args.status ?? 'pending',
        taskStatus: args.taskStatus ?? 'running'
      })
    }
  });
  return itemId;
}

function listSettledBackgroundTaskItems(
  database: ZccDatabase,
  threadId: string
): Array<{ status: string; taskStatus: string }> {
  return listConversationThreadEvents(database, threadId)
    .filter((row) => row.type === 'item/backgroundTask/completed')
    .map((row) => {
      const payload = row.payload as { item: { status: string; taskStatus: string } };
      return { status: payload.item.status, taskStatus: payload.item.taskStatus };
    });
}

describe('settleDanglingBackgroundTasks', () => {
  it('settles open backgroundTask items as interrupted and is idempotent', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id);
    seedOpenBackgroundTask(database, thread.id);

    settleDanglingBackgroundTasks({ db: database, hub: hub() }, { hostId: host.id });

    const completed = listConversationThreadEvents(database, thread.id).filter(
      (row) => row.type === 'item/backgroundTask/completed'
    );
    expect(completed).toHaveLength(1);
    const data = completed[0]!.payload as {
      item: { status: string; taskStatus: string; workflowName: string };
    };
    expect(data.item.status).toBe('interrupted');
    expect(data.item.taskStatus).toBe('stopped');
    expect(data.item.workflowName).toBe('fixture-mini');

    settleDanglingBackgroundTasks({ db: database, hub: hub() }, { hostId: host.id });
    expect(
      listConversationThreadEvents(database, thread.id).filter(
        (row) => row.type === 'item/backgroundTask/completed'
      )
    ).toHaveLength(1);
  });

  it('does not touch already-settled tasks or other hosts', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const otherHost = seedHost(database, 'other');
    const thread = seedThread(database, host.id);
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'turn/started',
      payload: {
        type: 'turn/started',
        threadId: thread.id,
        scope: turnScope('turn-1'),
        providerThreadId: 'claude-session-1'
      }
    });
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'item/started',
      payload: {
        type: 'item/started',
        threadId: thread.id,
        providerThreadId: 'claude-session-1',
        item: backgroundTaskItemData({
          itemId: 'task:wf-done',
          status: 'pending',
          taskStatus: 'running'
        }).item
      }
    });
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'item/backgroundTask/completed',
      payload: {
        type: 'item/backgroundTask/completed',
        threadId: thread.id,
        scope: threadScope(),
        ...backgroundTaskItemData({
          itemId: 'task:wf-done',
          status: 'completed',
          taskStatus: 'completed'
        })
      }
    });

    settleDanglingBackgroundTasks({ db: database, hub: hub() }, { hostId: otherHost.id });
    settleDanglingBackgroundTasks({ db: database, hub: hub() }, { hostId: host.id });

    const completed = listConversationThreadEvents(database, thread.id).filter(
      (row) => row.type === 'item/backgroundTask/completed'
    );
    expect(completed).toHaveLength(1);
    expect((completed[0]!.payload as { item: { status: string } }).item.status).toBe('completed');
  });

  it('preserves an already-finished task status instead of stomping it to interrupted', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id);
    seedOpenBackgroundTask(database, thread.id, {
      status: 'completed',
      taskStatus: 'completed'
    });

    settleDanglingBackgroundTasks({ db: database, hub: hub() }, { hostId: host.id });

    expect(listSettledBackgroundTaskItems(database, thread.id)).toEqual([
      { status: 'completed', taskStatus: 'completed' }
    ]);
  });
});

describe('background-task lifecycle reconciliation triggers', () => {
  it('settles open tasks when a new host instance interrupts live work', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id, { status: 'idle' });
    seedOpenBackgroundTask(database, thread.id);

    interruptLiveConversationThreadsForHost(database, hub(), { hostId: host.id });

    expect(listSettledBackgroundTaskItems(database, thread.id)).toEqual([
      { status: 'interrupted', taskStatus: 'stopped' }
    ]);
  });

  it('does not settle tasks when the same daemon instance would reconnect', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id);
    seedOpenBackgroundTask(database, thread.id);

    expect(listSettledBackgroundTaskItems(database, thread.id)).toEqual([]);
    expect(getConversationThread(database, thread.id)?.status).toBe('idle');
  });

  it('settles open tasks after the disconnect grace heals the host', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id, { status: 'idle' });
    seedOpenBackgroundTask(database, thread.id);

    healDisconnectedConversationThreadsForHost(database, hub(), host.id);

    expect(listSettledBackgroundTaskItems(database, thread.id)).toEqual([
      { status: 'interrupted', taskStatus: 'stopped' }
    ]);
  });

  it('settles open tasks when a stopped thread is finalized', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id, { status: 'active' });
    seedOpenBackgroundTask(database, thread.id);

    settleDanglingBackgroundTasksForStoppedThread(
      { db: database, hub: hub() },
      { threadId: thread.id }
    );

    expect(listSettledBackgroundTaskItems(database, thread.id)).toEqual([
      { status: 'interrupted', taskStatus: 'stopped' }
    ]);
  });
});
