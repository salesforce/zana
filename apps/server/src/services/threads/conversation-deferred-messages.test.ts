import { describe, expect, it, vi } from 'vitest';
import {
  deferConversationSend,
  dropDeferredConversationMessage,
  dropDeferredConversationMessages,
  flushDeferredConversationMessages,
  parseDeferredSendPayload,
  pauseConversationQueue
} from './conversation-deferred-messages.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { DEFERRED_THREAD_MESSAGE_CAP } from '@zana-ai/zcc-db';

type TestRow = {
  id: string;
  threadId: string;
  kind: string;
  payload: string;
  createdAt: number;
  status: 'queued' | 'dispatching' | 'failed';
  paused: boolean;
  sendAfter: number | null;
  failureReason: string | null;
  groupBoundaryId: string | null;
  updatedAt: number;
};

const rows: TestRow[] = [];
let queuePaused = false;
let openTurn: { turnId: string } | null = null;
let liveActiveCount = 0;
const thread = {
  id: 'thr-1',
  archivedAt: null,
  hostId: 'host-1',
  status: 'idle' as string
};

vi.mock('./conversation-host-recovery.js', () => ({
  findOpenConversationTurn: () => openTurn
}));

vi.mock('@zana-ai/zcc-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-db')>();
  return {
    ...actual,
    DEFERRED_THREAD_MESSAGE_CAP: 2,
    countDeferredThreadMessages: vi.fn(() => rows.filter((row) => row.status !== 'failed').length),
    countActiveConversationTurns: vi.fn(() => liveActiveCount),
    getConversationThread: vi.fn(() => thread),
    isThreadQueueAutoSendPaused: vi.fn(() => queuePaused || rows.some((row) => row.paused && row.status === 'queued')),
    createDeferredThreadMessage: vi.fn((_db, input: {
      threadId: string;
      kind: string;
      payload: string;
      paused?: boolean;
      sendAfter?: number | null;
      groupBoundaryId?: string | null;
    }) => {
      const now = rows.length + 1;
      const row: TestRow = {
        id: `dmsg_${now}`,
        threadId: input.threadId,
        kind: input.kind,
        payload: input.payload,
        createdAt: now,
        status: 'queued',
        paused: input.paused === true || queuePaused,
        sendAfter: input.sendAfter ?? null,
        failureReason: null,
        groupBoundaryId: input.groupBoundaryId ?? null,
        updatedAt: now
      };
      rows.push(row);
      return row;
    }),
    listDeferredThreadMessages: vi.fn(() => [...rows]),
    listDueDeferredThreadMessages: vi.fn(() => rows.filter((row) => row.status === 'queued' && !row.paused)),
    markDeferredThreadMessageDispatching: vi.fn((_db, args: { id: string }) => {
      const row = rows.find((entry) => entry.id === args.id);
      if (!row || row.status !== 'queued') return false;
      row.status = 'dispatching';
      return true;
    }),
    markDeferredThreadMessageFailed: vi.fn((_db, args: { id: string; reason: string }) => {
      const row = rows.find((entry) => entry.id === args.id);
      if (!row) return false;
      row.status = 'failed';
      row.failureReason = args.reason;
      return true;
    }),
    pauseDeferredThreadMessagesForThread: vi.fn(() => {
      queuePaused = true;
      for (const row of rows) {
        if (row.status === 'queued') row.paused = true;
      }
      return rows.length;
    }),
    resumeDeferredThreadMessagesForThread: vi.fn(() => {
      queuePaused = false;
      for (const row of rows) row.paused = false;
      return rows.length;
    }),
    requeueDeferredThreadMessagesForThread: vi.fn(() => {
      let count = 0;
      for (const row of rows) {
        if (row.status !== 'failed' && row.status !== 'dispatching') continue;
        row.status = 'queued';
        row.paused = false;
        row.failureReason = null;
        count += 1;
      }
      return count;
    }),
    deleteDeferredThreadMessage: vi.fn((_db, args: { id: string }) => {
      const index = rows.findIndex((row) => row.id === args.id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    }),
    deleteDeferredThreadMessagesForThread: vi.fn(() => {
      const count = rows.length;
      rows.length = 0;
      return count;
    })
  };
});

