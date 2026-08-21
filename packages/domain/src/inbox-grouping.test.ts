import { describe, it, expect } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import {
  groupByBucketThenProject,
  groupByBucketFlat,
  flattenVisible,
  flattenVisibleFlat,
  groupedSectionKey,
  isAutoCloseEntry,
  AUTO_CLOSE_KEY_PREFIX,
  type Bucket,
  type ProjectSubGroup
} from './inbox-grouping.js';
import { HEARTBEAT_KEY_PREFIX, GOAL_KEY_PREFIX } from './feed-categories.js';

// Fixed "now" so bucket thresholds are deterministic: noon on a known day.
const NOW = new Date('2026-06-11T12:00:00').getTime();
const DAY = 86_400_000;

function entry(over: Partial<InboxEntry> & { id: string; ts: number }): InboxEntry {
  return {
    projectId: 'p1',
    comments: 'hello',
    ...over
  };
}

/** Convenience: map bucket → array of [projectId, entryIds[]] for assertions. */
function shape(groups: Array<[Bucket, ProjectSubGroup[]]>) {
  return groups.map(([bucket, sgs]) => [
    bucket,
    sgs.map((sg) => [sg.projectId, sg.entries.map((e) => e.id)])
  ]);
}

/** Pull one folded section's entry ids out of a sub-group, or [] if absent. */
function sectionIds(sg: ProjectSubGroup, category: string): string[] {
  return sg.groupedSections.find((s) => s.category === category)?.entries.map((e) => e.id) ?? [];
}

