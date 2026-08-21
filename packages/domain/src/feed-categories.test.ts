import { describe, it, expect } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import {
  FEED_CATEGORIES,
  GROUPED_CATEGORY_ORDER,
  classifyEntry,
  isGroupedEntry,
  isReport,
  AUTO_CLOSE_KEY_PREFIX,
  HEARTBEAT_KEY_PREFIX,
  GOAL_KEY_PREFIX,
  type FeedCategoryId
} from './feed-categories.js';

function e(over: Partial<InboxEntry>): InboxEntry {
  return { id: 'x', ts: 0, projectId: 'p', ...over };
}

describe('FEED_CATEGORIES registry', () => {
  it('every category id maps to a self-consistent entry', () => {
    for (const [id, cat] of Object.entries(FEED_CATEGORIES)) {
      expect(cat.id).toBe(id);
      expect(cat.label.length).toBeGreaterThan(0);
      expect(cat.blurb.length).toBeGreaterThan(0);
      expect(typeof cat.grouped).toBe('boolean');
    }
  });

  it('pins reports, ideas, questions, and goal outcomes as SIGNAL (never grouped)', () => {
    // This is a load-bearing product invariant, not an incidental default:
    // these are the high-value artifacts the feed exists to surface. If a future
    // change flips one to grouped, this test must fail loudly.
    for (const id of ['report', 'idea', 'question', 'goal'] as FeedCategoryId[]) {
      expect(FEED_CATEGORIES[id].grouped).toBe(false);
    }
  });

  it('folds high-volume recurring event types as NOISE', () => {
    for (const id of ['agent-closed', 'scheduled', 'heartbeat', 'follow-up', 'routine', 'system'] as FeedCategoryId[]) {
      expect(FEED_CATEGORIES[id].grouped).toBe(true);
    }
  });

  it('never returns the overlay-only `routine` category from classifyEntry', () => {
    // `routine` is applied ONLY by the grouping overlay, never by classifyEntry —
    // the deterministic classifier stays pure and unaware of the LLM verdict.
    const cases: Partial<InboxEntry>[] = [
      {},
      { comments: 'done' },
      { scheduled: true, notify: 'quiet' },
      { dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}s1` },
      { dedupeKey: `${GOAL_KEY_PREFIX}p:g1` },
      { question: { options: [] } }
    ];
    for (const c of cases) expect(classifyEntry(e(c))).not.toBe('routine');
  });

  it('GROUPED_CATEGORY_ORDER lists exactly the grouped categories', () => {
    const grouped = (Object.values(FEED_CATEGORIES))
      .filter((c) => c.grouped)
      .map((c) => c.id)
      .sort();
    expect([...GROUPED_CATEGORY_ORDER].sort()).toEqual(grouped);
  });
});

describe('classifyEntry', () => {
  it('a plain entry defaults to report (SIGNAL) — a new/unknown concept surfaces loudly', () => {
    expect(classifyEntry(e({}))).toBe('report');
    expect(isGroupedEntry(e({}))).toBe(false);
  });

  it('a question is always classified question, even when scheduled', () => {
    expect(classifyEntry(e({ scheduled: true, question: { options: [] } }))).toBe('question');
  });

  it('a multi-question (`questions`) entry is also classified question', () => {
    expect(
      classifyEntry(e({ scheduled: true, questions: [{ prompt: 'q', options: [] }] }))
    ).toBe('question');
    // An empty questions array is NOT a question — falls through to default.
    expect(classifyEntry(e({ questions: [] }))).toBe('report');
  });

  it('auto-close dedupeKey → agent-closed (prefix wins over scheduled)', () => {
    expect(classifyEntry(e({ scheduled: true, dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}s1` }))).toBe(
      'agent-closed'
    );
  });

  it('heartbeat dedupeKey → heartbeat', () => {
    expect(classifyEntry(e({ dedupeKey: `${HEARTBEAT_KEY_PREFIX}s1` }))).toBe('heartbeat');
  });

  it('goal dedupeKey → goal (SIGNAL)', () => {
    expect(classifyEntry(e({ dedupeKey: `${GOAL_KEY_PREFIX}p:g1`, notify: 'loud' }))).toBe('goal');
    expect(isGroupedEntry(e({ dedupeKey: `${GOAL_KEY_PREFIX}p:g1` }))).toBe(false);
  });

  it('quiet scheduled → scheduled; loud scheduled → report (inline opt-in)', () => {
    expect(classifyEntry(e({ scheduled: true, notify: 'quiet' }))).toBe('scheduled');
    expect(classifyEntry(e({ scheduled: true }))).toBe('scheduled');
    expect(classifyEntry(e({ scheduled: true, notify: 'loud' }))).toBe('report');
  });
});

describe('isReport', () => {
  it('is true ONLY for the explicit `report: true` flag', () => {
    expect(isReport(e({ report: true }))).toBe(true);
    expect(isReport(e({ report: false }))).toBe(false);
    expect(isReport(e({}))).toBe(false);
  });

  it('is independent of the `report` FEED CATEGORY (a plain fallback report is not flagged)', () => {
    // A plain comment classifies as the `report` category (fallback) but is NOT
    // an explicitly-flagged report — the two are deliberately distinct.
    const plain = e({ comments: 'status update' });
    expect(classifyEntry(plain)).toBe('report');
    expect(isReport(plain)).toBe(false);
  });

  it('a docs-bearing but unflagged push is not a report (opt-in only, no heuristic)', () => {
    expect(isReport(e({ docs: [{ path: 'report.md' }] }))).toBe(false);
    expect(isReport(e({ docs: [{ path: 'report.md' }], report: true }))).toBe(true);
  });
});
