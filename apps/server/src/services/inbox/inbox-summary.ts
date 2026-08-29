/**
 * Inbox AI digest — the "AI Summary" card at the top of the Inbox.
 *
 * The renderer asks main (on demand, or debounced when the inbox changed) for a
 * short standup-style digest of the recent inbox, optionally scoped to one
 * project (when the shell is focused on it). Main reads the entries straight
 * from the {@link InboxStore} (the source of truth — the renderer's filtered
 * view can't be trusted for a confined read, CLAUDE.md #1), renders a compact
 * text digest, and runs the `builtin:inbox-summary` LLM micro-call to distill
 * it into `{ headline, done[], attention[] }`.
 *
 * Why main and not the renderer: the `claude --print` micro-call and the
 * authoritative inbox read are main-only. The renderer only passes an optional
 * projectId, which main treats as a filter over its own store — never a path.
 *
 * All collaborators are injected so the orchestration is unit-testable without
 * Electron, the filesystem, or a real spawn — mirroring {@link CloseSummaryService}.
 *
 * Never throws: the digest is a convenience surface; a failed call resolves to
 * an `ok:false` result the card renders as "couldn't summarize", not a crash.
 */

import type {
  DetailedInboxDigest,
  DetailedInboxPoint,
  DetailedInboxSection,
  InboxEntry,
  LlmRunResult
} from '@zana-ai/zcc-domain/product';

/** Upper bound on how many recent entries feed the digest — bounds the prompt
 *  size (and so the token cost) regardless of how big the inbox has grown. */
export const INBOX_SUMMARY_MAX_ENTRIES = 60;

/** The structured digest the model returns; what the card renders. */
export interface InboxDigest {
  /** One-line gist of the period. Always present (the model is told to fall back to an honest sentence). */
  headline: string;
  /** Up to 5 terse "what got done" bullets. */
  done: string[];
  /** Up to 5 "needs your attention" bullets; empty when nothing is pending. */
  attention: string[];
}

/** Result of a summarize call. `ok:false` carries a reason the card can show. */
export type InboxSummaryResult =
  | { ok: true; digest: InboxDigest; entryCount: number }
  | { ok: false; reason: 'empty' | 'summary-failed' };

export interface InboxSummaryDeps {
  /**
   * Read recent inbox entries (newest-first), optionally confined to one
   * project. This is the SAME read the history IPC uses — main's own store,
   * never anything the renderer hands over.
   */
  readEntries: (projectId: string | null, limit: number) => Promise<InboxEntry[]>;
  /** Run the inbox-summary prompt over the rendered digest text; never throws. */
  runSummary: (entries: string, dedupeKey: string) => Promise<LlmRunResult>;
  /** Project display label for an id, or undefined to fall back to the id. */
  projectLabel: (projectId: string) => string | undefined;
  /**
   * Run the DETAILED inbox-summary prompt over the rendered digest text; never
   * throws. Separate from {@link runSummary} so the two micro-calls use their
   * own prompt entries. Optional — only the detailed path needs it.
   */
  runDetailedSummary?: (entries: string, dedupeKey: string) => Promise<LlmRunResult>;
  /**
   * Resolve a project NAME (as the model echoes it back from a digest tag) to a
   * canonical project id, or null when no live project matches. This is the
   * trust seam for click-to-spawn (Rule 1): the model never emits an id, only a
   * name it saw, and main maps name→id against its own project list — a
   * hallucinated / stale name resolves to null (no spawn affordance). Optional —
   * only the detailed path needs it.
   */
  resolveProjectByName?: (name: string) => string | null;
}

/**
 * Build the one-line gist for an entry — mirrors the renderer's `previewFor`:
 * first non-empty comment line (markdown markers stripped), else first doc path,
 * else empty. Pure; exported for tests.
 */
