import { describe, expect, it } from 'vitest';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import {
  resolveThreadDetailStatus,
  resolveTimelinePollRows,
  shouldClearPlaceholderStartingStatus,
  THREAD_DETAIL_LOAD_ERROR,
  threadDetailLoadError
} from './thread-detail-load.js';

function row(id: string, sourceSeqStart: number): TimelineRow {
  return {
    id,
    kind: 'system',
    threadId: 'thr_x',
    turnId: null,
    sourceSeqStart,
    sourceSeqEnd: sourceSeqStart,
    startedAt: 0,
    createdAt: 0,
    systemKind: 'debug',
    title: 't',
    detail: null,
    status: null
  };
}

describe('thread detail hydrate', () => {
  it('starts from Agent + starting + empty unless get applies a real record', () => {
    expect(resolveThreadDetailStatus(undefined)).toBe('');
    expect(resolveThreadDetailStatus({ status: 'active', runtime: { displayStatus: 'host-reconnecting' } }))
      .toBe('host-reconnecting');
    expect(resolveThreadDetailStatus({ status: 'active' }, 'idle')).toBe('active');
    expect(resolveThreadDetailStatus(undefined, 'idle')).toBe('idle');
  });

  it('keeps get status when timeline failed and drops placeholder starting only when both fail', () => {
    expect(shouldClearPlaceholderStartingStatus(false, true, false)).toBe(false);
    expect(shouldClearPlaceholderStartingStatus(false, false, true)).toBe(false);
    expect(shouldClearPlaceholderStartingStatus(true, true, true)).toBe(false);
    expect(shouldClearPlaceholderStartingStatus(false, true, true)).toBe(true);
  });

  it('surfaces a retryable load error instead of swallowing the failure', () => {
    expect(threadDetailLoadError(new Error('timeline-failed'))).toBe('timeline-failed');
    expect(threadDetailLoadError({})).toBe(THREAD_DETAIL_LOAD_ERROR);
  });
});

describe('resolveTimelinePollRows', () => {
  it('treats an emptying rowOrder as stale so the client full-fetches', () => {
    expect(resolveTimelinePollRows({
      prevRows: [row('a', 1)],
      prevMaxSeq: 4,
      useDelta: true,
      timeline: { maxSeq: 8, delta: { upsertRows: [], rowOrder: [] } }
    })).toEqual({ kind: 'stale' });
  });

  it('keeps previous rows when a full window projects empty without rewind', () => {
    const prev = [row('a', 1)];
    expect(resolveTimelinePollRows({
      prevRows: prev,
      prevMaxSeq: 4,
      useDelta: false,
      timeline: { maxSeq: 12, rows: [] }
    })).toEqual({ kind: 'rows', rows: prev });
  });

  it('accepts an empty rewind snapshot', () => {
    expect(resolveTimelinePollRows({
      prevRows: [row('a', 1)],
      prevMaxSeq: 12,
      useDelta: false,
      timeline: { maxSeq: 3, rows: [] }
    })).toEqual({ kind: 'rows', rows: [] });
  });
});
