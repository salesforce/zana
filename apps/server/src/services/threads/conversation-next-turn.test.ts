import { describe, expect, it, vi } from 'vitest';
import { conversationNextTurnView } from './conversation-next-turn.js';

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
      payload: JSON.stringify({ kind: 'send', input: 'retry me' })
    }
  ])
}));

describe('conversationNextTurnView', () => {
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
          createdAt: 1,
          updatedAt: 1,
          text: 'hello'
        },
        {
          id: 'd2',
          status: 'failed',
          paused: false,
          sendAfter: null,
          failureReason: 'host-offline',
          createdAt: 2,
          updatedAt: 2,
          text: 'retry me'
        }
      ]
    });
  });
});
