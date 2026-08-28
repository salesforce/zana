import { describe, expect, it } from 'vitest';
import {
  buildOptimisticUserTimelineRow,
  buildStopRequestedTimelineRow,
  hasConfirmedStopRow,
  isOptimisticTimelineRowId,
  mergeOptimisticTimelineRows,
  mergePendingStopRow
} from './optimistic-timeline-row.js';
import { findDeepestTimelineSearchHit, timelineContainsRowId } from './thread-search.js';
import { retainTerminalExpansionIds, windowTimelineRows } from './timeline-window.js';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';

describe('optimistic timeline rows', () => {
  it('drops the local user row once a matching server row arrives', () => {
    const optimistic = buildOptimisticUserTimelineRow({ threadId: 't1', text: 'hello', now: 1 });
    expect(isOptimisticTimelineRowId(optimistic.id)).toBe(true);
    const server = [{
      ...optimistic,
      id: 'server-user',
      sourceSeqStart: 3,
      sourceSeqEnd: 3
    }];
    expect(mergeOptimisticTimelineRows(server, optimistic)).toEqual(server);
    expect(mergeOptimisticTimelineRows([], optimistic)).toEqual([optimistic]);
  });

  it('injects Stop requested until a real interruption row lands', () => {
    const pending = mergePendingStopRow([], { threadId: 't1', isStopping: true, stoppingAnchorAt: 10 });
    expect(pending[0]).toMatchObject({ title: 'Stop requested', operationKind: 'thread-interrupted' });
    const confirmed = [buildStopRequestedTimelineRow({ threadId: 't1', stoppingAnchorAt: 10 })];
    confirmed[0] = { ...confirmed[0]!, id: 'real-stop' };
    expect(hasConfirmedStopRow(confirmed)).toBe(true);
    expect(mergePendingStopRow(confirmed, { threadId: 't1', isStopping: true, stoppingAnchorAt: 10 })).toEqual(confirmed);
  });
});

describe('thread search', () => {
  const rows = [
    {
      kind: 'turn',
      id: 'turn-1',
      children: [
        { kind: 'conversation', id: 'u1', role: 'user', text: 'please ship the latch' }
      ]
    }
  ] as unknown as ThreadTimelineViewRow[];

  it('finds the deepest matching row and its ancestors', () => {
    expect(findDeepestTimelineSearchHit(rows, 'latch')).toEqual({
      id: 'u1',
      ancestorIds: ['turn-1']
    });
    expect(timelineContainsRowId(rows, 'u1')).toBe(true);
    expect(findDeepestTimelineSearchHit(rows, 'missing', [{ id: 'old', preview: 'missing preview' }])).toEqual({
      id: 'old',
      ancestorIds: []
    });
  });
});

describe('timeline window', () => {
  it('retains terminal expansion ids with a cap and windows long lists', () => {
    expect(retainTerminalExpansionIds(['a'], ['b', 'c'], 2)).toEqual(['b', 'c']);
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: `r${index}` }));
    expect(windowTimelineRows(rows, 3).hiddenCount).toBe(2);
    expect(windowTimelineRows(rows, 3, { keepId: 'r0' }).visible[0]?.id).toBe('r0');
    expect(windowTimelineRows(rows, 3, { keepId: 'missing' }).hiddenCount).toBe(0);
  });
});
