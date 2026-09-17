import { describe, expect, it, vi } from 'vitest';
import { readLastThreadExecution } from './thread-last-execution.js';

vi.mock('@zana-ai/zcc-db', () => ({
  listConversationThreadEventsWindow: vi.fn()
}));

import { listConversationThreadEventsWindow } from '@zana-ai/zcc-db';

describe('readLastThreadExecution', () => {
  it.each(['accept-edits', 'auto', 'full'])('reads the newest valid %s permission and filters the bounded query to turn requests', (permissionMode) => {
    const turn = (execution: unknown) => ({ payload: { type: 'client/turn/requested', execution } });
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      turn({ permissionMode: 'auto' }),
      turn({ permissionMode, acpMode: 'plan' }),
      turn({ model: 'new-model', permissionMode: 'invalid' }),
      turn(null),
      { payload: {} },
      { payload: null },
      { payload: { type: 'turn/completed' } }
    ] as never);
    expect(readLastThreadExecution({ db: {} }, 't1')).toEqual({
      model: 'new-model', reasoningLevel: null, acpMode: 'plan', permissionMode
    });
    expect(listConversationThreadEventsWindow).toHaveBeenLastCalledWith({}, 't1', {
      limit: 80, type: 'client/turn/requested'
    });
  });

  it('returns model, reasoning, and native role from the newest client/turn/requested event', () => {
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
          execution: { model: 'claude-sonnet-5', reasoningLevel: 'xhigh', acpMode: 'plan' }
        },
        createdAt: 3
      }
    ] as never);
    expect(readLastThreadExecution({ db: {} }, 't1')).toEqual({
      model: 'claude-sonnet-5',
      reasoningLevel: 'xhigh',
      acpMode: 'plan',
      permissionMode: null
    });
  });

  it('carries the last recorded native role forward when a newer turn omits one', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      {
        id: 'chose-role',
        threadId: 't1',
        sequence: 1,
        type: 'client/turn/requested',
        payload: {
          type: 'client/turn/requested',
          execution: { model: 'claude-sonnet-5', reasoningLevel: 'medium', acpMode: 'plan' }
        },
        createdAt: 1
      },
      {
        id: 'followup-no-role',
        threadId: 't1',
        sequence: 2,
        type: 'client/turn/requested',
        payload: {
          type: 'client/turn/requested',
          execution: { model: 'claude-opus-5[1m]', reasoningLevel: 'high' }
        },
        createdAt: 2
      }
    ] as never);
    // Newest turn drives model/reasoning; the role sticks from the earlier turn.
    expect(readLastThreadExecution({ db: {} }, 't1')).toEqual({
      model: 'claude-opus-5[1m]',
      reasoningLevel: 'high',
      acpMode: 'plan',
      permissionMode: null
    });
  });

  it('reads back a null native role when the turn recorded none', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      {
        id: 'latest',
        threadId: 't1',
        sequence: 1,
        type: 'client/turn/requested',
        payload: {
          type: 'client/turn/requested',
          execution: { model: 'claude-sonnet-5', reasoningLevel: 'high' }
        },
        createdAt: 1
      }
    ] as never);
    expect(readLastThreadExecution({ db: {} }, 't1')).toEqual({
      model: 'claude-sonnet-5',
      reasoningLevel: 'high',
      acpMode: null,
      permissionMode: null
    });
  });

  it('returns nulls when no turn requested event is present', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([]);
    expect(readLastThreadExecution({ db: {} }, 't1')).toEqual({
      model: null,
      reasoningLevel: null,
      acpMode: null,
      permissionMode: null
    });
  });
});
