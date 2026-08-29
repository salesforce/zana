/**
 * Feed category registry — the SINGLE source of truth for how each kind of
 * inbox entry surfaces in the feed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ⚠ FEED-IMPACT CONTRACT — READ THIS BEFORE ADDING A NEW INBOX CONCEPT ⚠
 * ─────────────────────────────────────────────────────────────────────────
 * The Inbox is a busy place. Some events fire dozens of times a day (an agent
 * auto-closing, a 5-minute schedule finishing, a heartbeat tripping) — that is
 * NOISE, and it must fold into a collapsed per-project section so it can't bury
 * the things that actually matter. Other events are rare and important (a
 * report, a captured idea, a blocking question, a goal outcome) — that is
 * SIGNAL, and it renders inline as its own solo row so the user sees it at a
 * glance.
 *
 * That signal-vs-noise decision is expressed HERE, once, as `grouped`:
 *   • `grouped: true`  → NOISE  → folded into a collapsible section, one per
 *                        (project, category) — see {@link groupByBucketThenProject}.
 *   • `grouped: false` → SIGNAL → rendered inline, ungrouped, never hidden.
 *
 * When you add a new inbox event type (a new `dedupeKey` prefix, a new push
 * shape, a new concept), you MUST:
 *   1. Add a {@link FeedCategory} entry below with a deliberate `grouped` value.
 *   2. Teach {@link classifyEntry} how to recognise it.
 *   3. Note the coupling in CLAUDE.md ("Feed category registry" coupling note).
 * If you skip this, the entry falls through to the `report` default, which is
 * `grouped: false` ON PURPOSE — a brand-new concept surfaces LOUDLY rather than
 * getting silently swallowed as noise. Getting it wrong is visible, not silent.
 *
 * Reports and ideas are `grouped: false` BY DESIGN and must stay that way — they
 * are the high-value artifacts the whole feed exists to surface; they are never
 * eligible for the auto-scheduler / auto-close style folding, and (see the
 * follow-up below) never eligible for the future LLM noise classifier either.
 *
 * ⚠ TWO DISTINCT "report" concepts — do not conflate:
 *   • The `report` FEED CATEGORY (here) is the un-classified FALLBACK — every
 *     plain push with no other marker lands in it. It's about WHERE an entry
 *     renders (inline SIGNAL).
 *   • The `InboxEntry.report` FLAG (see `isReport()` below + shared/types.ts) is
 *     an EXPLICIT author opt-in (`inbox_push({ report: true })`) marking a
 *     finished deliverable. It's about FINDABILITY — it powers the Reports tab,
 *     the list-pane Reports filter, and the row badge. A flagged entry is always
 *     feed-category `report` too, but the reverse does NOT hold. `classifyEntry`
 *     does NOT read the flag; the report-only UI surfaces read `isReport`.
 *
 * OPTIONAL LLM DEMOTION (the `routine` category, default OFF): a light haiku
 * micro-call (`builtin:feed-noise-classifier`, see `src/main/feed-noise-classifier.ts`
 * + `prompt-registry.ts`, wired like `inbox-summary`) can DEMOTE an ambiguous
 * free-form `report` — a routine "task done" note — into the folded `routine`
 * section, to shave the last bit of noise. It MUST never touch a report WITH
 * docs, an idea, a question, or a goal outcome (those are pinned signal). That
 * guarantee is enforced DETERMINISTICALLY in main (the classifier only ever sees
 * comment-only `report` candidates — Rule-1 "main authorizes, the LLM is advisory
 * within the gate"), and again here in the LAYOUT: the demotion is an OVERLAY of
 * validated entry-ids applied in {@link groupByBucketThenProject}, and it only
 * re-buckets an entry that {@link classifyEntry} already deems `report`. So
 * `classifyEntry` itself STAYS pure and never returns `routine` — the overlay
 * does, and only for reports. The verdict is advisory + non-persisted (recomputed
 * per scope, cached by signature), so the deterministic gate can never drift.
 *
 * This module is PURE (no React, no lucide, no project registry) so both the
 * renderer grouping AND main (`feed-service.ts`) can import it. The `icon` field
 * is a lucide icon NAME (string); the render layer maps it to a component.
 */

import type { InboxEntry } from '@zana-ai/zcc-domain/product';

/**
 * Prefix of the `dedupeKey` the auto-close-idle reaper stamps on its breadcrumb
 * (`auto-close:${sessionId}`). Shared so the "Agent closed" grouping and the
 * reaper agree on one literal. See `src/main/auto-close-idle.ts`.
 */