describe('groupByBucketThenProject', () => {
  it('returns [] for empty input', () => {
    expect(groupByBucketThenProject([], NOW)).toEqual([]);
  });

  it('assigns entries to the right time buckets', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'today', ts: NOW - 1000 }),
      entry({ id: 'yest', ts: NOW - 1.5 * DAY }),
      entry({ id: 'week', ts: NOW - 3 * DAY }),
      entry({ id: 'old', ts: NOW - 30 * DAY })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    expect(groups.map(([b]) => b)).toEqual(['Today', 'Yesterday', 'This week', 'Older']);
  });

  it('omits empty buckets', () => {
    const entries = [entry({ id: 'a', ts: NOW - 1000 })];
    const groups = groupByBucketThenProject(entries, NOW);
    expect(groups.map(([b]) => b)).toEqual(['Today']);
  });

  it('orders project sub-groups by most-recent entry within a bucket', () => {
    // Newest-first input: project B's newest entry precedes A's newest.
    const entries: InboxEntry[] = [
      entry({ id: 'b1', projectId: 'B', ts: NOW - 1000 }),
      entry({ id: 'a1', projectId: 'A', ts: NOW - 2000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    expect(shape(groups)).toEqual([['Today', [['B', ['b1']], ['A', ['a1']]]]]);
  });

  it('collapses interleaved projects into one sub-group each, newest-first within', () => {
    // Input A,B,A (newest-first) → groups [A(2), B(1)] because A seen first.
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'b1', projectId: 'B', ts: NOW - 2000 }),
      entry({ id: 'a2', projectId: 'A', ts: NOW - 3000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    expect(shape(groups)).toEqual([['Today', [['A', ['a1', 'a2']], ['B', ['b1']]]]]);
  });

  it('folds scheduled entries into a "scheduled" section, out of the inline list', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 's1', projectId: 'A', ts: NOW - 2000, scheduled: true }),
      entry({ id: 's2', projectId: 'A', ts: NOW - 3000, scheduled: true }),
      entry({ id: 'a2', projectId: 'A', ts: NOW - 4000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].entries.map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(sectionIds(sgs[0], 'scheduled')).toEqual(['s1', 's2']);
  });

  it('renders loud scheduled entries inline, not in the folded section', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'loud', projectId: 'A', ts: NOW - 2000, scheduled: true, notify: 'loud' }),
      entry({ id: 'quiet', projectId: 'A', ts: NOW - 3000, scheduled: true, notify: 'quiet' })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    // Loud joins the inline list; quiet stays folded.
    expect(sgs[0].entries.map((e) => e.id)).toEqual(['a1', 'loud']);
    expect(sectionIds(sgs[0], 'scheduled')).toEqual(['quiet']);
  });

  it('renders an explicitly-flagged report inline even when it is quiet-scheduled', () => {
    // Companion to the TIME-view regression: the report flag forces signal, so a
    // flagged deliverable pushed by a quiet scheduled run lands inline, not in
    // the folded "scheduled" section.
    const entries: InboxEntry[] = [
      entry({ id: 'flagged', projectId: 'A', ts: NOW - 1000, report: true, scheduled: true, notify: 'quiet' })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].entries.map((e) => e.id)).toEqual(['flagged']);
    expect(sectionIds(sgs[0], 'scheduled')).toEqual([]);
  });

  it('folds heartbeat notices into a "heartbeat" section', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'hb', projectId: 'A', ts: NOW - 2000, dedupeKey: `${HEARTBEAT_KEY_PREFIX}s1` })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].entries.map((e) => e.id)).toEqual(['a1']);
    expect(sectionIds(sgs[0], 'heartbeat')).toEqual(['hb']);
  });

  it('keeps goal outcomes inline (SIGNAL, never folded)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'g', projectId: 'A', ts: NOW - 1000, dedupeKey: `${GOAL_KEY_PREFIX}A:g1`, notify: 'loud' })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].entries.map((e) => e.id)).toEqual(['g']);
    expect(sgs[0].groupedSections).toEqual([]);
  });

  it('keeps questions inline (SIGNAL, never folded) even when scheduled', () => {
    const entries: InboxEntry[] = [
      entry({
        id: 'q',
        projectId: 'A',
        ts: NOW - 1000,
        scheduled: true,
        question: { options: [{ id: 'A', label: 'Yes' }] }
      })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].entries.map((e) => e.id)).toEqual(['q']);
    expect(sgs[0].groupedSections).toEqual([]);
  });

  it('emits folded sections in registry order (agent-closed before scheduled)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'sched', projectId: 'A', ts: NOW - 1000, scheduled: true }),
      entry({ id: 'ac', projectId: 'A', ts: NOW - 2000, dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}s1` })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].groupedSections.map((s) => s.category)).toEqual(['agent-closed', 'scheduled']);
  });

  describe('routineIds overlay (feed-noise classifier)', () => {
    it('demotes a flagged report into the folded "routine" section', () => {
      const entries: InboxEntry[] = [
        entry({ id: 'r1', projectId: 'A', ts: NOW - 1000 }),
        entry({ id: 'r2', projectId: 'A', ts: NOW - 2000 })
      ];
      const groups = groupByBucketThenProject(entries, NOW, new Set(['r2']));
      const [, sgs] = groups[0];
      expect(sgs[0].entries.map((e) => e.id)).toEqual(['r1']);
      expect(sectionIds(sgs[0], 'routine')).toEqual(['r2']);
    });

    it('is a no-op when the overlay is omitted or empty (feature off)', () => {
      const entries: InboxEntry[] = [entry({ id: 'r1', projectId: 'A', ts: NOW - 1000 })];
      expect(sectionIds(groupByBucketThenProject(entries, NOW)[0][1][0], 'routine')).toEqual([]);
      expect(
        sectionIds(groupByBucketThenProject(entries, NOW, new Set())[0][1][0], 'routine')
      ).toEqual([]);
    });

    it('never demotes pinned SIGNAL, even if its id is in the overlay', () => {
      // A rogue/stale id for a question, goal, or doc-bearing entry must not
      // re-bucket it — the overlay is guarded to `report` only.
      const entries: InboxEntry[] = [
        entry({ id: 'q', projectId: 'A', ts: NOW - 1000, question: { options: [{ id: 'A', label: 'Y' }] } }),
        entry({ id: 'g', projectId: 'A', ts: NOW - 2000, dedupeKey: `${GOAL_KEY_PREFIX}A:g1` }),
        entry({ id: 'r', projectId: 'A', ts: NOW - 3000 })
      ];
      const groups = groupByBucketThenProject(entries, NOW, new Set(['q', 'g', 'r']));
      const [, sgs] = groups[0];
      // q + g stay inline signal; only the real report r is demoted.
      expect(sgs[0].entries.map((e) => e.id)).toEqual(['q', 'g']);
      expect(sectionIds(sgs[0], 'routine')).toEqual(['r']);
    });
  });

  describe('excludeIds (pinned-question de-dup)', () => {
    it('drops excluded entries from the layout entirely', () => {
      const entries: InboxEntry[] = [
        entry({ id: 'q1', projectId: 'A', ts: NOW - 1000 }),
        entry({ id: 'r1', projectId: 'A', ts: NOW - 2000 })
      ];
      const groups = groupByBucketThenProject(entries, NOW, undefined, new Set(['q1']));
      expect(shape(groups)).toEqual([['Today', [['A', ['r1']]]]]);
    });

    it('drops a whole sub-group when all its entries are excluded', () => {
      const entries: InboxEntry[] = [
        entry({ id: 'q1', projectId: 'A', ts: NOW - 1000 }),
        entry({ id: 'r1', projectId: 'B', ts: NOW - 2000 })
      ];
      const groups = groupByBucketThenProject(entries, NOW, undefined, new Set(['q1']));
      expect(shape(groups)).toEqual([['Today', [['B', ['r1']]]]]);
    });

    it('is a no-op when omitted or empty', () => {
      const entries: InboxEntry[] = [entry({ id: 'a', projectId: 'A', ts: NOW - 1000 })];
      expect(shape(groupByBucketThenProject(entries, NOW))).toEqual([['Today', [['A', ['a']]]]]);
      expect(shape(groupByBucketThenProject(entries, NOW, undefined, new Set()))).toEqual([
        ['Today', [['A', ['a']]]]
      ]);
    });

    it('excludes a noise entry too (works regardless of category)', () => {
      const entries: InboxEntry[] = [
        entry({ id: 'r1', projectId: 'A', ts: NOW - 1000 }),
        entry({ id: 'ac', projectId: 'A', ts: NOW - 2000, dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}x` })
      ];
      const groups = groupByBucketThenProject(entries, NOW, undefined, new Set(['ac']));
      const [, sgs] = groups[0];
      expect(sgs[0].entries.map((e) => e.id)).toEqual(['r1']);
      expect(sgs[0].groupedSections).toEqual([]);
    });
  });

  it('uses projectLabel as fallbackLabel, else projectId', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a', projectId: 'P-with-label', projectLabel: 'My Project', ts: NOW - 1000 }),
      entry({ id: 'b', projectId: 'P-no-label', ts: NOW - 2000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].fallbackLabel).toBe('My Project');
    expect(sgs[1].fallbackLabel).toBe('P-no-label');
  });
});

