/**
 * Close-idle work summary (the optional "leave a summary" step of the Agents
 * board's Close-idle action).
 *
 * When the user opts to be left a summary before bulk-closing a project's idle
 * agents, the renderer hands main the session ids it's about to close. For each
 * one we read the session transcript's last assistant turn (the same clean
 * JSONL the idle-triage add-on reads) and run the `builtin:close-summary` LLM
 * micro-call to distill "what it did / what's left", then fold every agent's
 * note into ONE inbox entry for the project (the user picked combined-entry).
 *
 * Why this lives in main and not the renderer: transcript reads, the
 * `claude --print` micro-call, and the inbox append are all main-only
 * capabilities. The renderer only knows session ids; main re-validates each id
 * is a live session in the target project before trusting it (CLAUDE.md #1) and
 * derives the transcript path from the session's own cwd — a renderer-supplied
 * id can't point the read at an arbitrary file.
 *
 * All collaborators are injected so the orchestration is unit-testable without
 * Electron, the filesystem, or a real spawn — mirroring {@link IdleTriageService}.
 *
 * Independent of the idle-triage add-on: this runs a fresh call at close time
 * regardless of whether idle-triage is enabled, so a summary is always real
 * rather than whatever a possibly-disabled add-on happened to cache.
 */

import type { LlmRunResult } from '@zana-ai/zcc-domain/product';
import type { TranscriptRef } from './idle-triage.js';

/** What the summarizer needs to know about a session to summarize it. */
export interface CloseSummarySessionInfo {
  /** Owning project — must match the requested projectId or the id is skipped. */
  projectId: string;
  profile: string;
  cwd: string;
  claudeSessionId?: string;
  /** OpenCode's already-detected session id (see `TranscriptSessionRef`). */
  openCodeSessionId?: string;
  /** Spawn time (epoch ms) — the floor for detecting a Codex rollout file. */
  createdAt?: number;
  title: string;
}

export interface CloseSummaryDeps {
  /** Session metadata, or null if the session is gone (skipped). */
  getSession: (sessionId: string) => CloseSummarySessionInfo | null;
  /**
   * True when the profile has a readable/summarizable transcript (the
   * `hasTranscript` capability). Close-summary reads the last assistant turn,
   * so a profile without a transcript is skipped. Provider-agnostic.
   */
  hasTranscript: (profile: string) => boolean;
  /** Read the session transcript's last assistant prose ('' when unavailable). */
  readLastTurn: (ref: TranscriptRef) => Promise<string>;
  /** Run the (terse, did/left) close-summary prompt over one agent's last turn; never throws. */
  runSummary: (lastTurn: string, dedupeKey: string) => Promise<LlmRunResult>;
  /**
   * Run the (Slack-facing, 1–3 sentence prose) turn-summary prompt over one
   * agent's last turn; never throws. Backs {@link CloseSummaryService.summarizeTurn},
   * which the host exposes as the generic `ctx.summarizeSession` capability
   * (the Slack answer-relay's source of the note it posts). Distinct from
   * {@link runSummary} (terse did/left JSON for the inbox close digest).
   */
  runTurnSummary: (lastTurn: string, dedupeKey: string) => Promise<LlmRunResult>;
  /**
   * Read a role-tagged digest of the whole session ('' when unavailable) — the
   * input for the on-demand {@link CloseSummaryService.summarizeOne}, which
   * wants the arc of the session, not just the last turn.
   */
  readDigest: (ref: TranscriptRef) => Promise<string>;
  /**
   * Run the richer session-summary prompt over a digest, returning Markdown
   * prose (not did/left JSON); never throws. Backs {@link CloseSummaryService.summarizeOne}.
   */
  runSessionSummary: (digest: string, dedupeKey: string) => Promise<LlmRunResult>;
  /** Append the combined entry to the inbox; returns the new entry id. */
  appendInbox: (input: {
    projectId: string;
    projectLabel?: string;
    comments: string;
    /** Originating session, set by the single-session path so the inbox entry
     *  links back to the agent it summarized. Absent for the bulk close digest
     *  (which spans many sessions and so belongs to none in particular). */
    sessionId?: string;
  }) => Promise<{ id: string }>;
  /** Project display label for the entry, or undefined to fall back to the id. */
  projectLabel: (projectId: string) => string | undefined;
  /**
   * Terminate a session, returning false when the id is unknown. Required only
   * by {@link CloseSummaryService.summarizeAndClose} (the CLI/operator path);
   * the renderer summarize-then-close path closes via its own store action, so
   * it wires this absent.
   */
  closeTerminal?: (sessionId: string) => boolean;
  /**
   * File a durable follow-up for an agent being closed, returning the new
   * follow-up's id (or null when nothing was created). Wired from the host's
   * `FollowUpManager`; the origin/session attribution is host-stamped by the
   * caller (Rule 1), never agent free-text. Required only by
   * {@link CloseSummaryService.summarizeAndFollowUp}; absent elsewhere.
   */
  createFollowUp?: (input: {
    projectId: string;
    sessionId: string;
    title: string;
    detail?: string;
  }) => string | null;
}

