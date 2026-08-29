/**
 * Feed noise classifier — the OPTIONAL LLM demotion behind the `routine` feed
 * category (default OFF; see `feedCategories.ts` header + CLAUDE.md coupling).
 *
 * The renderer asks main (only when the feature is enabled and the Inbox is
 * open) which of the current inbox reports are ROUTINE "task done" chatter that
 * can be folded into a collapsed "Routine" section. Main reads entries from its
 * own {@link InboxStore} (the source of truth — the renderer's filtered view
 * can't be trusted, CLAUDE.md #1), applies a DETERMINISTIC gate so the model
 * only ever sees demotable candidates (comment-only `report`s — never a report
 * with docs, a question, or a goal/heartbeat/scheduled/auto-close marker), runs
 * the `builtin:feed-noise-classifier` micro-call, and returns the validated set
 * of ids to demote.
 *
 * The gate is the load-bearing part: because a doc-bearing report, an idea, a
 * question, or a goal outcome is filtered out BEFORE the prompt, the model
 * physically cannot demote one no matter what it replies. The renderer echoes
 * that guard once more in the pure grouping layer (it only re-buckets `report`
 * entries), so the "never hide pinned signal" invariant holds twice over.
 *
 * All collaborators are injected so the orchestration is unit-testable without
 * Electron, the filesystem, or a real spawn — mirroring {@link InboxSummaryService}.
 *
 * Never throws: a failed call resolves to an empty demotion set (nothing folded)
 * — the feature degrades to "everything inline", never to a crash or a wrong fold.
 */

import type { InboxEntry, LlmRunResult } from '@zana-ai/zcc-domain/product';
import { entryGist } from '../inbox/inbox-summary.js';
import {
  AUTO_CLOSE_KEY_PREFIX,
  HEARTBEAT_KEY_PREFIX,
  GOAL_KEY_PREFIX
} from '@zana-ai/zcc-domain/feed-categories';

/** Upper bound on how many recent entries the classifier considers — bounds the
 *  prompt size (and token cost) regardless of inbox size. Mirrors
 *  {@link INBOX_SUMMARY_MAX_ENTRIES}. */
export const FEED_NOISE_MAX_ENTRIES = 60;

/** Result of a classify call. Always an id set (empty on any failure / nothing
 *  routine); the caller treats "no verdict" and "nothing routine" identically. */
export interface FeedNoiseResult {
  /** Entry ids to demote into the folded `routine` section. Subset of the input. */
  routineIds: string[];
  /** How many entries were considered (candidates after the deterministic gate). */
  candidateCount: number;
}

export interface FeedNoiseDeps {
  /**
   * Read recent inbox entries (newest-first), optionally confined to one
   * project. The SAME read the summary/history paths use — main's own store,
   * never the renderer's list (Rule 1).
   */
  readEntries: (projectId: string | null, limit: number) => Promise<InboxEntry[]>;
  /** Run the feed-noise-classifier prompt over the rendered candidate text; never throws. */
  runClassify: (entries: string, dedupeKey: string) => Promise<LlmRunResult>;
}

/**
 * DETERMINISTIC gate: an entry is a demotion CANDIDATE only when it is a
 * comment-only free-form report — i.e. exactly what {@link classifyEntry} maps
 * to `report` AND carries no docs/question. Everything the registry pins as
 * signal (goal outcomes) or folds by rule (scheduled/heartbeat/auto-close) is
 * excluded here so the model never even sees it. Pure; exported for tests.
 *
 * Kept in sync with `classifyEntry`'s precedence by construction: we reject the
 * same markers it keys on, then require a non-empty comment and no docs/question.
 */
export function isDemotionCandidate(entry: InboxEntry): boolean {
  if (entry.question) return false; // pinned signal (question)
  if ((entry.docs?.length ?? 0) > 0) return false; // a report WITH docs stays loud
  const key = entry.dedupeKey ?? '';
  if (
    key.startsWith(AUTO_CLOSE_KEY_PREFIX) ||
    key.startsWith(HEARTBEAT_KEY_PREFIX) ||
    key.startsWith(GOAL_KEY_PREFIX)
  ) {
    return false; // already folded-by-rule or pinned (goal)
  }
  if (entry.scheduled) return false; // scheduled → its own tier, not routine
  return (entry.comments ?? '').trim().length > 0; // must have a gist to judge
}

/**
 * Render the candidate list fed to the model: one line per entry, `- [id] gist`.
 * The id is what the model echoes back in its `routine` array; the gist mirrors
 * the summary's {@link entryGist} so the model reasons over the same one-liner
 * the user sees. Pure; exported for tests.
 */
export function renderCandidatesForPrompt(entries: InboxEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    const gist = entryGist(e);
    if (!gist) continue;
    lines.push(`- [${e.id}] ${gist}`);
  }
  return lines.join('\n');
}

/**
 * Parse the model's `{"routine":[...]}` reply into a validated id set. Tolerant
 * (extracts the first {...}, like {@link parseInboxDigest}); every id is
 * intersected with `validIds` so a hallucinated / stale id can never demote an
 * entry that wasn't a candidate. Unparsable → empty set. Pure; exported for tests.
 */
export function parseRoutineIds(text: string, validIds: ReadonlySet<string>): string[] {
  if (!text.trim()) return [];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!obj || typeof obj !== 'object') return [];
  const raw = (obj as Record<string, unknown>).routine;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    // Validate against the candidate set — never trust a raw model id (Rule 1).
    if (id && validIds.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export class FeedNoiseClassifier {
  constructor(private readonly deps: FeedNoiseDeps) {}

  /**
   * Classify the inbox (whole, or one project when `projectId` is set) and
   * return the ids to demote. Reads main's own store, applies the deterministic
   * candidate gate, renders the prompt, runs the micro-call, and validates the
   * reply against the candidate ids. Never throws — any failure yields an empty
   * demotion set (feature degrades to "all inline").
   */
  async classify(projectId: string | null): Promise<FeedNoiseResult> {
    const entries = await this.deps.readEntries(projectId, FEED_NOISE_MAX_ENTRIES);
    const candidates = entries.filter(isDemotionCandidate);
    if (candidates.length === 0) return { routineIds: [], candidateCount: 0 };

    const text = renderCandidatesForPrompt(candidates);
    if (!text.trim()) return { routineIds: [], candidateCount: candidates.length };

    const result = await this.deps.runClassify(text, `feed-noise:${projectId ?? 'all'}`);
    if (!result.ok || !result.text.trim()) {
      return { routineIds: [], candidateCount: candidates.length };
    }
    const validIds = new Set(candidates.map((c) => c.id));
    return { routineIds: parseRoutineIds(result.text, validIds), candidateCount: candidates.length };
  }
}
