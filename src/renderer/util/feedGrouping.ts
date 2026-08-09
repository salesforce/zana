import type { FeedEvent, FeedEventKind } from '../../shared/types.js';

/**
 * Feed grouping: a single-project timeline bucketed by recency.
 *
 * Simpler than {@link ./inboxGrouping}: the Activity Feed is always scoped to
 * ONE project (the focused/opened one), so there are no per-project sub-groups
 * and no scheduled/auto-closed splits — just a day-aligned recency bucket per
 * event, newest-first within each bucket. Pure (no React, no registry) so it's
 * unit-testable; the render layer owns icon/label/time formatting.
 */

export type FeedBucket = 'Today' | 'Yesterday' | 'This week' | 'Older';

const BUCKET_ORDER: FeedBucket[] = ['Today', 'Yesterday', 'This week', 'Older'];

/** Assign one event to its time bucket using day-aligned thresholds. */
export function feedBucketFor(ts: number, now: number): FeedBucket {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const yesterday = today - 86_400_000;
  const weekStart = today - 6 * 86_400_000;
  if (ts >= today) return 'Today';
  if (ts >= yesterday) return 'Yesterday';
  if (ts >= weekStart) return 'This week';
  return 'Older';
}

/**
 * Group feed events by time bucket. Input is expected newest-first (the
 * service's order). Buckets appear in canonical order; empty buckets are
 * omitted; events within a bucket keep the newest-first input order.
 *
 * Pure: takes `now` for deterministic testing (defaults to Date.now()).
 */
export function groupFeedByBucket(
  events: readonly FeedEvent[],
  now: number = Date.now()
): Array<[FeedBucket, FeedEvent[]]> {
  const byBucket = new Map<FeedBucket, FeedEvent[]>();
  for (const b of BUCKET_ORDER) byBucket.set(b, []);

  for (const e of events) {
    byBucket.get(feedBucketFor(e.ts, now))!.push(e);
  }

  const result: Array<[FeedBucket, FeedEvent[]]> = [];
  for (const bucket of BUCKET_ORDER) {
    const list = byBucket.get(bucket)!;
    if (list.length > 0) result.push([bucket, list]);
  }
  return result;
}

/* --------------------------------- clustering ------------------------------ */

/**
 * Kinds worth collapsing when they arrive in a run: the high-volume,
 * individually-low-signal events (follow-up churn, auto-closed sessions,
 * scheduled runs, extension lifecycle). Milestones people actually scan for
 * — commits, achieved goals, agent reports, library docs — are NEVER
 * collapsed, so the timeline still reads as a list of outcomes.
 */
const CLUSTERABLE_KINDS: ReadonlySet<FeedEventKind> = new Set<FeedEventKind>([
  'followup-created',
  'followup-resolved',
  'session-finished',
  'schedule-run',
  'extension-installed',
  'extension-uninstalled'
]);

/** Minimum run length before a same-kind streak collapses into one cluster. */
export const CLUSTER_MIN_RUN = 3;

/**
 * A timeline node: either a single {@link FeedEvent} or a collapsed CLUSTER of
 * consecutive same-kind events (e.g. "5 follow-ups"). Clusters keep their
 * members (newest-first) so the UI can expand them in place.
 */
export type FeedNode =
  | { type: 'event'; event: FeedEvent }
  | { type: 'cluster'; kind: FeedEventKind; events: FeedEvent[]; ts: number; latest: FeedEvent };

/**
 * Collapse runs of ≥{@link CLUSTER_MIN_RUN} consecutive clusterable events of
 * the SAME kind into a single cluster node, preserving order. Input is expected
 * newest-first (the service's / bucket's order). Pure.
 *
 * Only ADJACENT same-kind runs collapse — interleaving a commit or report
 * between two follow-ups keeps them as separate rows, so we never hide an event
 * behind an unrelated one. A run shorter than the threshold stays expanded.
 */
export function clusterFeedNodes(events: readonly FeedEvent[]): FeedNode[] {
  const nodes: FeedNode[] = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i]!;
    if (!CLUSTERABLE_KINDS.has(ev.kind)) {
      nodes.push({ type: 'event', event: ev });
      i += 1;
      continue;
    }
    // Extend the run while the next event shares this kind.
    let j = i + 1;
    while (j < events.length && events[j]!.kind === ev.kind) j += 1;
    const run = events.slice(i, j);
    if (run.length >= CLUSTER_MIN_RUN) {
      nodes.push({
        type: 'cluster',
        kind: ev.kind,
        events: run,
        ts: run[0]!.ts, // newest in the run (input is newest-first)
        latest: run[0]!
      });
    } else {
      for (const e of run) nodes.push({ type: 'event', event: e });
    }
    i = j;
  }
  return nodes;
}