function ctx(pending = false, hostOnline = true): ProductHttpContext {
  return {
    db: {},
    pendingInteractions: {
      hasPendingThreadInteraction: () => pending
    },
    hostHub: {
      connectedHostIds: () => (hostOnline ? ['host-1'] : [])
    }
  } as unknown as ProductHttpContext;
}

describe('deferred conversation messages', () => {
  it('queues a send payload in arrival order', () => {
    rows.length = 0;
    queuePaused = false;
    openTurn = null;
    liveActiveCount = 0;
    deferConversationSend(ctx(true), {
      threadId: 'thr-1',
      input: [{ type: 'text', text: 'hello' }],
      mode: 'auto'
    });
    expect(rows).toHaveLength(1);
    expect(parseDeferredSendPayload(rows[0]!)).toMatchObject({
      kind: 'send',
      mode: 'auto',
      input: [{ type: 'text', text: 'hello' }]
    });
  });

  it('refuses a send when the deferred queue is full', () => {
    rows.length = 0;
    queuePaused = false;
    rows.push(
      {
        id: 'dmsg_1', threadId: 'thr-1', kind: 'send', payload: '{}', createdAt: 1,
        status: 'queued', paused: false, sendAfter: null, failureReason: null, groupBoundaryId: null, updatedAt: 1
      },
      {
        id: 'dmsg_2', threadId: 'thr-1', kind: 'send', payload: '{}', createdAt: 2,
        status: 'queued', paused: false, sendAfter: null, failureReason: null, groupBoundaryId: null, updatedAt: 2
      }
    );
    expect(() =>
      deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'more', mode: 'auto' })
    ).toThrow(/Too many messages/);
  });

  it('flushes queued sends in order after the interaction settles', async () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'two', mode: 'steer' });
    const delivered: unknown[] = [];
    await flushDeferredConversationMessages(ctx(false), 'thr-1', async (payload) => {
      delivered.push(payload.input);
    });
    expect(delivered).toEqual(['one', 'two']);
    expect(rows).toHaveLength(0);
  });

  it('does not flush while a pending interaction is still open', async () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    const deliver = vi.fn();
    await flushDeferredConversationMessages(ctx(true), 'thr-1', deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('does not auto-drain after a manual stop pause', async () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    pauseConversationQueue(ctx(true), 'thr-1');
    const deliver = vi.fn();
    await flushDeferredConversationMessages(ctx(false), 'thr-1', deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(rows[0]?.paused).toBe(true);
  });

  it('does not auto-drain while this thread still has an open turn', async () => {
    rows.length = 0;
    queuePaused = false;
    openTurn = { turnId: 'turn-1' };
    try {
      deferConversationSend(ctx(false), { threadId: 'thr-1', input: 'one', mode: 'queue-if-active' });
      const deliver = vi.fn();
      const result = await flushDeferredConversationMessages(ctx(false), 'thr-1', deliver);
      expect(deliver).not.toHaveBeenCalled();
      expect(result).toMatchObject({ flushed: 0, delayed: 'thread-active' });
      expect(rows[0]?.status).toBe('queued');
      expect(rows[0]?.failureReason).toBeNull();
    } finally {
      openTurn = null;
    }
  });

  it('auto-drains an idle thread even when other threads are at the concurrency cap', async () => {
    rows.length = 0;
    queuePaused = false;
    openTurn = null;
    liveActiveCount = 8;
    try {
      deferConversationSend(ctx(false), { threadId: 'thr-1', input: 'one', mode: 'queue-if-active' });
      const delivered: unknown[] = [];
      await flushDeferredConversationMessages(ctx(false), 'thr-1', async (payload) => {
        delivered.push(payload.input);
      });
      expect(delivered).toEqual(['one']);
    } finally {
      liveActiveCount = 0;
    }
  });

  it('honors the concurrency cap on host reconnect fan-out', async () => {
    rows.length = 0;
    queuePaused = false;
    openTurn = null;
    liveActiveCount = 8;
    try {
      deferConversationSend(ctx(false), { threadId: 'thr-1', input: 'one', mode: 'auto' });
      const deliver = vi.fn();
      const result = await flushDeferredConversationMessages(ctx(false), 'thr-1', deliver, {
        enforceConcurrencyCap: true
      });
      expect(deliver).not.toHaveBeenCalled();
      expect(result).toMatchObject({ flushed: 0, delayed: 'concurrency-cap' });
    } finally {
      liveActiveCount = 0;
    }
  });

  it('force flush delivers while this thread is still active', async () => {
    rows.length = 0;
    queuePaused = false;
    thread.status = 'active';
    try {
      deferConversationSend(ctx(false), { threadId: 'thr-1', input: 'one', mode: 'queue-if-active' });
      const delivered: unknown[] = [];
      await flushDeferredConversationMessages(ctx(false), 'thr-1', async (payload) => {
        delivered.push(payload.input);
      }, { force: true });
      expect(delivered).toEqual(['one']);
    } finally {
      thread.status = 'idle';
    }
  });

  it('force flush resumes a paused queue', async () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    pauseConversationQueue(ctx(true), 'thr-1');
    const delivered: unknown[] = [];
    await flushDeferredConversationMessages(ctx(false), 'thr-1', async (payload) => {
      delivered.push(payload.input);
    }, { force: true });
    expect(delivered).toEqual(['one']);
  });

  it('stamps failed rows and does not auto-retry them', async () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(false), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    await flushDeferredConversationMessages(ctx(false), 'thr-1', async () => {
      throw new Error('boom');
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    const deliver = vi.fn();
    await flushDeferredConversationMessages(ctx(false), 'thr-1', deliver);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('force flush requeues failed rows and delivers them', async () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(false), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    await flushDeferredConversationMessages(ctx(false), 'thr-1', async () => {
      throw new Error('Thread is already active');
    });
    expect(rows[0]?.status).toBe('failed');
    const delivered: unknown[] = [];
    await flushDeferredConversationMessages(ctx(false), 'thr-1', async (payload) => {
      delivered.push(payload.input);
    }, { force: true });
    expect(delivered).toEqual(['one']);
    expect(rows).toHaveLength(0);
  });

  it('force flush errors while a pending interaction is still open', async () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    const deliver = vi.fn();
    await expect(
      flushDeferredConversationMessages(ctx(true), 'thr-1', deliver, { force: true })
    ).rejects.toMatchObject({ status: 409, code: 'awaiting_user_interaction' });
    expect(deliver).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('drops held messages on archive', () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    dropDeferredConversationMessages(ctx(true), 'thr-1');
    expect(rows).toHaveLength(0);
  });

  it('flushes a shared group-boundary prefix as one send', async () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(false), {
      threadId: 'thr-1',
      input: [{ type: 'text', text: 'first' }],
      mode: 'auto',
      groupBoundaryId: 'grp-1'
    });
    deferConversationSend(ctx(false), {
      threadId: 'thr-1',
      input: [{ type: 'text', text: 'second' }],
      mode: 'auto',
      groupBoundaryId: 'grp-1'
    });
    const delivered: unknown[] = [];
    await flushDeferredConversationMessages(ctx(false), 'thr-1', async (payload) => {
      delivered.push(payload.input);
    });
    expect(delivered).toEqual([
      [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }]
    ]);
  });

  it('drops a single queued send', () => {
    rows.length = 0;
    queuePaused = false;
    deferConversationSend(ctx(false), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    deferConversationSend(ctx(false), { threadId: 'thr-1', input: 'two', mode: 'auto' });
    dropDeferredConversationMessage(ctx(false), 'thr-1', 'dmsg_1');
    expect(rows.map((row) => row.id)).toEqual(['dmsg_2']);
  });

  it('rejects dropping a missing queued send', () => {
    rows.length = 0;
    expect(() => dropDeferredConversationMessage(ctx(false), 'thr-1', 'missing')).toThrow(
      /queued send was not found/
    );
  });
});