describe('flattenVisible', () => {
  it('flattens to entry ids in render order (bucket → project → entry)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'b1', projectId: 'B', ts: NOW - 2000 }),
      entry({ id: 'a2', projectId: 'A', ts: NOW - 3000 }),
      entry({ id: 'old', projectId: 'A', ts: NOW - 30 * DAY })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    // Today: A[a1,a2], B[b1]; Older: A[old]
    expect(flattenVisible(groups)).toEqual(['a1', 'a2', 'b1', 'old']);
  });

  it('returns [] for empty groups', () => {
    expect(flattenVisible([])).toEqual([]);
  });

  it('excludes folded rows when their section is collapsed', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 's1', projectId: 'A', ts: NOW - 2000, scheduled: true })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    // No expanded set → collapsed → scheduled id absent.
    expect(flattenVisible(groups)).toEqual(['a1']);
  });

  it('includes folded rows when their section is expanded', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 's1', projectId: 'A', ts: NOW - 2000, scheduled: true })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const expanded = new Set([groupedSectionKey('Today', 'A', 'scheduled')]);
    expect(flattenVisible(groups, expanded)).toEqual(['a1', 's1']);
  });

  it('expands each folded section independently (own key per category)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 's1', projectId: 'A', ts: NOW - 2000, scheduled: true }),
      entry({ id: 'ac1', projectId: 'A', ts: NOW - 3000, dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}x` })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    // Expand ONLY the agent-closed section — the scheduled row stays hidden.
    const autoExpanded = new Set([groupedSectionKey('Today', 'A', 'agent-closed')]);
    expect(flattenVisible(groups, autoExpanded)).toEqual(['a1', 'ac1']);
  });

  it('skips a collapsed project sub-group entirely', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'b1', projectId: 'B', ts: NOW - 2000 }),
      entry({ id: 'a2', projectId: 'A', ts: NOW - 3000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    // Collapse project A → only B's row remains navigable.
    expect(flattenVisible(groups, undefined, (sg) => sg.projectId === 'A')).toEqual(['b1']);
  });

  it('collapsing the project sub-group also hides its folded rows', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'ac1', projectId: 'A', ts: NOW - 2000, dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}x` }),
      entry({ id: 'b1', projectId: 'B', ts: NOW - 3000 })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const autoExpanded = new Set([groupedSectionKey('Today', 'A', 'agent-closed')]);
    // Even with the folded section "expanded", a collapsed parent wins.
    expect(flattenVisible(groups, autoExpanded, (sg) => sg.projectId === 'A')).toEqual(['b1']);
  });

  it('passes the bucket to the collapse predicate (recency-driven default)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'today', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'old', projectId: 'A', ts: NOW - 30 * DAY })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    // Default rule: only "Today" expands; older buckets collapse.
    const collapseOlder = (_sg: ProjectSubGroup, bucket: string) => bucket !== 'Today';
    expect(flattenVisible(groups, undefined, collapseOlder)).toEqual(['today']);
  });
});

