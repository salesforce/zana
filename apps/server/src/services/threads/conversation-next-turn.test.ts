import { describe, expect, it, vi } from 'vitest';
import { conversationNextTurnItemView, conversationNextTurnView } from './conversation-next-turn.js';
import type { DeferredThreadMessageRow } from '@zana-ai/zcc-db';

vi.mock('@zana-ai/zcc-db', () => ({
  isThreadQueueAutoSendPaused: vi.fn(() => true),
  listDeferredThreadMessages: vi.fn(() => [
    {
      id: 'd1',
      status: 'queued',
      paused: true,
      sendAfter: null,
      failureReason: null,
      createdAt: 1,
      updatedAt: 1,
      payload: JSON.stringify({ kind: 'send', input: [{ type: 'text', text: 'hello' }] })
    },
    {
      id: 'd2',
      status: 'failed',
      paused: false,
      sendAfter: null,
      failureReason: 'host-offline',
      createdAt: 2,
      updatedAt: 2,
      payload: JSON.stringify({ kind: 'send', input: 'retry me', senderThreadId: 'thr_childaaaa' })
    }
  ])
}));

describe('conversationNextTurnView', () => {
  it.each([
    { input: [null, { type: 'text', text: 'page contents', visibility: 'agent-only' }, { type: 'text', text: 'visible' }, { type: 'image' }], text: 'visible' },
    { input: [{ type: 'text', text: 'hidden only', visibility: 'agent-only' }], text: '' },
    { input: {}, text: '' }
  ])('shows only user-visible text from $input', ({ input, text }) => {
    expect(conversationNextTurnItemView({ payload: JSON.stringify({ input }) } as DeferredThreadMessageRow).text).toBe(text);
  });

  it('tolerates malformed retained queue payloads', () => {
    for (const payload of ['bad json', 'null', '42']) {
      expect(conversationNextTurnItemView({ payload } as DeferredThreadMessageRow)).toMatchObject({ text: '', senderThreadId: null });
    }
  });

  it('exposes queued and failed next-turn text plus failure reasons', () => {
    expect(conversationNextTurnView({ db: {} } as never, 'thr-1')).toEqual({
      paused: true,
      items: [
        {
          id: 'd1',
          status: 'queued',
          paused: true,
          sendAfter: null,
          failureReason: null,
          retryAt: null,
          failureCount: 0,
          createdAt: 1,
          updatedAt: 1,
          text: 'hello',
          senderThreadId: null
        },
        {
          id: 'd2',
          status: 'failed',
          paused: false,
          sendAfter: null,
          failureReason: 'host-offline',
          retryAt: null,
          failureCount: 0,
          createdAt: 2,
          updatedAt: 2,
          text: 'retry me',
          senderThreadId: 'thr_childaaaa'
        }
      ]
    });
  });
});