/** One agent's distilled note. `did`/`left` may be empty when the model couldn't tell. */
export interface CloseSummaryNote {
  did: string;
  left: string;
}

/**
 * Coerce the model's JSON reply into a {@link CloseSummaryNote}. Tolerant: the
 * model may wrap the line in stray prose or a code fence despite the prompt, so
 * we extract the first {...} and parse that. Unparsable → null (the caller then
 * drops that agent from the digest rather than emitting a bogus line). Pure;
 * exported for tests.
 */
export function parseCloseSummary(text: string): CloseSummaryNote | null {
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
  const did = typeof raw.did === 'string' ? raw.did.trim().slice(0, 100) : '';
  const left = typeof raw.left === 'string' ? raw.left.trim().slice(0, 100) : '';
  if (!did && !left) return null;
  return { did, left };
}

/**
 * Cap on concurrent per-agent micro-calls. Each {@link runSummary} spawns a
 * `claude --print` child, so without a bound, closing a project with many idle
 * agents would fork that many processes at once (CLAUDE.md #5 — keep heavy work
 * off a single burst). 5 keeps a big close responsive without stampeding.
 */
const MAX_CONCURRENT_SUMMARIES = 5;

/** A summarized agent paired with its source session, for digest rendering. */
interface ResolvedNote {
  /** Source session id — carried so the follow-up path can attribute per agent. */
  sessionId: string;
  title: string;
  note: CloseSummaryNote;
}

/**
 * Map `items` through `worker` with at most `limit` in flight at once,
 * preserving input order in the result. A worker that rejects propagates — call
 * sites here have the worker swallow to null, so this never rejects in practice.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
  return results;
}

/**
 * Render the combined inbox markdown body for a project's summarized agents. One
 * `### <title>` section per agent with a **Did** / **Left** pair (Left omitted
 * when empty). The header verb depends on `opts.closing`: the close paths say
 * "Closed N idle agents" (the agents are gone), the read-only Summarize path
 * says "Caught up on N agents" (they're still running). Pure; exported for tests.
 */
export function renderCloseSummary(
  projectLabel: string,
  notes: ResolvedNote[],
  opts: { closing?: boolean } = {}
): string {
  const n = notes.length;
  const noun = n === 1 ? 'agent' : 'agents';
  const head =
    opts.closing ?? true
      ? `Closed ${n} idle ${noun} in **${projectLabel}**.`
      : `Caught up on ${n} ${noun} in **${projectLabel}**.`;
  const sections = notes.map(({ title, note }) => {
    const lines = [`### ${title}`, `**Did:** ${note.did || '—'}`];
    if (note.left) lines.push(`**Left:** ${note.left}`);
    return lines.join('\n');
  });
  return [head, ...sections].join('\n\n');
}

/**
 * Render the inbox markdown body for ONE agent the user asked to summarize on
 * demand (the modal's "Summarize to inbox" action). The model already returns a
 * structured Markdown summary (Goal / What it did / Left); we just title it with
 * the agent's name. The model's own headings are demoted one level so they nest
 * under our `###` title (a leading `#`/`##` from the model would otherwise
 * outrank it). Pure; exported for tests.
 */
