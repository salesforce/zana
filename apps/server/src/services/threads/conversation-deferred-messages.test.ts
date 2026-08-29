import { describe, expect, it, vi } from 'vitest';
import {
  deferConversationSend,
  dropDeferredConversationMessages,
  flushDeferredConversationMessages,
  parseDeferredSendPayload
} from './conversation-deferred-messages.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { DEFERRED_THREAD_MESSAGE_CAP } from '@zana-ai/zcc-db';

const rows: Array<{ id: string; threadId: string; kind: string; payload: string; createdAt: number }> = [];

vi.mock('@zana-ai/zcc-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-db')>();
  return {
    ...actual,
    DEFERRED_THREAD_MESSAGE_CAP: 2,
    countDeferredThreadMessages: vi.fn(() => rows.length),
    createDeferredThreadMessage: vi.fn((_db, input: { threadId: string; kind: string; payload: string }) => {
      const row = {
        id: `dmsg_${rows.length + 1}`,
        threadId: input.threadId,
        kind: input.kind,
        payload: input.payload,
        createdAt: rows.length + 1
      };
      rows.push(row);
      return row;
    }),
    listDeferredThreadMessages: vi.fn(() => [...rows]),
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

function ctx(pending = false): ProductHttpContext {
  return {
    db: {},
    pendingInteractions: {
      hasPendingThreadInteraction: () => pending
    }
  } as unknown as ProductHttpContext;
}

describe('deferred conversation messages', () => {
  it('queues a send payload in arrival order', () => {
    rows.length = 0;
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
    rows.push(
      { id: 'dmsg_1', threadId: 'thr-1', kind: 'send', payload: '{}', createdAt: 1 },
      { id: 'dmsg_2', threadId: 'thr-1', kind: 'send', payload: '{}', createdAt: 2 }
    );
    expect(() =>
      deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'more', mode: 'auto' })
    ).toThrow(/Too many messages/);
  });

  it('flushes queued sends in order after the interaction settles', async () => {
    rows.length = 0;
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
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    const deliver = vi.fn();
    await flushDeferredConversationMessages(ctx(true), 'thr-1', deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('drops held messages on stop or archive', () => {
    rows.length = 0;
    deferConversationSend(ctx(true), { threadId: 'thr-1', input: 'one', mode: 'auto' });
    dropDeferredConversationMessages(ctx(true), 'thr-1');
    expect(rows).toHaveLength(0);
  });

  it('keeps the configured cap small', () => {
    expect(DEFERRED_THREAD_MESSAGE_CAP).toBeGreaterThan(0);
    expect(DEFERRED_THREAD_MESSAGE_CAP).toBeLessThanOrEqual(50);
  });
});
