import { describe, expect, it } from 'vitest';
import {
  buildForkTranscriptSeed,
  canCloneProviderSession,
  describeCopiedForkStart,
  FORK_TRANSCRIPT_SEED_PREFIX,
  lastCompletedTurnSequence,
  resolveConversationForkPoint,
  selectInheritedForkEventRows
} from './conversation-fork-history.js';
import type { ConversationThreadEventRow } from '@zana-ai/zcc-db';

const sourceId = 'source-thread';

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>
): ConversationThreadEventRow {
  return {
    id: `evt-${sequence}`,
    threadId: sourceId,
    sequence,
    type,
    payload: { type, threadId: sourceId, ...payload },
    createdAt: sequence
  };
}

describe('selectInheritedForkEventRows', () => {
  it('returns nothing when the source has no completed turn', () => {
    expect(
      selectInheritedForkEventRows([
        event(1, 'turn/started', { scope: { kind: 'turn', turnId: 't1' } })
      ])
    ).toEqual([]);
    expect(lastCompletedTurnSequence([])).toBeNull();
  });

  it('copies completed-turn history and drops an still-open later turn', () => {
    const rows = [
      event(1, 'client/turn/requested', { requestId: 'creq_1', scope: { kind: 'thread' } }),
      event(2, 'turn/input/accepted', {
        clientRequestId: 'creq_1',
        scope: { kind: 'turn', turnId: 't1' }
      }),
      event(3, 'turn/started', { scope: { kind: 'turn', turnId: 't1' } }),
      event(4, 'item/completed', { scope: { kind: 'turn', turnId: 't1' } }),
      event(5, 'turn/completed', { scope: { kind: 'turn', turnId: 't1' } }),
      event(6, 'client/turn/requested', { requestId: 'creq_2', scope: { kind: 'thread' } }),
      event(7, 'turn/started', { scope: { kind: 'turn', turnId: 't2' } })
    ];
    expect(selectInheritedForkEventRows(rows).map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('drops a queued client request that was never accepted', () => {
    const rows = [
      event(1, 'client/turn/requested', { requestId: 'creq_1', scope: { kind: 'thread' } }),
      event(2, 'turn/input/accepted', {
        clientRequestId: 'creq_1',
        scope: { kind: 'turn', turnId: 't1' }
      }),
      event(3, 'turn/started', { scope: { kind: 'turn', turnId: 't1' } }),
      event(4, 'turn/completed', { scope: { kind: 'turn', turnId: 't1' } }),
      event(5, 'client/turn/requested', { requestId: 'creq_queued', scope: { kind: 'thread' } })
    ];
    expect(selectInheritedForkEventRows(rows).map((row) => row.type)).toEqual([
      'client/turn/requested',
      'turn/input/accepted',
      'turn/started',
      'turn/completed'
    ]);
  });

  it('does not copy identity or pending-interaction bookkeeping', () => {
    const rows = [
      event(1, 'thread/identity', { scope: { kind: 'thread' } }),
      event(2, 'turn/started', { scope: { kind: 'turn', turnId: 't1' } }),
      event(3, 'turn/completed', { scope: { kind: 'turn', turnId: 't1' } }),
      event(4, 'pending-interaction/requested', { scope: { kind: 'thread' } })
    ];
    expect(selectInheritedForkEventRows(rows).map((row) => row.type)).toEqual([
      'turn/started',
      'turn/completed'
    ]);
  });

  it('truncates inherited history at the completed turn that contains sourceSeqEnd', () => {
    const rows = [
      event(1, 'turn/started', { scope: { kind: 'turn', turnId: 't1' } }),
      event(2, 'item/completed', { scope: { kind: 'turn', turnId: 't1' } }),
      event(3, 'turn/completed', { scope: { kind: 'turn', turnId: 't1' } }),
      event(4, 'turn/started', { scope: { kind: 'turn', turnId: 't2' } }),
      event(5, 'item/completed', { scope: { kind: 'turn', turnId: 't2' } }),
      event(6, 'turn/completed', { scope: { kind: 'turn', turnId: 't2' } })
    ];
    expect(selectInheritedForkEventRows(rows, 2).map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(selectInheritedForkEventRows(rows, 5).map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('resolveConversationForkPoint', () => {
  const completed = [
    event(1, 'turn/started', {
      scope: { kind: 'turn', turnId: 't1' },
      providerThreadId: 'prov-source'
    }),
    event(2, 'turn/completed', {
      scope: { kind: 'turn', turnId: 't1' },
      providerThreadId: 'prov-source',
      providerCheckpointId: 'cp-1'
    }),
    event(3, 'turn/started', {
      scope: { kind: 'turn', turnId: 't2' },
      providerThreadId: 'prov-source'
    }),
    event(4, 'turn/completed', {
      scope: { kind: 'turn', turnId: 't2' },
      providerThreadId: 'prov-source',
      providerCheckpointId: 'cp-2'
    })
  ];

  it('clones the session tip when no sourceSeqEnd is given', () => {
    expect(resolveConversationForkPoint({
      events: completed,
      forkCapability: 'checkpoint',
      sourceProviderThreadId: 'prov-source'
    })).toEqual({ sourceProviderThreadId: 'prov-source' });
  });

  it('forks a checkpoint provider at an earlier completed turn', () => {
    expect(resolveConversationForkPoint({
      events: completed,
      forkCapability: 'checkpoint',
      sourceProviderThreadId: 'prov-source',
      sourceSeqEnd: 2
    })).toEqual({
      sourceProviderThreadId: 'prov-source',
      sourceProviderCheckpointId: 'cp-1'
    });
  });

  it('rejects a mid-session fork on a tip-only provider', () => {
    expect(() => resolveConversationForkPoint({
      events: completed,
      forkCapability: 'tip',
      sourceProviderThreadId: 'prov-source',
      sourceSeqEnd: 2
    })).toThrow(/only fork at the end of a session/);
  });

  it('reads the clone point from copied fork history', () => {
    expect(describeCopiedForkStart([
      event(1, 'turn/started', {
        scope: { kind: 'turn', turnId: 't1' },
        providerThreadId: 'prov-source'
      }),
      event(2, 'turn/completed', {
        scope: { kind: 'turn', turnId: 't1' },
        providerThreadId: 'prov-source',
        providerCheckpointId: 'cp-9'
      })
    ], 'checkpoint')).toEqual({
      sourceProviderThreadId: 'prov-source',
      sourceProviderCheckpointId: 'cp-9'
    });
  });
});

describe('describeCopiedForkStart', () => {
  const copied = [
    event(1, 'turn/started', {
      scope: { kind: 'turn', turnId: 't1' },
      providerThreadId: 'prov-source'
    }),
    event(2, 'turn/completed', {
      scope: { kind: 'turn', turnId: 't1' },
      providerThreadId: 'prov-source',
      providerCheckpointId: 'cp-9'
    })
  ];

  it('clones a tip fork without a checkpoint', () => {
    expect(describeCopiedForkStart(copied, 'tip')).toEqual({
      sourceProviderThreadId: 'prov-source'
    });
  });

  it('does not clone when the provider cannot fork', () => {
    expect(canCloneProviderSession('none')).toBe(false);
    expect(canCloneProviderSession(undefined)).toBe(false);
    expect(describeCopiedForkStart(copied, 'none')).toBeNull();
    expect(describeCopiedForkStart(copied, undefined)).toBeNull();
  });
});

describe('buildForkTranscriptSeed', () => {
  it('returns null when inherited events have no visible messages', () => {
    expect(buildForkTranscriptSeed([
      event(1, 'turn/started', { scope: { kind: 'turn', turnId: 't1' } }),
      event(2, 'turn/completed', { scope: { kind: 'turn', turnId: 't1' } })
    ])).toBeNull();
  });

  it('joins visible user prompts and assistant messages', () => {
    const seed = buildForkTranscriptSeed([
      event(1, 'client/turn/requested', {
        requestId: 'creq_1',
        input: [
          { type: 'text', text: '  hidden  ', visibility: 'agent-only' },
          { type: 'text', text: 'Hello' }
        ]
      }),
      event(2, 'item/completed', {
        item: { type: 'agentMessage', text: 'Hi there' }
      }),
      event(3, 'item/completed', {
        item: { type: 'toolCall', title: 'ignored' }
      }),
      event(4, 'client/turn/requested', {
        requestId: 'creq_2',
        input: [{ type: 'text', text: 'Follow up' }]
      }),
      event(5, 'item/completed', {
        item: { type: 'agentMessage', text: 'Done' }
      })
    ]);
    expect(seed).toEqual({
      type: 'text',
      mentions: [],
      visibility: 'agent-only',
      text: `${FORK_TRANSCRIPT_SEED_PREFIX}User:\nHello\n\nAssistant:\nHi there\n\nUser:\nFollow up\n\nAssistant:\nDone`
    });
  });

  it('keeps the newest turns when the seed exceeds the character cap', () => {
    const seed = buildForkTranscriptSeed([
      event(1, 'client/turn/requested', {
        input: [{ type: 'text', text: 'old prompt that should drop' }]
      }),
      event(2, 'item/completed', {
        item: { type: 'agentMessage', text: 'old answer that should drop' }
      }),
      event(3, 'client/turn/requested', {
        input: [{ type: 'text', text: 'keep me' }]
      }),
      event(4, 'item/completed', {
        item: { type: 'agentMessage', text: 'and this' }
      })
    ], 40);
    expect(seed?.text.startsWith(`${FORK_TRANSCRIPT_SEED_PREFIX}…(earlier conversation omitted)\n\n`)).toBe(true);
    expect(seed?.text).toContain('keep me');
    expect(seed?.text).toContain('and this');
    expect(seed?.text).not.toContain('old prompt');
  });
});
