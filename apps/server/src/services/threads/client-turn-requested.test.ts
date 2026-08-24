import { describe, expect, it, vi } from 'vitest';
import { appendClientTurnRequested } from './client-turn-requested.js';

vi.mock('@zana-ai/zcc-db', () => ({
  appendConversationThreadEvent: vi.fn((_db, input) => ({
    id: 'evt-1',
    threadId: input.threadId,
    sequence: 1,
    type: input.type,
    payload: input.payload,
    createdAt: 1
  }))
}));

import { appendConversationThreadEvent } from '@zana-ai/zcc-db';

describe('appendClientTurnRequested', () => {
  it('stores a client/turn/requested event with the user prompt', () => {
    const emit = vi.fn();
    appendClientTurnRequested(
      { db: {}, hub: { emit } } as never,
      {
        threadId: '11111111-1111-4111-8111-111111111111',
        prompt: ['Read README.md'],
        kind: 'thread-start',
        permissionMode: 'accept-edits',
        model: 'default'
      }
    );
    expect(appendConversationThreadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: '11111111-1111-4111-8111-111111111111',
        type: 'client/turn/requested'
      })
    );
    const payload = vi.mocked(appendConversationThreadEvent).mock.calls[0]![1].payload as {
      input: Array<{ text: string }>;
      target: { kind: string };
    };
    expect(payload.input[0]?.text).toBe('Read README.md');
    expect(payload.target.kind).toBe('thread-start');
    expect(emit).toHaveBeenCalledWith('threads:event', expect.objectContaining({
      type: 'client/turn/requested'
    }));
  });

  it('persists the caller reasoningLevel instead of hardcoding medium', () => {
    vi.mocked(appendConversationThreadEvent).mockClear();
    appendClientTurnRequested(
      { db: {}, hub: { emit: vi.fn() } } as never,
      {
        threadId: '11111111-1111-4111-8111-111111111111',
        prompt: ['Follow up'],
        kind: 'new-turn',
        model: 'claude-sonnet-5',
        reasoningLevel: 'high'
      }
    );
    const payload = vi.mocked(appendConversationThreadEvent).mock.calls[0]![1].payload as {
      execution: { model: string; reasoningLevel: string };
    };
    expect(payload.execution).toMatchObject({
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    });
  });

  it('skips empty prompts', () => {
    vi.mocked(appendConversationThreadEvent).mockClear();
    appendClientTurnRequested(
      { db: {}, hub: { emit: vi.fn() } } as never,
      { threadId: '11111111-1111-4111-8111-111111111111', prompt: ['  '], kind: 'new-turn' }
    );
    expect(appendConversationThreadEvent).not.toHaveBeenCalled();
  });
});
