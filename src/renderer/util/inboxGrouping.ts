import type { InboxEntry } from '../../shared/types.js';
import {
  FEED_CATEGORIES,
  GROUPED_CATEGORY_ORDER,
  classifyEntry,
  isReport,
  type FeedCategoryId
} from './feedCategories.js';

// Re-export the auto-close constant + predicate from the registry so existing
// importers (feed-service, tests) keep working from either module.
export { AUTO_CLOSE_KEY_PREFIX, isAutoCloseEntry } from './feedCategories.js';

/**
 * Inbox grouping: time bucket (top level) → project sub-group (nested) →
 * signal-inline + folded noise sections.
 *
 * The sidebar buckets entries by recency, sub-groups them by project so the
 * user can scan "what happened in <project> today", and — within each project —
 * splits SIGNAL from NOISE. Signal (reports, ideas, questions, goal outcomes)
 * renders inline as solo rows. Noise (agent-closed, scheduled, heartbeat, …)
 * folds into one collapsible section per category so high-volume, repetitive
 * events can't bury the important ones.
 *
 * The signal-vs-noise decision is NOT made here — it's the {@link FEED_CATEGORIES}
 * registry's job ({@link classifyEntry}). This module is the pure LAYOUT engine
 * over that decision: no React, no project registry, so it's unit-testable and
 * the render layer owns live name/color/icon resolution.
 *
 * ⚠ Adding a new inbox event type? See the contract in `feedCategories.ts` —
 * you declare its feed impact there, and this module folds (or doesn't) for free.
 */

export type Bucket = 'Today' | 'Yesterday' | 'This week' | 'Older';

/** One folded (collapsible) section of NOISE entries within a project sub-group. */
export interface GroupedSection {
  /** The feed category this section represents. */
  category: FeedCategoryId;
  /** Section header label (from the registry). */
  label: string;
  /** lucide icon name (from the registry), if any. */
  icon?: string;
  /** Entries in this section, newest-first. Non-empty (empty sections are dropped). */
  entries: InboxEntry[];
}

export interface ProjectSubGroup {
  projectId: string;
  /**
   * Display fallback from the entry snapshot (`projectLabel ?? projectId`).
   * The render layer overrides this with the live project name when the
   * project still exists; for a tombstoned project this is all we have.
   */
  fallbackLabel: string;
  /**
   * SIGNAL entries for this project within the bucket, newest-first. These are
   * the ungrouped categories (report, idea, question, goal outcome) — they
   * render inline as normal rows and are NEVER folded away.
   */
  entries: InboxEntry[];
  /**
   * NOISE entries, split into one folded section per category, in
   * {@link GROUPED_CATEGORY_ORDER}. Only non-empty sections appear. The render
   * layer collapses each into a single expandable header (e.g. "Agent closed",
   * "Scheduled") so high-volume recurring events don't flood the per-project
   * list. Replaces the former hardcoded `scheduledEntries`/`autoClosedEntries`.
   */
  groupedSections: GroupedSection[];
}

/** Stable key for a (bucket, project) sub-group — used for whole-project collapse state. */
export function subGroupKey(bucket: Bucket, projectId: string): string {
  return `${bucket}::${projectId}`;
}

/**
 * Stable key for one folded (bucket, project, category) NOISE section's expand
 * state. Category is part of the key so each section (Agent closed, Scheduled,
 * …) collapses independently within the same project.
 */
export function groupedSectionKey(
  bucket: Bucket,
  projectId: string,
  category: FeedCategoryId
): string {
  return `${bucket}::${projectId}::${category}`;
}

const BUCKET_ORDER: Bucket[] = ['Today', 'Yesterday', 'This week', 'Older'];

