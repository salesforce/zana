import { describe, expect, it } from 'vitest';
import {
  describeCopiedForkStart,
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