describe('isAutoCloseEntry', () => {
  it('matches only entries whose dedupeKey starts with the reaper prefix', () => {
    expect(isAutoCloseEntry({ dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}sess-1` })).toBe(true);
    expect(isAutoCloseEntry({ dedupeKey: 'inbox-summary:p1' })).toBe(false);
    expect(isAutoCloseEntry({ dedupeKey: undefined })).toBe(false);
    expect(isAutoCloseEntry({ dedupeKey: '' })).toBe(false);
  });
});

describe('auto-close grouping (prefix precedence)', () => {
  it('folds auto-close breadcrumbs into the agent-closed section', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'a1', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'ac1', projectId: 'A', ts: NOW - 2000, dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}s1` }),
      entry({ id: 'sched', projectId: 'A', ts: NOW - 3000, scheduled: true }),
      entry({ id: 'ac2', projectId: 'A', ts: NOW - 4000, dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}s2` })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sgs[0].entries.map((e) => e.id)).toEqual(['a1']);
    expect(sectionIds(sgs[0], 'scheduled')).toEqual(['sched']);
    expect(sectionIds(sgs[0], 'agent-closed')).toEqual(['ac1', 'ac2']);
  });

  it('classifies a scheduled entry that is ALSO auto-close as agent-closed (prefix wins)', () => {
    const entries: InboxEntry[] = [
      entry({
        id: 'ac',
        projectId: 'A',
        ts: NOW - 1000,
        scheduled: true,
        dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}s1`
      })
    ];
    const groups = groupByBucketThenProject(entries, NOW);
    const [, sgs] = groups[0];
    expect(sectionIds(sgs[0], 'scheduled')).toEqual([]);
    expect(sectionIds(sgs[0], 'agent-closed')).toEqual(['ac']);
  });
});