export function renderSessionSummary(title: string, summary: string): string {
  const body = summary
    .trim()
    .split('\n')
    .map((line) => (/^#{1,5}\s/.test(line) ? `#${line}` : line))
    .join('\n');
  return `### ${title}\n\n${body}`;
}

/**
 * Summarize the given idle agents and push ONE combined inbox entry for the
 * project. Returns how many agents were actually summarized (0 when none had a
 * readable transcript / parseable reply — in which case no entry is written).
 * Never throws: a summary is a courtesy before the close, and a failed courtesy
 * must not block the close the caller does next.
 */
export class CloseSummaryService {
  constructor(private readonly deps: CloseSummaryDeps) {}

  /**
   * Resolve + confine, then run each eligible agent's close-summary micro-call
   * concurrently (bounded — each spawns a claude child, CLAUDE.md #5), returning
   * one {@link ResolvedNote} per agent that yielded a parseable did/left note.
   * The shared front half of {@link summarize} and {@link summarizeAndFollowUp}.
   *
   * Confinement (Rule 1): a stale/foreign/non-claude id resolves to
   * null/mismatch and is dropped, never read. Every step swallows its own
   * failure to null so one bad transcript can't sink the batch.
   */
  private async collectNotes(
    projectId: string,
    sessionIds: string[]
  ): Promise<ResolvedNote[]> {
    const eligible = sessionIds
      .map((id) => ({ id, session: this.deps.getSession(id) }))
      .filter(
        (e): e is { id: string; session: CloseSummarySessionInfo } =>
          e.session !== null &&
          e.session.projectId === projectId &&
          this.deps.hasTranscript(e.session.profile)
      );

    const resolved = await mapWithConcurrency(
      eligible,
      MAX_CONCURRENT_SUMMARIES,
      async ({ id, session }): Promise<ResolvedNote | null> => {
        try {
          const lastTurn = await this.deps.readLastTurn({
            id,
            profile: session.profile,
            cwd: session.cwd,
            claudeSessionId: session.claudeSessionId,
            openCodeSessionId: session.openCodeSessionId,
            createdAt: session.createdAt
          });
          if (!lastTurn.trim()) return null; // nothing to summarize — skip, don't spend a call
          const result = await this.deps.runSummary(lastTurn, `close-summary:${id}`);
          if (!result.ok) return null;
          const note = parseCloseSummary(result.text);
          return note ? { sessionId: id, title: session.title, note } : null;
        } catch {
          return null;
        }
      }
    );
    return resolved.filter((n): n is ResolvedNote => n !== null);
  }

  async summarize(
    projectId: string,
    sessionIds: string[],
    opts: { closing?: boolean } = {}
  ): Promise<{ summarized: number; entryId?: string; body?: string }> {
    const notes = await this.collectNotes(projectId, sessionIds);
    if (notes.length === 0) return { summarized: 0 };

    const label = this.deps.projectLabel(projectId);
    const comments = renderCloseSummary(label ?? projectId, notes, opts);
    try {
      const entry = await this.deps.appendInbox({
        projectId,
        projectLabel: label,
        comments
      });
      // `body` is the rendered combined markdown — returned so a caller (the
      // close_idle_agents MCP tool) can hand the wrap-up back to the agent for
      // it to persist elsewhere (e.g. project memory), not just the inbox.
      return { summarized: notes.length, entryId: entry.id, body: comments };
    } catch {
      // The summary was computed but the inbox write failed — report nothing
      // written so the caller doesn't claim a summary that isn't there.
      return { summarized: 0 };
    }
  }

  /**
   * The "reclaim with a paper trail" path behind the Agents board's Close
   * action (when the "file follow-ups" option is on) and the modal's "Close
   * with follow-up" item.
   *
   * Summarizes every confined agent into ONE combined inbox entry for the
   * project (the SAME folded digest {@link summarize} writes — deliberately not
   * a per-agent breadcrumb storm, which is the very "overwhelm" this feature
   * exists to reduce), AND files a durable per-agent follow-up for each agent
   * that left unfinished work (`left` is non-empty). A finished agent
   * (`left` empty) contributes to the digest but files NO follow-up: filing one
   * for genuinely-done work is exactly the noise the user asked us to avoid.
   *
   * Does NOT close anything — the renderer owns the actual teardown (selection /
   * split cleanup live there), so this runs while the ptys are still alive to be
   * read, then the caller closes. Never throws: a failed summary/follow-up is a
   * lost courtesy, never a reason to block the close the user asked for.
   *
   * Same confinement as {@link summarize}: a stale/foreign id resolves to
   * null/mismatch and is dropped, never read (Rule 1). Returns per-project
   * counts so the caller can toast precisely.
   */
  async summarizeAndFollowUp(
    projectId: string,
    sessionIds: string[]
  ): Promise<{ summarized: number; followedUp: number }> {
    return this.applyNotes(projectId, await this.collectNotes(projectId, sessionIds));
  }

  private async applyNotes(
    projectId: string,
    notes: ResolvedNote[]
  ): Promise<{ summarized: number; followedUp: number }> {
    const label = this.deps.projectLabel(projectId);

    // ONE folded inbox entry for the whole batch (only when something distilled).
    // Best-effort: a failed write still lets the follow-ups below go in.
    let summarized = 0;
    if (notes.length > 0) {
      try {
        await this.deps.appendInbox({
          projectId,
          projectLabel: label,
          comments: renderCloseSummary(label ?? projectId, notes, { closing: true })
        });
        summarized = notes.length;
      } catch {
        /* combined breadcrumb is best-effort */
      }
    }

    // A durable per-agent follow-up ONLY for agents that left unfinished work.
    let followedUp = 0;
    if (this.deps.createFollowUp) {
      for (const { sessionId, title, note } of notes) {
        if (!note.left) continue;
        try {
          const created = this.deps.createFollowUp({
            projectId,
            sessionId,
            title: `Follow up: ${title}`,
            detail:
              `**Did:** ${note.did || '—'}\n\n**Left:** ${note.left}` +
              `\n\n_Filed when the agent was closed from the Agents view._`
          });
          if (created != null) followedUp++;
        } catch {
          /* follow-up is best-effort */
        }
      }
    }

    return { summarized, followedUp };
  }

  /**
   * Same inbox + follow-up paper trail as {@link summarizeAndFollowUp}, but the
   * last-turn text is already in hand (conversation threads have no PTY
   * transcript). Never throws. Empty / unparsable last-turn → zeros.
   */
  async summarizeAndFollowUpFromLastTurn(
    projectId: string,
    item: { sessionId: string; title: string; lastTurn: string }
  ): Promise<{ summarized: number; followedUp: number }> {
    if (!item.lastTurn.trim()) return { summarized: 0, followedUp: 0 };
    try {
      const result = await this.deps.runSummary(item.lastTurn, `close-summary:${item.sessionId}`);
      if (!result.ok) return { summarized: 0, followedUp: 0 };
      const note = parseCloseSummary(result.text);
      if (!note) return { summarized: 0, followedUp: 0 };
      return this.applyNotes(projectId, [
        { sessionId: item.sessionId, title: item.title, note }
      ]);
    } catch {
      return { summarized: 0, followedUp: 0 };
    }
  }

  /**
   * Summarize ONE agent on demand (the terminal modal's "Summarize to inbox"
   * button) and push a single inbox entry linked back to that session. Unlike
   * {@link summarize}, the agent is usually still LIVE — this is a "snapshot of
   * where it's at", not a close digest — so it reads the transcript without
   * touching the pty and the entry stays attached to the session.
   *
   * This is a REAL summary, not the terse one-line close note {@link summarize}
   * produces: it digests the whole conversation (user asks, agent prose, tools
   * run) and runs the richer `session-summary` prompt, so the inbox entry
   * actually reflects the session's arc rather than paraphrasing the last line.
   *
   * Same confinement as {@link summarize}: the id must resolve to a live
   * claude-family session in `projectId` or the call is a no-op (CLAUDE.md #1).
   * Never throws; returns a tagged result so the renderer can toast precisely
   * (no transcript yet vs. the model couldn't distill vs. the write failed).
   */
  async summarizeOne(
    projectId: string,
    sessionId: string
  ): Promise<
    | { ok: true; entryId: string }
    | { ok: false; reason: 'ineligible' | 'empty' | 'summary-failed' | 'write-failed' }
  > {
    const session = this.deps.getSession(sessionId);
    if (!session || session.projectId !== projectId || !this.deps.hasTranscript(session.profile)) {
      return { ok: false, reason: 'ineligible' };
    }

    let summary: string;
    try {
      const digest = await this.deps.readDigest({
        id: sessionId,
        profile: session.profile,
        cwd: session.cwd,
        claudeSessionId: session.claudeSessionId,
        openCodeSessionId: session.openCodeSessionId,
        createdAt: session.createdAt
      });
      if (!digest.trim()) return { ok: false, reason: 'empty' };
      const result = await this.deps.runSessionSummary(digest, `session-summary:${sessionId}`);
      if (!result.ok || !result.text.trim()) return { ok: false, reason: 'summary-failed' };
      summary = result.text.trim();
    } catch {
      return { ok: false, reason: 'summary-failed' };
    }

    const label = this.deps.projectLabel(projectId);
    try {
      const entry = await this.deps.appendInbox({
        projectId,
        projectLabel: label,
        sessionId,
        comments: renderSessionSummary(session.title, summary)
      });
      return { ok: true, entryId: entry.id };
    } catch {
      return { ok: false, reason: 'write-failed' };
    }
  }

  /**
   * Summarize ONE agent's LATEST turn into a short prose note — the source of the
   * generic `ctx.summarizeSession(sessionId, { scope: 'lastTurn' })` capability
   * (which the Slack answer-relay posts when an agent goes idle). Unlike
   * {@link summarizeOne} this neither reads the whole-session digest nor writes
   * an inbox entry: it distils only the last assistant turn and RETURNS the prose
   * for the caller to relay wherever it likes.
   *
   * Same confinement as the other paths: the id must resolve to a live
   * claude-family session in `projectId` or the call is a no-op (CLAUDE.md #1).
   * Never throws — a relay is best-effort, so every failure collapses to
   * `{ ok: false }` and the caller simply relays nothing.
   */
  async summarizeTurn(
    projectId: string,
    sessionId: string
  ): Promise<{ ok: boolean; text?: string }> {
    const session = this.deps.getSession(sessionId);
    if (!session || session.projectId !== projectId || !this.deps.hasTranscript(session.profile)) {
      return { ok: false };
    }
    try {
      const lastTurn = await this.deps.readLastTurn({
        id: sessionId,
        profile: session.profile,
        cwd: session.cwd,
        claudeSessionId: session.claudeSessionId,
        openCodeSessionId: session.openCodeSessionId,
        createdAt: session.createdAt
      });
      if (!lastTurn.trim()) return { ok: false }; // nothing to summarize — skip, don't spend a call
      const result = await this.deps.runTurnSummary(lastTurn, `turn-summary:${sessionId}`);
      if (!result.ok || !result.text.trim()) return { ok: false };
      return { ok: true, text: result.text.trim() };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Summarize the given sessions (optionally) THEN close them — the one place
   * the "summarize, then kill" sequence lives for the operator-facing surfaces
   * (the CLI `term close-summary` op). Summary runs FIRST so it reads each live
   * transcript before the pty dies; a summary failure never blocks the close.
   * Only sessions confined to `projectId` are closed (same gate as
   * {@link summarize}), so a foreign/stale id is ignored, not killed.
   *
   * Requires `deps.closeTerminal`; throws if it wasn't wired (a programmer error
   * — the renderer path doesn't use this method).
   */
  async summarizeAndClose(
    projectId: string,
    sessionIds: string[],
    opts: { summarize: boolean } = { summarize: true }
  ): Promise<{ closed: number; summarized: number; entryId?: string; body?: string }> {
    if (!this.deps.closeTerminal) {
      throw new Error('CloseSummaryService.summarizeAndClose: closeTerminal dep not wired');
    }
    let summarized = 0;
    let entryId: string | undefined;
    let body: string | undefined;
    if (opts.summarize) {
      const res = await this.summarize(projectId, sessionIds);
      summarized = res.summarized;
      entryId = res.entryId;
      body = res.body;
    }
    // Close only the ids that resolve to a live session in THIS project — the
    // same confinement summarize() applies, so the close surface can't be used
    // to kill a foreign/stale id.
    let closed = 0;
    for (const id of sessionIds) {
      const session = this.deps.getSession(id);
      if (!session || session.projectId !== projectId) continue;
      if (this.deps.closeTerminal(id)) closed++;
    }
    return { closed, summarized, entryId, body };
  }
}
