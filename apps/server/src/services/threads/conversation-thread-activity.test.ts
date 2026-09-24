import { afterEach, describe, expect, it, vi } from 'vitest';
import { threadScope, turnScope } from '@zana-ai/zcc-domain/thread-runtime';
import { EMPTY_THREAD_ACTIVITY } from '@zana-ai/zcc-thread-view';
import { resetThreadActivityCache, threadActivityForConversation } from './conversation-thread-activity.js';

const listConversationThreadEvents = vi.fn(() => [] as unknown[]);

vi.mock('@zana-ai/zcc-db', () => ({
  listConversationThreadEvents: (...args: unknown[]) => listConversationThreadEvents(...args)
}));

vi.mock('./thread-provider-catalog.js', () => ({
  planCommandForProvider: (providerId: string) =>
    providerId === 'codex' || providerId === 'claude-code'
      ? { trigger: '/', name: 'plan' }
      : null
}));

afterEach(() => {
  resetThreadActivityCache();
  listConversationThreadEvents.mockReset();
});

const thread = {
  id: 'thr-1',
  providerId: 'codex',
  status: 'active' as const
};

describe('threadActivityForConversation', () => {
  const ctx = { db: {} } as import('../../http/product-context.js').ProductHttpContext;

  it('returns zeros without scanning when maxSeq is 0', () => {
    expect(threadActivityForConversation(ctx, thread, 0)).toEqual(EMPTY_THREAD_ACTIVITY);
    expect(listConversationThreadEvents).not.toHaveBeenCalled();
  });

  it('caches by threadId + maxSeq', () => {
    listConversationThreadEvents.mockReturnValue([
      {
        id: 'e1',
        threadId: 'thr-1',
        sequence: 1,
        type: 'item/started',
        createdAt: 1,
        payload: {
          type: 'item/started',
          threadId: 'thr-1',
          providerThreadId: 'p1',
          scope: turnScope('turn-1'),
          item: {
            type: 'backgroundTask',
            id: 'task:bash-1',
            taskType: 'local_bash',
            description: 'npm run dev',
            status: 'pending',
            taskStatus: 'running',
            skipTranscript: false
          }
        }
      }
    ]);
    const first = threadActivityForConversation(ctx, thread, 1);
    const second = threadActivityForConversation(ctx, thread, 1);
    expect(first).toEqual({
      ...EMPTY_THREAD_ACTIVITY,
      activeBackgroundCommandCount: 1
    });
    expect(second).toBe(first);
    expect(listConversationThreadEvents).toHaveBeenCalledTimes(1);
  });

  it('rescans when maxSeq advances', () => {
    listConversationThreadEvents.mockReturnValueOnce([]);
    expect(threadActivityForConversation(ctx, thread, 1)).toEqual(EMPTY_THREAD_ACTIVITY);
    listConversationThreadEvents.mockReturnValueOnce([
      {
        id: 'e2',
        threadId: 'thr-1',
        sequence: 2,
        type: 'thread/goal/updated',
        createdAt: 2,
        payload: {
          type: 'thread/goal/updated',
          threadId: 'thr-1',
          providerThreadId: 'p1',
          scope: threadScope(),
          objective: 'Ship it',
          status: 'active',
          tokenBudget: 10_000,
          tokensUsed: 0,
          timeUsedSeconds: 0
        }
      }
    ]);
    expect(threadActivityForConversation(ctx, thread, 2)).toEqual({
      ...EMPTY_THREAD_ACTIVITY,
      activeGoalCount: 1
    });
    expect(listConversationThreadEvents).toHaveBeenCalledTimes(2);
  });

  it('counts an ACP plan session mode as active Plan mode without a slash command', () => {
    listConversationThreadEvents.mockReturnValue([
      {
        id: 'req',
        threadId: 'thr-1',
        sequence: 1,
        type: 'client/turn/requested',
        createdAt: 1,
        payload: {
          type: 'client/turn/requested',
          threadId: 'thr-1',
          scope: threadScope(),
          direction: 'outbound',
          requestId: 'creq_acppanxxyz',
          source: 'tell',
          initiator: 'user',
          senderThreadId: null,
          input: [{ type: 'text', text: 'Draft the plan', mentions: [] }],
          target: { kind: 'new-turn' },
          request: { method: 'turn/start', params: {} },
          execution: {
            model: 'gpt-5',
            serviceTier: 'default',
            reasoningLevel: 'medium',
            permissionMode: 'accept-edits',
            source: 'client/turn/requested',
            acpMode: 'plan'
          }
        }
      },
      {
        id: 'accepted',
        threadId: 'thr-1',
        sequence: 2,
        type: 'turn/input/accepted',
        createdAt: 2,
        payload: {
          type: 'turn/input/accepted',
          threadId: 'thr-1',
          providerThreadId: 'p1',
          scope: turnScope('turn-plan'),
          clientRequestId: 'creq_acppanxxyz'
        }
      }
    ]);
    expect(
      threadActivityForConversation(ctx, { id: 'thr-1', providerId: 'acp-cursor', status: 'active' }, 2)
    ).toEqual({
      ...EMPTY_THREAD_ACTIVITY,
      activePlanModeCount: 1
    });
  });
});
