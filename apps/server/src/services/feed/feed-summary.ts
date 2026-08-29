/**
 * Feed AI recap — the "recap" card at the top of a project's Activity Feed.
 *
 * Mirrors {@link InboxSummaryService}: the renderer asks main (on demand, or
 * debounced when the feed changed) for a short recap of a project's recent
 * activity. Main assembles the feed from its OWN {@link FeedService} (the
 * source of truth — never a renderer-supplied list, CLAUDE.md #1), renders a
 * compact text digest, and runs the `builtin:feed-digest` LLM micro-call to
 * distill it into `{ headline, highlights[] }`.
 *
 * All collaborators are injected so the orchestration is unit-testable without
 * Electron, the filesystem, or a real spawn.
 *
 * Never throws: the recap is a convenience surface; a failed call resolves to
 * an `ok:false` result the card renders as "couldn't summarize", not a crash.
 */

import type {
  FeedDigest,
  FeedDigestResult,
  FeedEvent,
  LlmRunResult
} from '@zana-ai/zcc-domain/product';

/** Upper bound on how many recent events feed the recap — bounds the prompt
 *  size (and token cost) regardless of how busy the project has been. */
export const FEED_SUMMARY_MAX_EVENTS = 60;

export interface FeedSummaryDeps {
  /** Read recent feed events for a project (newest-first). Main's own store. */
  readEvents: (projectId: string, limit: number) => Promise<FeedEvent[]>;
  /** Run the feed-digest prompt over the rendered digest text; never throws. */
  runSummary: (entries: string, dedupeKey: string) => Promise<LlmRunResult>;
}

/** Human label for each event kind, used in the digest text fed to the model. */
const KIND_LABEL: Record<FeedEvent['kind'], string> = {
  commit: 'commit',
  'session-finished': 'session finished',
  report: 'report',
  'followup-created': 'follow-up opened',
  'followup-resolved': 'follow-up resolved',
  'goal-achieved': 'goal',
  'library-doc': 'library doc',
  'schedule-run': 'scheduled run',
  'extension-installed': 'extension installed',
  'extension-uninstalled': 'extension uninstalled',
  'project-created': 'project created'
};

/** Relative-time gloss for the digest text (coarse — the model only needs rough recency). */
function relativeAge(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * Render the compact text digest fed to the model: one line per event,
 * `- [kind · age] title`. Skips empty titles. Pure; exported for tests.
 */
export function renderEventsForPrompt(events: FeedEvent[], now: number): string {
  const lines: string[] = [];
  for (const e of events) {
    const title = (e.title ?? '').trim();
    if (!title) continue;
    const label = KIND_LABEL[e.kind] ?? e.kind;
    lines.push(`- [${label} · ${relativeAge(e.ts, now)}] ${title}`);
  }
  return lines.join('\n');
}

/**
 * Coerce the model's JSON reply into a {@link FeedDigest}. Tolerant: extract the
 * first {...} and parse it (mirrors parseInboxDigest). Unparsable / empty
 * headline → null (caller reports summary-failed). Clamps sizes defensively.
 * Pure; exported for tests.
 */
export function parseFeedDigest(text: string): FeedDigest | null {
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
  const raw = obj as Record<string, unknown>;
  const headline = typeof raw.headline === 'string' ? raw.headline.trim().slice(0, 160) : '';
  if (!headline) return null;
  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim().slice(0, 120))
        .filter((s) => s.length > 0)
        .slice(0, 5)
    : [];
  return { headline, highlights };
}

export class FeedSummaryService {
  constructor(
    private readonly deps: FeedSummaryDeps,
    /** Injectable clock so the relative-time rendering is deterministic in tests. */
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Summarize a project's recent activity. Reads main's own feed, renders the
   * digest text, and runs the micro-call. Returns a tagged result so the card
   * can distinguish "nothing to summarize" from "the model couldn't distill it".
   * Never throws.
   */
  async summarize(projectId: string): Promise<FeedDigestResult> {
    const events = await this.deps.readEvents(projectId, FEED_SUMMARY_MAX_EVENTS);
    if (events.length === 0) return { ok: false, reason: 'empty' };

    const text = renderEventsForPrompt(events, this.now());
    if (!text.trim()) return { ok: false, reason: 'empty' };

    const result = await this.deps.runSummary(text, `feed-digest:${projectId}`);
    if (!result.ok || !result.text.trim()) return { ok: false, reason: 'summary-failed' };

    const digest = parseFeedDigest(result.text);
    if (!digest) return { ok: false, reason: 'summary-failed' };
    return { ok: true, digest, eventCount: events.length };
  }
}