describe('groupByBucketFlat (TIME view)', () => {
  it('returns [] for empty input', () => {
    expect(groupByBucketFlat([], NOW)).toEqual([]);
  });

  it('buckets by day, flat and newest-first, ignoring project', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'b1', projectId: 'B', ts: NOW - 1000 }),
      entry({ id: 'a1', projectId: 'A', ts: NOW - 2000 }),
      entry({ id: 'y1', projectId: 'A', ts: NOW - 1.5 * DAY })
    ];
    const groups = groupByBucketFlat(entries, NOW);
    expect(groups.map(([b, list]) => [b, list.map((e) => e.id)])).toEqual([
      ['Today', ['b1', 'a1']],
      ['Yesterday', ['y1']]
    ]);
  });

  it('drops NOISE (scheduled/heartbeat/agent-closed) — signal only', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'sig', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'sched', projectId: 'A', ts: NOW - 2000, scheduled: true, notify: 'quiet' }),
      entry({ id: 'hb', projectId: 'A', ts: NOW - 3000, dedupeKey: `${HEARTBEAT_KEY_PREFIX}s1` }),
      entry({ id: 'ac', projectId: 'A', ts: NOW - 4000, dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}s1` })
    ];
    const groups = groupByBucketFlat(entries, NOW);
    expect(groups).toEqual([['Today', [entries[0]]]]);
  });

  it('keeps loud scheduled + goal + question entries (they are signal)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'loud', projectId: 'A', ts: NOW - 1000, scheduled: true, notify: 'loud' }),
      entry({ id: 'goal', projectId: 'A', ts: NOW - 2000, dedupeKey: `${GOAL_KEY_PREFIX}A:g1`, notify: 'loud' }),
      entry({ id: 'q', projectId: 'A', ts: NOW - 3000, scheduled: true, question: { options: [{ id: 'A', label: 'Yes' }] } })
    ];
    const groups = groupByBucketFlat(entries, NOW);
    expect(groups[0][1].map((e) => e.id)).toEqual(['loud', 'goal', 'q']);
  });

  it('demotes a routine-flagged report via the overlay (dropped, not shown)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'keep', projectId: 'A', ts: NOW - 1000 }),
      entry({ id: 'routine', projectId: 'A', ts: NOW - 2000 })
    ];
    const groups = groupByBucketFlat(entries, NOW, new Set(['routine']));
    expect(groups[0][1].map((e) => e.id)).toEqual(['keep']);
  });

  it('keeps an explicitly-flagged report that is ALSO quiet-scheduled (report flag forces signal)', () => {
    // Regression: a `report: true` deliverable that a scheduled run pushed with
    // notify:'quiet' classifies as `scheduled` (noise) — it used to be dropped
    // here while the Reports-tab badge still counted it via isReport, so the tab
    // showed "1" over an empty list. The flag forces it back to signal.
    const entries: InboxEntry[] = [
      entry({ id: 'flagged', projectId: 'A', ts: NOW - 1000, report: true, scheduled: true, notify: 'quiet' })
    ];
    const groups = groupByBucketFlat(entries, NOW);
    expect(groups[0][1].map((e) => e.id)).toEqual(['flagged']);
  });

  it('a routine overlay still demotes a flagged report (overlay applies after the flag)', () => {
    const entries: InboxEntry[] = [
      entry({ id: 'flagged', projectId: 'A', ts: NOW - 1000, report: true, scheduled: true, notify: 'quiet' })
    ];
    const groups = groupByBucketFlat(entries, NOW, new Set(['flagged']));
    expect(groups).toEqual([]);
  });
});

describe('flattenVisibleFlat', () => {
  it('walks buckets then rows, in order', () => {
    const groups = groupByBucketFlat(
      [
        entry({ id: 'b1', ts: NOW - 1000 }),
        entry({ id: 'a1', ts: NOW - 2000 }),
        entry({ id: 'y1', ts: NOW - 1.5 * DAY })
      ],
      NOW
    );
    expect(flattenVisibleFlat(groups)).toEqual(['b1', 'a1', 'y1']);
  });
});
