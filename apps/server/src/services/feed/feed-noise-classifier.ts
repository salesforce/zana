/**
 * Feed noise classifier — the OPTIONAL LLM demotion behind the `routine` feed
 * category (default OFF; see `packages/domain/src/feed-categories.ts` header + apps/server/src/services/feed/AGENTS.md).
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
import { WORKLOAD_MEMO_SKIPPED } from '@zana-ai/zcc-llm';
import { entryGist } from '../inbox/inbox-summary.js';
import { isDemotionCandidate } from '@zana-ai/zcc-domain/feed-categories';

/** Upper bound on how many recent entries the classifier considers — bounds the
 *  prompt size (and token cost) regardless of inbox size. Mirrors
 *  {@link INBOX_SUMMARY_MAX_ENTRIES}. */
export const FEED_NOISE_MAX_ENTRIES = 60;

/** Result of a classify call. Always an id set (empty on any failure / nothing
 *  routine); `failed` marks a failed model call so the renderer can keep its
 *  previous overlay instead of regrouping. */
export interface FeedNoiseResult {
  /** Entry ids to demote into the folded `routine` section. Subset of the input. */
  routineIds: string[];
  /** How many entries were considered (candidates after the deterministic gate). */
  candidateCount: number;
  /** Set when the classify call itself failed (not "nothing is routine"). */
  failed?: true;
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
  requestIdentity?: (entries: string) => string;
  memo?: { getOrCompute<T>(workload: string, key: string, ttlMs: number, compute: () => Promise<T | undefined>): Promise<T | undefined | typeof WORKLOAD_MEMO_SKIPPED> };
}

const FEED_NOISE_MEMO_TTL_MS = 5 * 60_000;

/**
 * DETERMINISTIC gate (comment-only free-form reports with no docs/questions).
 * Lives in the domain registry so the renderer's layout re-applies the same
 * check to cached overlay ids; re-exported here for existing importers.
 */
export { isDemotionCandidate };

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
export function parseRoutineIds(text: string, validIds: ReadonlySet<string>): string[] | null {
  if (!text.trim()) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const raw = (obj as Record<string, unknown>).routine;
  if (!Array.isArray(raw)) return null;
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

    const validIds = new Set(candidates.map((c) => c.id));
    const classifyOnce = async (): Promise<string[] | undefined> => {
      const result = await this.deps.runClassify(text, `feed-noise:${projectId ?? 'all'}`);
      if (!result.ok || !result.text.trim()) return undefined;
      return parseRoutineIds(result.text, validIds) ?? undefined;
    };
    const resultFor = (ids: string[] | undefined): FeedNoiseResult => ids === undefined
      ? { routineIds: [], candidateCount: candidates.length, failed: true }
      : { routineIds: ids, candidateCount: candidates.length };
    if (!this.deps.memo) return resultFor(await classifyOnce());

    const identity = this.deps.requestIdentity?.(text) ?? text;
    const routineIds = await this.deps.memo.getOrCompute('feed-noise', `feed-noise:${projectId ?? 'all'}:${identity}`, FEED_NOISE_MEMO_TTL_MS, classifyOnce);
    if (routineIds === WORKLOAD_MEMO_SKIPPED) return resultFor(await classifyOnce());
    if (routineIds === undefined) return resultFor(undefined);
    {
      // The effective prompt can omit candidate text; preserve the deterministic
      // output fence even when a cached valid reply is reused.
      return { routineIds: routineIds.filter((id) => validIds.has(id)), candidateCount: candidates.length };
    }
  }
}