export const AUTO_CLOSE_KEY_PREFIX = 'auto-close:';

/** Prefix of the `dedupeKey` the heartbeat service stamps when it pauses a
 *  nudged-but-idle agent (`heartbeat:${sessionId}`). See `src/main/heartbeat.ts`. */
export const HEARTBEAT_KEY_PREFIX = 'heartbeat:';

/** Prefix of the `dedupeKey` the goal manager stamps on a goal outcome
 *  (`goal:${projectId}:${goalId}`). See `src/main/goal-manager.ts`. */
export const GOAL_KEY_PREFIX = 'goal:';

/**
 * Every feed category. `report` is the default/fallback (an unclassified entry
 * lands here). Signal categories are `grouped: false`; noise categories fold.
 */
export type FeedCategoryId =
  // ── SIGNAL (grouped: false — inline solo rows, never folded) ──
  | 'report'
  | 'idea'
  | 'question'
  | 'goal'
  // ── NOISE (grouped: true — folded into collapsible per-project sections) ──
  | 'agent-closed'
  | 'scheduled'
  | 'heartbeat'
  | 'follow-up'
  | 'routine'
  | 'system';

export interface FeedCategory {
  id: FeedCategoryId;
  /** Human label — also the collapsible section header for grouped categories. */
  label: string;
  /**
   * The signal-vs-noise decision. `true` → folded into a collapsed section;
   * `false` → rendered inline as a solo row. See the module header contract.
   */
  grouped: boolean;
  /** lucide icon NAME (mapped to a component by the render layer). */
  icon?: string;
  /** One-line rationale — why this is signal or noise. Documentation, not logic. */
  blurb: string;
}

/**
 * The registry. Order of the GROUPED entries here also drives the render order
 * of their collapsible sections within a project sub-group.
 */
export const FEED_CATEGORIES: Record<FeedCategoryId, FeedCategory> = {
  // ── SIGNAL ──────────────────────────────────────────────────────────────
  report: {
    id: 'report',
    label: 'Report',
    grouped: false,
    icon: 'FileText',
    blurb: 'An agent report or free-form status — the primary thing the feed surfaces. Never grouped.'
  },
  idea: {
    id: 'idea',
    label: 'Idea',
    grouped: false,
    icon: 'Lightbulb',
    blurb:
      'A captured idea/brainstorm artifact — high-value, always surfaced solo. Never grouped. ' +
      'NOTE: no inbox producer stamps an idea marker yet, so ideas currently classify as `report` ' +
      '(also SIGNAL/solo — so the "ideas are never grouped" guarantee already holds). Give idea ' +
      'pushes a distinct marker (e.g. an `idea:` dedupeKey prefix) + a `classifyEntry` branch to ' +
      'surface them with the Idea label/icon.'
  },
  question: {
    id: 'question',
    label: 'Question',
    grouped: false,
    icon: 'HelpCircle',
    blurb: 'A blocking question (inbox_ask) awaiting the user — must never be folded away.'
  },
  goal: {
    id: 'goal',
    label: 'Goal',
    grouped: false,
    icon: 'Target',
    blurb: 'A goal outcome (achieved/escalated), always loud — surfaced solo.'
  },
  // ── NOISE ───────────────────────────────────────────────────────────────
  'agent-closed': {
    id: 'agent-closed',
    label: 'Agent closed',
    grouped: true,
    icon: 'MoonStar',
    blurb: 'Idle-reaper breadcrumbs — one per closed session; high volume, folded.'
  },
  scheduled: {
    id: 'scheduled',
    label: 'Scheduled',
    grouped: true,
    icon: 'CalendarClock',
    blurb: 'Recurring background-run notices (quiet). A 5-min job would flood the list; folded.'
  },
  heartbeat: {
    id: 'heartbeat',
    label: 'Paused',
    grouped: true,
    icon: 'PauseCircle',
    blurb: 'Heartbeat-paused notices — one per nudged-idle agent; folded.'
  },
  'follow-up': {
    id: 'follow-up',
    label: 'Follow-ups',
    grouped: true,
    icon: 'ListTodo',
    blurb:
      'Parked follow-up questions/decisions. Declared for when follow-ups surface in the feed; ' +
      'no inbox producer emits this yet (follow-ups live in their own tab today).'
  },
  routine: {
    id: 'routine',
    label: 'Routine',
    grouped: true,
    icon: 'Inbox',
    blurb:
      'A free-form report the OPTIONAL feed-noise LLM classifier judged routine (a "task done" ' +
      'note with no docs/question/goal) and DEMOTED from inline. Never assigned by classifyEntry ' +
      '(which stays pure and only ever returns `report` for these) — it is applied as an advisory, ' +
      'non-persisted overlay in groupByBucketThenProject, and only over entries already deemed ' +
      '`report`. Default OFF; off ⇒ these stay inline reports. See the module header.'
  },
  system: {
    id: 'system',
    label: 'System',
    grouped: true,
    icon: 'Settings',
    blurb:
      'App/system notices (update-available, etc.). Declared for future use; not auto-classified ' +
      'yet — such notices currently fall through to `report`. Give them a marker before folding.'
  }
};

