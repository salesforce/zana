import { describe, expect, it, vi } from 'vitest';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import {
  loadThreadDetailProgressively,
  resolveThreadDetailStatus,
  resolveTimelinePollRows,
  THREAD_DETAIL_LOAD_ERROR,
  threadDetailLoadError
} from './thread-detail-load.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('progressive thread loading', () => {
  const detail = { thread: { runtime: { displayStatus: 'host-reconnecting' } } };
  const timeline = { rows: ['message'], status: 'idle' };

  it.each(['detail', 'timeline'] as const)('applies %s immediately while the other request is pending', async (first) => {
    const detailRequest = deferred<typeof detail>();
    const timelineRequest = deferred<typeof timeline>();
    const callbacks = { onDetail: vi.fn(), onTimeline: vi.fn(), onTimelineError: vi.fn() };
    const load = loadThreadDetailProgressively(detailRequest.promise, timelineRequest.promise, callbacks);
    let settled = false;
    void load.then(() => { settled = true; });
    if (first === 'detail') {
      detailRequest.resolve(detail);
      await Promise.resolve();
      expect(callbacks.onDetail).toHaveBeenCalledWith(detail, null);
      expect(callbacks.onTimeline).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      timelineRequest.resolve(timeline);
      await load;
      expect(callbacks.onTimeline).toHaveBeenCalledWith(timeline, detail);
    } else {
      timelineRequest.resolve(timeline);
      await Promise.resolve();
      expect(callbacks.onTimeline).toHaveBeenCalledWith(timeline, null);
      expect(callbacks.onDetail).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      detailRequest.resolve(detail);
      await load;
      expect(callbacks.onDetail).toHaveBeenCalledWith(detail, timeline);
    }
    expect(await load).toEqual([
      { status: 'fulfilled', value: detail },
      { status: 'fulfilled', value: timeline }
    ]);
    expect(callbacks.onTimelineError).not.toHaveBeenCalled();
  });

  it('surfaces a timeline failure without waiting for metadata, and still applies metadata', async () => {
    const detailRequest = deferred<typeof detail>();
    const timelineRequest = deferred<typeof timeline>();
    const callbacks = { onDetail: vi.fn(), onTimeline: vi.fn(), onTimelineError: vi.fn() };
    const load = loadThreadDetailProgressively(detailRequest.promise, timelineRequest.promise, callbacks);
    const error = new Error('Timeline unavailable');
    timelineRequest.reject(error);
    await Promise.resolve();
    expect(callbacks.onTimelineError).toHaveBeenCalledWith(error);
    expect(callbacks.onDetail).not.toHaveBeenCalled();
    detailRequest.resolve(detail);
    expect(await load).toEqual([
      { status: 'fulfilled', value: detail },
      { status: 'rejected', reason: error }
    ]);
    expect(callbacks.onDetail).toHaveBeenCalledWith(detail, null);
    expect(callbacks.onTimeline).not.toHaveBeenCalled();
  });

  it('keeps a successful timeline when metadata fails', async () => {
    const error = new Error('Metadata unavailable');
    const callbacks = { onDetail: vi.fn(), onTimeline: vi.fn(), onTimelineError: vi.fn() };
    const outcomes = await loadThreadDetailProgressively(Promise.reject(error), Promise.resolve(timeline), callbacks);
    expect(outcomes).toEqual([
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: timeline }
    ]);
    expect(callbacks.onTimeline).toHaveBeenCalledWith(timeline, null);
    expect(callbacks.onDetail).not.toHaveBeenCalled();
    expect(callbacks.onTimelineError).not.toHaveBeenCalled();
  });
});

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
  it('uses a reported status from metadata or the timeline and leaves an unknown status empty', () => {
    expect(resolveThreadDetailStatus(undefined)).toBe('');
    expect(resolveThreadDetailStatus({ status: 'active', runtime: { displayStatus: 'host-reconnecting' } }))
      .toBe('host-reconnecting');
    expect(resolveThreadDetailStatus({ status: 'active' }, 'idle')).toBe('active');
    expect(resolveThreadDetailStatus(undefined, 'idle')).toBe('idle');
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