export function entryGist(entry: InboxEntry): string {
  const c = (entry.comments ?? '').trim();
  if (c) {
    const firstLine = c.split('\n').find((l) => l.trim().length > 0) ?? '';
    return firstLine.replace(/^[#>*\-]+\s*/, '').trim();
  }
  if (entry.docs && entry.docs.length > 0) {
    const d = entry.docs[0];
    if (d) {
      const suffix = entry.docs.length > 1 ? ` (+${entry.docs.length - 1} more)` : '';
      return `📄 ${d.path}${suffix}`;
    }
  }
  return '';
}

/** Relative-time gloss for the digest text (coarse — the model only needs rough recency). */
function relativeAge(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * Render the compact text digest fed to the model: one line per entry,
 * `- [project · age] gist (×N)`. When the summary is scoped to one project the
 * project tag is dropped (it's redundant). Skips entries with no gist. Pure;
 * exported for tests.
 */
export function renderEntriesForPrompt(
  entries: InboxEntry[],
  opts: { scoped: boolean; now: number; projectLabel: (projectId: string) => string | undefined }
): string {
  const lines: string[] = [];
  for (const e of entries) {
    const gist = entryGist(e);
    if (!gist) continue;
    const age = relativeAge(e.ts, opts.now);
    const occ = (e.occurrences ?? 1) > 1 ? ` ×${e.occurrences}` : '';
    const proj = opts.scoped
      ? ''
      : `${opts.projectLabel(e.projectId) ?? e.projectLabel ?? e.projectId} · `;
    lines.push(`- [${proj}${age}] ${gist}${occ}`);
  }
  return lines.join('\n');
}

/**
 * Coerce the model's JSON reply into an {@link InboxDigest}. Tolerant: the model
 * may wrap the line in stray prose or a code fence, so we extract the first
 * {...} and parse that. Unparsable / empty headline → null (caller reports
 * summary-failed). Clamps array sizes + string lengths defensively. Pure;
 * exported for tests.
 */
export function parseInboxDigest(text: string): InboxDigest | null {
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
  const toBullets = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim().slice(0, 120))
          .filter((s) => s.length > 0)
          .slice(0, 5)
      : [];
  return { headline, done: toBullets(raw.done), attention: toBullets(raw.attention) };
}

/** Defensive caps on the detailed digest so a runaway model reply can't bloat the UI. */
const MAX_SECTIONS = 8;
const MAX_POINTS_PER_SECTION = 8;
const MAX_POINT_TEXT = 240;
const MAX_PROMPT_CHARS = 600;
const POINT_KINDS = new Set<DetailedInboxPoint['kind']>(['done', 'attention', 'question']);

/**
 * Coerce the model's JSON reply into a {@link DetailedInboxDigest}, mirroring
 * {@link parseInboxDigest}'s tolerance (extract the first {...}, clamp sizes).
 *
 * The model emits a project NAME per point; `resolveName` maps it to a canonical
 * id (or null when unknown) — the Rule-1 trust seam so a hallucinated name yields
 * an informational point with NO spawn affordance rather than a spawn into the
 * wrong project. A `suggestedPrompt` is only kept when the point resolved to a
 * real project (an actionable prompt with nowhere to run is dropped). When
 * `forcedProjectId` is set (a project-scoped summary), every point is pinned to
 * it and the model's name is ignored entirely. Unparsable / empty headline →
 * null (caller reports summary-failed). Pure; exported for tests.
 */
export function parseDetailedInboxDigest(
  text: string,
  resolveName: (name: string) => string | null,
  forcedProjectId: string | null
): DetailedInboxDigest | null {
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
  const headline = typeof raw.headline === 'string' ? raw.headline.trim().slice(0, 200) : '';
  if (!headline) return null;

  const parsePoint = (v: unknown): DetailedInboxPoint | null => {
    if (!v || typeof v !== 'object') return null;
    const p = v as Record<string, unknown>;
    const pointText = typeof p.text === 'string' ? p.text.trim().slice(0, MAX_POINT_TEXT) : '';
    if (!pointText) return null;
    const kind: DetailedInboxPoint['kind'] = POINT_KINDS.has(p.kind as DetailedInboxPoint['kind'])
      ? (p.kind as DetailedInboxPoint['kind'])
      : 'done';
    // Trust seam: a scoped summary forces the scope; otherwise resolve the
    // model's name → id (null when unknown). Never trust a raw model string.
    const projectId = forcedProjectId
      ? forcedProjectId
      : typeof p.project === 'string' && p.project.trim()
        ? resolveName(p.project.trim())
        : null;
    const point: DetailedInboxPoint = { text: pointText, kind };
    if (projectId) {
      point.projectId = projectId;
      // An actionable prompt is only meaningful when we have a real project to
      // run it in — drop it otherwise so the UI never offers a dead spawn.
      const prompt =
        typeof p.suggestedPrompt === 'string'
          ? p.suggestedPrompt.trim().slice(0, MAX_PROMPT_CHARS)
          : '';
      if (prompt) point.suggestedPrompt = prompt;
    }
    return point;
  };

  const sections: DetailedInboxSection[] = [];
  if (Array.isArray(raw.sections)) {
    for (const s of raw.sections.slice(0, MAX_SECTIONS)) {
      if (!s || typeof s !== 'object') continue;
      const sec = s as Record<string, unknown>;
      const title = typeof sec.title === 'string' ? sec.title.trim().slice(0, 80) : '';
      if (!title) continue;
      const points = Array.isArray(sec.points)
        ? sec.points
            .slice(0, MAX_POINTS_PER_SECTION)
            .map(parsePoint)
            .filter((x): x is DetailedInboxPoint => x !== null)
        : [];
      if (points.length === 0) continue;
      sections.push({ title, points });
    }
  }
  return { headline, sections };
}

export class InboxSummaryService {
  constructor(
    private readonly deps: InboxSummaryDeps,
    /** Injectable clock so the relative-time rendering is deterministic in tests. */
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Summarize the inbox (whole, or one project when `projectId` is set). Reads
   * main's own store, renders the digest text, and runs the micro-call. Returns
   * a tagged result so the card can distinguish "nothing to summarize" from "the
   * model couldn't distill it". Never throws.
   */
  async summarize(projectId: string | null): Promise<InboxSummaryResult> {
    const entries = await this.deps.readEntries(projectId, INBOX_SUMMARY_MAX_ENTRIES);
    if (entries.length === 0) return { ok: false, reason: 'empty' };

    const text = renderEntriesForPrompt(entries, {
      scoped: projectId !== null,
      now: this.now(),
      projectLabel: this.deps.projectLabel
    });
    if (!text.trim()) return { ok: false, reason: 'empty' };

    // De-dupe concurrent regens for the same scope (debounce + a manual click can
    // race); the second await joins the first call.
    const result = await this.deps.runSummary(text, `inbox-summary:${projectId ?? 'all'}`);
    if (!result.ok || !result.text.trim()) return { ok: false, reason: 'summary-failed' };

    const digest = parseInboxDigest(result.text);
    if (!digest) return { ok: false, reason: 'summary-failed' };
    return { ok: true, digest, entryCount: entries.length };
  }

  /**
   * Generate the RICH, sectioned digest that backs the "Details" modal. Same
   * scoped read + render as {@link summarize}, but runs the detailed micro-call
   * and resolves each point's project NAME → validated id (Rule 1). On-demand
   * only — callers must not background-warm this. Never throws; a missing
   * detailed dep resolves to `summary-failed`.
   */
  async summarizeDetailed(
    projectId: string | null
  ): Promise<
    | { ok: true; digest: DetailedInboxDigest; entryCount: number }
    | { ok: false; reason: 'empty' | 'summary-failed' }
  > {
    const runDetailed = this.deps.runDetailedSummary;
    const resolveName = this.deps.resolveProjectByName;
    if (!runDetailed || !resolveName) return { ok: false, reason: 'summary-failed' };

    const entries = await this.deps.readEntries(projectId, INBOX_SUMMARY_MAX_ENTRIES);
    if (entries.length === 0) return { ok: false, reason: 'empty' };

    const text = renderEntriesForPrompt(entries, {
      scoped: projectId !== null,
      now: this.now(),
      projectLabel: this.deps.projectLabel
    });
    if (!text.trim()) return { ok: false, reason: 'empty' };

    const result = await runDetailed(text, `inbox-summary-detailed:${projectId ?? 'all'}`);
    if (!result.ok || !result.text.trim()) return { ok: false, reason: 'summary-failed' };

    const digest = parseDetailedInboxDigest(result.text, resolveName, projectId);
    if (!digest) return { ok: false, reason: 'summary-failed' };
    return { ok: true, digest, entryCount: entries.length };
  }
}