/** Ordered list of grouped (noise) categories — drives render order of the folded sections. */
export const GROUPED_CATEGORY_ORDER: FeedCategoryId[] = (
  Object.values(FEED_CATEGORIES) as FeedCategory[]
)
  .filter((c) => c.grouped)
  .map((c) => c.id);

/**
 * Classify an inbox entry into its feed category.
 *
 * Precedence is deliberate and MUST be preserved:
 *  1. `question`  → 'question' (signal). A question is always solo, even if some
 *     other marker were present — it blocks the user.
 *  2. `auto-close:` dedupeKey → 'agent-closed'. Checked before `scheduled` so a
 *     scheduled run that ALSO auto-closed folds as agent-closed (prefix wins) —
 *     preserves the pre-registry behaviour.
 *  3. `heartbeat:` dedupeKey → 'heartbeat'.
 *  4. `goal:` dedupeKey → 'goal' (signal — loud outcome, surfaced solo).
 *  5. quiet scheduled (`scheduled && notify !== 'loud'`) → 'scheduled'. A LOUD
 *     scheduled entry deliberately falls through to `report` so it renders inline
 *     (an opt-in to surface), matching the prior behaviour.
 *  6. everything else → 'report' (signal). The default is SIGNAL on purpose:
 *     a new/unknown concept surfaces loudly rather than being silently folded.
 *
 * Pure. Exported for tests and for main (`feed-service.ts`) reuse.
 */
export function classifyEntry(
  entry: Pick<InboxEntry, 'dedupeKey' | 'scheduled' | 'notify' | 'question' | 'questions'>
): FeedCategoryId {
  if (entry.question || (entry.questions?.length ?? 0) > 0) return 'question';
  const key = entry.dedupeKey ?? '';
  if (key.startsWith(AUTO_CLOSE_KEY_PREFIX)) return 'agent-closed';
  if (key.startsWith(HEARTBEAT_KEY_PREFIX)) return 'heartbeat';
  if (key.startsWith(GOAL_KEY_PREFIX)) return 'goal';
  if (entry.scheduled && entry.notify !== 'loud') return 'scheduled';
  return 'report';
}

/** Convenience: is this entry NOISE (folded into a collapsed section)? */
export function isGroupedEntry(
  entry: Pick<InboxEntry, 'dedupeKey' | 'scheduled' | 'notify' | 'question' | 'questions'>
): boolean {
  return FEED_CATEGORIES[classifyEntry(entry)].grouped;
}

/** Is this entry an auto-close-idle breadcrumb? Kept for callers that need the
 *  specific check (e.g. feed-service milestone mapping). */
export function isAutoCloseEntry(entry: Pick<InboxEntry, 'dedupeKey'>): boolean {
  return !!entry.dedupeKey && entry.dedupeKey.startsWith(AUTO_CLOSE_KEY_PREFIX);
}

/**
 * Is this entry an EXPLICITLY-FLAGGED report — an `inbox_push({ report: true })`
 * deliverable the user wants to find fast? This reads the author-set
 * {@link InboxEntry.report} flag, NOT the feed CATEGORY `report` (which is the
 * un-classified fallback every plain push lands in). It's the single predicate
 * behind the report-only surfaces (Reports tab, the list-pane Reports filter,
 * the row badge). A flagged report is still a feed-category `report` (SIGNAL,
 * inline) — this flag just makes it findable, it doesn't change where it renders.
 *
 * Deliberately narrow: a doc-bearing but unflagged push is NOT a report here.
 * Distinguishing a deliberate deliverable from a routine status ping is the whole
 * point of the explicit opt-in — see the `report` field doc on {@link InboxEntry}.
 */
export function isReport(entry: Pick<InboxEntry, 'report'>): boolean {
  return entry.report === true;
}
