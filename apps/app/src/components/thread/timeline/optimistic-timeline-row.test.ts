import { describe, expect, it } from 'vitest';
import {
  buildOptimisticUserTimelineRow,
  buildStopRequestedTimelineRow,
  hasConfirmedStopRow,
  isOptimisticTimelineRowId,
  mergeOptimisticTimelineRows,
  mergePendingStopRow
} from './optimistic-timeline-row.js';
import { collectTimelineSearchMatches, findTimelineMessageAtSequence, timelineContainsRowId, timelineRowSearchText } from './thread-search.js';
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

  it('keeps an image-only optimistic row until the server attachments land', () => {
    const optimistic = buildOptimisticUserTimelineRow({
      threadId: 't1',
      text: '',
      now: 1,
      localImagePaths: ['shot-1.png']
    });
    expect(optimistic.attachments?.localImagePaths).toEqual(['shot-1.png']);
    const textOnly = {
      ...optimistic,
      id: 'server-empty',
      attachments: null
    };
    expect(mergeOptimisticTimelineRows([textOnly], optimistic)).toEqual([textOnly, optimistic]);
    const withImage = {
      ...optimistic,
      id: 'server-img',
      attachments: {
        webImages: 0,
        localImages: 1,
        localFiles: 0,
        imageUrls: [],
        localImagePaths: ['shot-1.png'],
        localFilePaths: []
      }
    };
    expect(mergeOptimisticTimelineRows([withImage], optimistic)).toEqual([withImage]);
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
      sourceSeqStart: 10,
      sourceSeqEnd: 20,
      children: [
        { kind: 'conversation', id: 'u1', role: 'user', text: 'please ship the latch, Latch!', sourceSeqStart: 11, sourceSeqEnd: 11 },
        { kind: 'work', id: 'w1', workKind: 'command', command: 'grep latch', output: 'no latch, \u001b[31mlatch\u001b[0m here', sourceSeqStart: 12, sourceSeqEnd: 12 }
      ]
    },
    { kind: 'turn', id: 'turn-2', sourceSeqStart: 30, sourceSeqEnd: 40, children: null },
    { kind: 'conversation', id: 'a9', role: 'assistant', text: 'done', sourceSeqStart: 50, sourceSeqEnd: 50 }
  ] as unknown as ThreadTimelineViewRow[];

  it('counts every occurrence in reading order, collapsed tool rows included', () => {
    expect(collectTimelineSearchMatches(rows, '  LATCH ')).toEqual([
      { id: 'u1', ancestorIds: ['turn-1'], occurrence: 0 },
      { id: 'u1', ancestorIds: ['turn-1'], occurrence: 1 },
      { id: 'w1', ancestorIds: ['turn-1'], occurrence: 0 },
      { id: 'w1', ancestorIds: ['turn-1'], occurrence: 1 }
    ]);
    expect(collectTimelineSearchMatches(rows, '   ')).toEqual([]);
    expect(timelineContainsRowId(rows, 'u1')).toBe(true);
  });

  it('does not match the row kind', () => {
    expect(timelineRowSearchText(rows[2]!)).toBe('done');
    expect(timelineRowSearchText(rows[0]!.kind === 'turn' ? rows[0]!.children![1]! : rows[0]!)).toBe('no latch, latch here');
    expect(collectTimelineSearchMatches(rows, 'conversation')).toEqual([]);
    expect(collectTimelineSearchMatches(rows, 'command')).toEqual([]);
  });

  it('searches what a row shows: message text without markdown syntax, system title and detail', () => {
    const shown = [
      { kind: 'conversation', id: 'm', role: 'assistant', text: 'See [the docs](https://docs.example) and **docs**' },
      { kind: 'system', id: 's', title: 'Reconnected', detail: 'after docs' }
    ] as unknown as ThreadTimelineViewRow[];
    expect(timelineRowSearchText(shown[0]!)).toBe('See the docs and docs');
    expect(timelineRowSearchText(shown[1]!)).toBe('Reconnected\nafter docs');
    expect(collectTimelineSearchMatches(shown, 'docs').map(match => match.id)).toEqual(['m', 'm', 's']);
    expect(collectTimelineSearchMatches(shown, 'example')).toEqual([]);
  });

  it('places outline matches in older pages first and in unloaded turns under the turn', () => {
    const outlineMatches = [
      { id: 'old', seq: 3, count: 2 },
      { id: 'u1', seq: 11, count: 2 },
      { id: 'archived', seq: 35, count: 1 },
      { id: 'stale', seq: 45, count: 1 }
    ];
    const matches = collectTimelineSearchMatches(rows, 'latch', { outlineMatches, hasOlder: true });
    expect(matches.slice(0, 2)).toEqual([
      { id: 'old', ancestorIds: [], occurrence: 0, unloaded: true },
      { id: 'old', ancestorIds: [], occurrence: 1, unloaded: true }
    ]);
    expect(matches.filter(match => match.id === 'u1')).toHaveLength(2);
    expect(matches.at(-1)).toEqual({ id: 'archived', ancestorIds: ['turn-2'], occurrence: 0 });
    expect(matches.some(match => match.id === 'stale')).toBe(false);
    // Without earlier history there is nothing older to reach.
    expect(collectTimelineSearchMatches(rows, 'latch', { outlineMatches, hasOlder: false }).some(match => match.id === 'old')).toBe(false);
  });

  it('descends into delegations and summaries', () => {
    const nested = [
      { kind: 'work', id: 'd1', workKind: 'delegation', title: 'Delegate', childRows: [{ kind: 'conversation', id: 'c1', text: 'needle' }] },
      { kind: 'bundle-summary', id: 'b1', title: 'Bundle', children: [{ kind: 'conversation', id: 'c2', text: 'needle' }] }
    ] as unknown as ThreadTimelineViewRow[];
    expect(collectTimelineSearchMatches(nested, 'needle')).toEqual([
      { id: 'c1', ancestorIds: ['d1'], occurrence: 0 },
      { id: 'c2', ancestorIds: ['b1'], occurrence: 0 }
    ]);
  });
});

