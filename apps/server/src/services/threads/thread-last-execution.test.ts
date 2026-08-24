import { describe, expect, it, vi } from 'vitest';
import { readLastThreadExecution } from './thread-last-execution.js';

vi.mock('@zana-ai/zcc-db', () => ({
  listConversationThreadEventsWindow: vi.fn()
}));

import { listConversationThreadEventsWindow } from '@zana-ai/zcc-db';

describe('readLastThreadExecution', () => {
  it('returns model and reasoning from the newest client/turn/requested event', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      {
        id: 'old',
        threadId: 't1',
        sequence: 1,
        type: 'client/turn/requested',
        payload: {
          type: 'client/turn/requested',
          execution: { model: 'claude-opus-5[1m]', reasoningLevel: 'high' }
        },
        createdAt: 1
      },
      {
        id: 'noise',
        threadId: 't1',
        sequence: 2,
        type: 'turn/completed',
        payload: { type: 'turn/completed' },
        createdAt: 2
      },
      {
        id: 'latest',
        threadId: 't1',
        sequence: 3,
        type: 'client/turn/requested',
        payload: {
          type: 'client/turn/requested',
          execution: { model: 'claude-sonnet-5', reasoningLevel: 'xhigh' }
        },
        createdAt: 3
      }
    ] as never);
    expect(readLastThreadExecution({ db: {} }, 't1')).toEqual({
      model: 'claude-sonnet-5',
      reasoningLevel: 'xhigh'
    });
  });

  it('returns nulls when no turn requested event is present', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([]);
    expect(readLastThreadExecution({ db: {} }, 't1')).toEqual({
      model: null,
      reasoningLevel: null
    });
  });
});