/** Assign one entry to its time bucket using day-aligned thresholds. */
function bucketFor(ts: number, now: number): Bucket {
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

/** Accumulator holds the signal list + a per-category noise map while building. */
interface SubGroupAccum {
  projectId: string;
  fallbackLabel: string;
  entries: InboxEntry[];
  noise: Map<FeedCategoryId, InboxEntry[]>;
}

/**
 * Group entries by time bucket, then by project, then split signal-inline from
 * folded-noise sections via {@link classifyEntry}.
 *
 * Input is expected newest-first (the store's order). Properties:
 *  - Buckets appear in canonical order; empty buckets are omitted.
 *  - Within a bucket, project sub-groups are ordered by their most-recent entry.
 *  - Entries keep the newest-first input order within each list/section.
 *  - Signal categories (report/idea/question/goal) land in `entries` (inline).
 *  - Noise categories fold into `groupedSections`, ordered by
 *    {@link GROUPED_CATEGORY_ORDER}; empty sections are dropped.
 *
 * `routineIds` is the OPTIONAL feed-noise classifier's advisory overlay: a set
 * of entry ids the `builtin:feed-noise-classifier` micro-call judged routine
 * (see `feedCategories.ts` header). It DEMOTES matching entries into the folded
 * `routine` noise section — but ONLY entries that {@link classifyEntry} already
 * deems `report` (a doc/idea/question/goal-bearing entry in the overlay is
 * ignored, a belt-and-suspenders echo of main's deterministic gate). Omitted /
 * empty ⇒ nothing is demoted (the feature is off), so the default layout is
 * exactly the pre-overlay behaviour.
 *
 * `excludeIds` drops entries whose id is in the set from the layout entirely —
 * they land in NO bucket, signal or noise. The sidebar uses this to prevent a
 * pending question that's already shown in the pinned "NEEDS YOUR ANSWER" band
 * from ALSO rendering a second time inline in its time bucket (the band is a
 * single home, not a duplicate surface). Omitted / empty ⇒ nothing is excluded.
 *
 * Pure: takes `now` for deterministic testing (defaults to Date.now()).
 */
/**
 * The effective feed category for LAYOUT, honouring the explicit `report: true`
 * flag and the advisory routine overlay on top of {@link classifyEntry}.
 *
 * `classifyEntry` is pure and flag-blind: it can only see the shape of a push
 * (question / dedupeKey prefix / scheduled+notify), so a deliberately-flagged
 * report that ALSO happens to be a quiet-scheduled push classifies as
 * `scheduled` (noise) and would be folded/dropped. But `report: true` is the
 * author's opt-in "this is a deliverable, keep it findable" — it MUST surface as
 * SIGNAL. So an explicitly-flagged report is forced to the `report` category
 * here, which also keeps the Reports-tab badge count (`isReport`) in lockstep
 * with what the Reports/time views actually render (the two used to disagree:
 * badge said 1, list was empty). The routine overlay still applies afterwards —
 * a flagged report the classifier judged routine is demotable like any other.
 */
function effectiveCategory(
  e: InboxEntry,
  routineIds?: ReadonlySet<string>
): FeedCategoryId {
  let category = classifyEntry(e);
  if (isReport(e)) category = 'report';
  if (category === 'report' && routineIds?.has(e.id)) category = 'routine';
  return category;
}

export function groupByBucketThenProject(
  entries: readonly InboxEntry[],
  now: number = Date.now(),
  routineIds?: ReadonlySet<string>,
  excludeIds?: ReadonlySet<string>
): Array<[Bucket, ProjectSubGroup[]]> {
  const byBucket = new Map<Bucket, Map<string, SubGroupAccum>>();
  for (const b of BUCKET_ORDER) byBucket.set(b, new Map());

  for (const e of entries) {
    if (excludeIds?.has(e.id)) continue;
    const bucket = bucketFor(e.ts, now);
    const groups = byBucket.get(bucket)!;
    let sg = groups.get(e.projectId);
    if (!sg) {
      sg = {
        projectId: e.projectId,
        fallbackLabel: e.projectLabel ?? e.projectId,
        entries: [],
        noise: new Map()
      };
      groups.set(e.projectId, sg);
    }
    // Effective category honours the explicit `report: true` flag (forced
    // signal) then the advisory routine overlay — see effectiveCategory. The
    // overlay is guarded to `report` there, so it can never re-bucket pinned
    // signal (idea / question / goal) even if a stale/rogue id sneaks in.
    const category = effectiveCategory(e, routineIds);
    if (FEED_CATEGORIES[category].grouped) {
      const list = sg.noise.get(category);
      if (list) list.push(e);
      else sg.noise.set(category, [e]);
    } else {
      sg.entries.push(e);
    }
  }

  const result: Array<[Bucket, ProjectSubGroup[]]> = [];
  for (const bucket of BUCKET_ORDER) {
    const groups = byBucket.get(bucket)!;
    if (groups.size === 0) continue;
    const subgroups: ProjectSubGroup[] = [...groups.values()].map((acc) => ({
      projectId: acc.projectId,
      fallbackLabel: acc.fallbackLabel,
      entries: acc.entries,
      // Emit folded sections in the registry's canonical order, skipping empties.
      groupedSections: GROUPED_CATEGORY_ORDER.flatMap((cat) => {
        const list = acc.noise.get(cat);
        if (!list || list.length === 0) return [];
        const meta = FEED_CATEGORIES[cat];
        return [{ category: cat, label: meta.label, icon: meta.icon, entries: list }];
      })
    }));
    result.push([bucket, subgroups]);
  }
  return result;
}

/**
 * TIME view: group entries by day bucket ONLY, keeping newest-first order within
 * each bucket — a flat chronological stream, no per-project sub-grouping. This is
 * the twin of {@link groupByBucketThenProject} for the inbox's "by time" toggle.
 *
 * NOISE is dropped: only SIGNAL categories (report/idea/question/goal — every
 * `grouped: false` category per {@link classifyEntry}) survive, so a scheduled /
 * agent-closed / heartbeat flood can't bury the chronological signal. Those
 * entries stay reachable in the project view (which folds them). An explicitly
 * `report: true`-flagged entry is forced to SIGNAL (see effectiveCategory), so a
 * flagged deliverable that's also a quiet-scheduled push survives here — matching
 * the Reports-tab badge, which counts the same flag. The advisory feed-noise
 * `routineIds` overlay is applied the same way as in the project grouping: a
 * `report` the classifier flagged routine is treated as noise here (dropped),
 * never surfaced inline.
 *
 * Pure: takes `now` for deterministic testing (defaults to Date.now()).
 */
export function groupByBucketFlat(
  entries: readonly InboxEntry[],
  now: number = Date.now(),
  routineIds?: ReadonlySet<string>
): Array<[Bucket, InboxEntry[]]> {
  const byBucket = new Map<Bucket, InboxEntry[]>();
  for (const b of BUCKET_ORDER) byBucket.set(b, []);

  for (const e of entries) {
    // Effective category honours the explicit `report: true` flag (forced
    // signal, so a flagged deliverable that's also a quiet-scheduled push is
    // NOT dropped here) then the routine overlay — see effectiveCategory.
    const category = effectiveCategory(e, routineIds);
    // Time view is signal-only: fold-eligible (noise) categories are dropped.
    if (FEED_CATEGORIES[category].grouped) continue;
    byBucket.get(bucketFor(e.ts, now))!.push(e);
  }

  const result: Array<[Bucket, InboxEntry[]]> = [];
  for (const bucket of BUCKET_ORDER) {
    const list = byBucket.get(bucket)!;
    if (list.length > 0) result.push([bucket, list]);
  }
  return result;
}

/** Flatten TIME-view output to the entry-id sequence in render order (bucket →
 *  entry). The j/k-nav twin of {@link flattenVisible} for the flat stream. */
export function flattenVisibleFlat(
  groups: Array<[Bucket, InboxEntry[]]>
): string[] {
  return groups.flatMap(([, list]) => list.map((e) => e.id));
}

/**
 * Flatten grouped output to the entry-id sequence in *render* order
 * (bucket → project → inline signal → each expanded noise section). j/k
 * navigation and default-select must walk this, NOT the raw newest-first list —
 * the two diverge once a project's entries are interleaved with another's in the
 * same bucket, and collapsed noise rows are intentionally excluded so keyboard
 * nav can't land on a row the user folded away.
 *
 * `expandedSectionKeys` (from {@link groupedSectionKey}) gates each folded
 * section: a collapsed section's rows are skipped. Omit to treat all noise
 * sections as collapsed.
 */
export function flattenVisible(
  groups: Array<[Bucket, ProjectSubGroup[]]>,
  expandedSectionKeys?: ReadonlySet<string>,
  /**
   * Predicate: is this project's sub-group COLLAPSED (its rows hidden)? Receives
   * the full sub-group AND its bucket so the caller can fold on read-state and/or
   * recency (e.g. older buckets collapsed by default). When it returns true the
   * whole sub-group is skipped for nav. Omit to treat every project as expanded.
   */
  isProjectCollapsed?: (sg: ProjectSubGroup, bucket: Bucket) => boolean
): string[] {
  return groups.flatMap(([bucket, subgroups]) =>
    subgroups.flatMap((sg) => {
      if (isProjectCollapsed?.(sg, bucket)) return [];
      const ids = sg.entries.map((e) => e.id);
      for (const section of sg.groupedSections) {
        const expanded =
          expandedSectionKeys?.has(groupedSectionKey(bucket, sg.projectId, section.category)) ??
          false;
        if (expanded) ids.push(...section.entries.map((e) => e.id));
      }
      return ids;
    })
  );
}