describe('timeline window', () => {
  it('retains terminal expansion ids with a cap and windows long lists', () => {
    expect(retainTerminalExpansionIds(['a'], ['b', 'c'], 2)).toEqual(['b', 'c']);
    const previous = ['a'];
    expect(retainTerminalExpansionIds(previous, ['a'])).toBe(previous);
    expect(retainTerminalExpansionIds(['a', 'b'], ['c'], 2)).toEqual(['b', 'c']);
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: `r${index}` }));
    expect(windowTimelineRows(rows, 3).hiddenCount).toBe(2);
    expect(windowTimelineRows(rows, 3, { keepId: 'r0' }).visible[0]?.id).toBe('r0');
    expect(windowTimelineRows(rows, 3, { keepId: 'missing' }).hiddenCount).toBe(2);
  });
});


it('finds message links within inclusive sequence ranges and expands nested ancestors', () => {
  const child = { id: 'child', kind: 'conversation', sourceSeqStart: 10, sourceSeqEnd: 12 };
  const rows = [{ id: 'turn', kind: 'turn', children: [{ id: 'group', kind: 'bundle-summary', children: [child] }] }, { id: 'other', kind: 'conversation', sourceSeqStart: 20, sourceSeqEnd: 20 }] as ThreadTimelineViewRow[];
  for (const sequence of [10, 11, 12]) expect(findTimelineMessageAtSequence(rows, sequence)).toEqual({ id: 'child', ancestorIds: ['turn', 'group'] });
  expect(findTimelineMessageAtSequence(rows, 20)).toEqual({ id: 'other', ancestorIds: [] });
  for (const sequence of [0, 9, 13, 21]) expect(findTimelineMessageAtSequence(rows, sequence)).toBeNull();
});
