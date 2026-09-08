import { describe, expect, it, vi } from 'vitest';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(() => ({ id: 'thr-1' })),
  listConversationThreadEventsWindow: vi.fn(() => [
    {
      id: 'e1',
      sequence: 1,
      createdAt: 1,
      type: 'client/turn/requested',
      payload: {
        type: 'client/turn/requested',
        input: [{ type: 'text', text: 'hello world', mentions: [] }]
      }
    }
  ])
}));

import { conversationPromptHistory } from './conversation-prompt-history.js';
import type { ProductHttpContext } from '../../http/product-context.js';

describe('conversationPromptHistory', () => {
  it('returns visible prompt entries from stored client turn requests', () => {
    expect(conversationPromptHistory({ db: {} } as ProductHttpContext, 'thr-1').entries).toEqual([
      {
        id: '1',
        createdAt: 1,
        input: [{ type: 'text', text: 'hello world', mentions: [] }]
      }
    ]);
  });
});
