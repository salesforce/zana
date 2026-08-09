import { describe, it, expect } from 'vitest';
import {
  feedBucketFor,
  groupFeedByBucket,
  clusterFeedNodes,
  CLUSTER_MIN_RUN
} from '../feedGrouping';
import type { FeedEvent, FeedEventKind } from '../../../shared/types';

// A fixed "now" at midday so day-aligned thresholds are unambiguous.
const NOW = new Date('2026-07-05T12:00:00').getTime();
const DAY = 86_400_000;

function ev(id: string, ts: number, kind: FeedEventKind = 'commit'): FeedEvent {
  return { id, projectId: 'p1', kind, ts, title: id };
}

describe('feedBucketFor', () => {
  it('buckets by day-aligned thresholds', () => {
    expect(feedBucketFor(NOW, NOW)).toBe('Today');
    expect(feedBucketFor(NOW - DAY, NOW)).toBe('Yesterday');
    expect(feedBucketFor(NOW - 3 * DAY, NOW)).toBe('This week');
    expect(feedBucketFor(NOW - 30 * DAY, NOW)).toBe('Older');
  });
});

describe('groupFeedByBucket', () => {
  it('groups into canonical order, omitting empty buckets, newest-first within', () => {
    const events = [
      ev('today-late', NOW - 1000),
      ev('today-early', NOW - 3_600_000),
      ev('old', NOW - 30 * DAY)
    ];
    const grouped = groupFeedByBucket(events, NOW);
    expect(grouped.map(([b]) => b)).toEqual(['Today', 'Older']);
    // Preserves input (newest-first) order within a bucket.
    expect(grouped[0]![1].map((e) => e.id)).toEqual(['today-late', 'today-early']);
  });

  it('returns [] for no events', () => {
    expect(groupFeedByBucket([], NOW)).toEqual([]);
  });
});

describe('clusterFeedNodes', () => {
  it('collapses a run of ≥threshold same-kind clusterable events into one cluster', () => {
    const events = [
      ev('f1', NOW - 1000, 'followup-created'),
      ev('f2', NOW - 2000, 'followup-created'),
      ev('f3', NOW - 3000, 'followup-created')
    ];
    expect(events.length).toBe(CLUSTER_MIN_RUN);
    const nodes = clusterFeedNodes(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'cluster', kind: 'followup-created' });
    if (nodes[0]!.type === 'cluster') {
      expect(nodes[0].events.map((e) => e.id)).toEqual(['f1', 'f2', 'f3']);
      expect(nodes[0].ts).toBe(NOW - 1000); // newest in the run
      expect(nodes[0].latest.id).toBe('f1');
    }
  });

  it('leaves a run shorter than the threshold expanded', () => {
    const events = [
      ev('f1', NOW - 1000, 'followup-created'),
      ev('f2', NOW - 2000, 'followup-created')
    ];
    const nodes = clusterFeedNodes(events);
    expect(nodes.map((n) => n.type)).toEqual(['event', 'event']);
  });

  it('never clusters milestone kinds (commit / report / goal / library)', () => {
    const events = [
      ev('c1', NOW - 1000, 'commit'),
      ev('c2', NOW - 2000, 'commit'),
      ev('c3', NOW - 3000, 'commit'),
      ev('c4', NOW - 4000, 'commit')
    ];
    const nodes = clusterFeedNodes(events);
    expect(nodes.every((n) => n.type === 'event')).toBe(true);
  });

  it('only collapses ADJACENT same-kind runs — an interleaved event breaks the run', () => {
    const events = [
      ev('f1', NOW - 1000, 'followup-created'),
      ev('f2', NOW - 2000, 'followup-created'),
      ev('c1', NOW - 2500, 'commit'), // breaks the streak
      ev('f3', NOW - 3000, 'followup-created'),
      ev('f4', NOW - 4000, 'followup-created'),
      ev('f5', NOW - 5000, 'followup-created')
    ];
    const nodes = clusterFeedNodes(events);
    // f1,f2 (run of 2, too short) → 2 events; commit → 1 event; f3-f5 (run of 3) → 1 cluster.
    expect(nodes.map((n) => n.type)).toEqual(['event', 'event', 'event', 'cluster']);
    const cluster = nodes[3];
    if (cluster!.type === 'cluster') {
      expect(cluster.events.map((e) => e.id)).toEqual(['f3', 'f4', 'f5']);
    }
  });

  it('is a no-op for an empty list', () => {
    expect(clusterFeedNodes([])).toEqual([]);
  });
});
