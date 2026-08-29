/**
 * Auto-report linker (ON by default; spends no tokens).
 *
 * Reports the agent never pushes to the inbox itself (it forgets, or the
 * session ends before it gets around to `inbox_push`) previously vanished
 * from the Report tab entirely — the file sat on disk but no `InboxEntry`
 * ever pointed at it. This service closes that gap on the working→idle edge:
 * it reads the session's already-computed file-touch list (the same data
 * {@link TranscriptSource.readStats} feeds the modal's Changes tab) and, for
 * any file that LOOKS like a report deliverable (see {@link isReportCandidatePath}),
 * auto-appends a `report: true` inbox entry pointing at it — stamped with the
 * SAME `sessionId`/`origin` a manual `inbox_push` would carry, so it shows up
 * in the Report tab exactly as if the agent had called the tool.
 *
 * Detection is a pure filename heuristic — no LLM classification — so it's
 * free to run on every idle edge and safe to leave on by default (unlike
 * {@link CatchUpSummaryService}, which is opt-in because it spends tokens).
 *
 * `observe` relies on the agent-status emitter's own edge dedup (it only
 * calls listeners on a resolved-state CHANGE — see `resolve()` in
 * agent-status.ts), so there's no separate dwell timer or one-shot gate here:
 * every idle edge just re-scans the session's current file list and links
 * whatever's new. Per-session dedup (`linked`) stops a file from being
 * re-pushed on a later idle edge in the same session. All collaborators are
 * injected so the service is unit-testable without Electron or the filesystem
 * (mirrors {@link CatchUpSummaryService}).
 */

import { basename, relative, sep } from 'node:path';
import type { AgentState, InboxOrigin, SessionStats } from '@zana-ai/zcc-domain/product';
import type { InboxInput } from './inbox-store.js';
import type { TranscriptRef } from '../followups/idle-triage.js';

/** Filename substrings (case-insensitive) that mark a markdown file as a report deliverable. */
const REPORT_KEYWORDS = ['report', 'summary', 'analysis', 'audit', 'rca', 'postmortem', 'writeup', 'findings'];

/** Common root-level markdown files that are never a report, even sitting at the cwd root. */
const EXCLUDED_BASENAMES = new Set([
  'readme.md',
  'claude.md',
  'changelog.md',
  'license.md',
  'contributing.md',
  'todo.md'
]);

/**
 * True when `absPath` looks like a report deliverable: a markdown file whose
 * name carries a report-ish keyword (anywhere), OR a bare markdown file
 * sitting directly at the session's cwd root (no keyword needed — that's
 * where an agent drops a one-off deliverable). Pure; exported for tests.
 */
export function isReportCandidatePath(absPath: string, cwd: string): boolean {
  if (!absPath.toLowerCase().endsWith('.md')) return false;
  const base = basename(absPath).toLowerCase();
  if (REPORT_KEYWORDS.some((k) => base.includes(k))) return true;
  if (EXCLUDED_BASENAMES.has(base)) return false;
  const rel = relative(cwd, absPath);
  if (rel.startsWith('..')) return false; // outside cwd entirely
  return rel.split(sep).filter(Boolean).length === 1; // a bare filename, no subdir
}

/** What the service needs to know about a session to scan it. */
export interface AutoReportSessionInfo {
  projectId: string;
  profile: string;
  cwd: string;
  claudeSessionId?: string;
  /** OpenCode's already-detected session id (see `TranscriptSessionRef`). */
  openCodeSessionId?: string;
  createdAt?: number;
  /** Background sessions run their own reporting path (schedule_report); skip them here. */
  scheduled?: boolean;
  headless?: boolean;
}

export interface AutoReportDeps {
  /** Master switch. Read live so a config toggle takes effect at once. */
  isEnabled: () => boolean;
  /** Session metadata, or null if the session is gone. */
  getSession: (sessionId: string) => AutoReportSessionInfo | null;
  /** True when the profile has a readable transcript (provider-agnostic). */
  hasTranscript: (profile: string) => boolean;
  /** Read the session's distilled stats (we only use `.files`). Never throws. */
  readStats: (ref: TranscriptRef) => Promise<SessionStats | null>;
  /** Absolute project root for a project id, or undefined if unknown. */
  projectRoot: (projectId: string) => string | undefined;
  /**
   * Convert an absolute file path to a project-root-relative posix path,
   * confined to `root` (Rule 2) — or null when it doesn't resolve inside it.
   */
  toProjectRelative: (root: string, absPath: string) => string | null;
  /** Display label for the project, or undefined to fall back to the id. */
  projectLabel: (projectId: string) => string | undefined;
  /** Resume/reopen coordinates for the originating agent, resolved from the live pty (Rule 1). */
  resolveOrigin: (sessionId: string) => InboxOrigin | null;
  /**
   * True when an inbox entry already links this session to this project-relative
   * doc path — covers both a manual `inbox_push` that beat us to it AND an
   * app-restart clearing the in-memory dedup set. Backed by a store read, so it's
   * checked once per candidate file rather than per scan.
   */
  alreadyLinked: (sessionId: string, rel: string) => Promise<boolean>;
  /** Append the auto-linked report entry; never expected to throw in a way that crashes the caller. */
  appendInbox: (input: InboxInput) => Promise<{ id: string }>;
  /** Optional error sink (defaults to console.error). */
  onError?: (context: string, err: unknown) => void;
}

/**
 * Watches agent-state transitions and, on each edge into `idle`, links any
 * newly-touched report-looking file to the inbox. Wire {@link observe} to the
 * agent-status `status` event and {@link remove} to pty exit (Rule 3).
 */
export class AutoReportLinkerService {
  /** sessionId → relative paths already linked, so a later idle edge doesn't re-push. */
  private linked = new Map<string, Set<string>>();
  /** sessionIds with a scan currently in flight — guards against overlapping idle edges. */
  private scanning = new Set<string>();

  constructor(private readonly deps: AutoReportDeps) {}

  observe(sessionId: string, state: AgentState): void {
    if (state !== 'idle') return;
    if (this.scanning.has(sessionId)) return;
    this.scanning.add(sessionId);
    void this.scan(sessionId).finally(() => {
      this.scanning.delete(sessionId);
    });
  }

  /** Forget a session (call on pty exit) — drops its dedup set (Rule 5 cleanup). */
  remove(sessionId: string): void {
    this.linked.delete(sessionId);
  }

  // ----- internals -----------------------------------------------------------

  private async scan(sessionId: string): Promise<void> {
    if (!this.deps.isEnabled()) return;
    const session = this.deps.getSession(sessionId);
    if (!session) return;
    if (session.scheduled || session.headless) return;
    if (!this.deps.hasTranscript(session.profile)) return;

    const stats = await this.deps.readStats({
      id: sessionId,
      profile: session.profile,
      cwd: session.cwd,
      claudeSessionId: session.claudeSessionId,
      openCodeSessionId: session.openCodeSessionId,
      createdAt: session.createdAt
    });
    const files = stats?.files;
    if (!files || files.length === 0) return;

    // Re-check enablement after the read (CLAUDE.md #5 practice) — cheap here
    // since there's no LLM spend, but keeps the same discipline as the other
    // idle-edge add-ons.
    if (!this.deps.isEnabled()) return;

    const root = this.deps.projectRoot(session.projectId);
    if (!root) return;

    const alreadyLinked = this.linked.get(sessionId) ?? new Set<string>();
    for (const f of files) {
      if (f.op === 'R') continue; // reads never count as a deliverable
      if (!isReportCandidatePath(f.path, session.cwd)) continue;
      const rel = this.deps.toProjectRelative(root, f.path);
      if (!rel || alreadyLinked.has(rel)) continue;
      // Fall back to a store check — covers a manual inbox_push that beat us to
      // this file, or the in-memory dedup set having been cleared by a restart.
      if (await this.deps.alreadyLinked(sessionId, rel)) {
        alreadyLinked.add(rel);
        continue;
      }

      try {
        await this.deps.appendInbox({
          projectId: session.projectId,
          projectLabel: this.deps.projectLabel(session.projectId),
          sessionId,
          origin: this.deps.resolveOrigin(sessionId) ?? undefined,
          docs: [{ path: rel }],
          report: true
        });
        alreadyLinked.add(rel);
      } catch (err) {
        (this.deps.onError ?? ((ctx, e) => console.error(ctx, e)))(
          '[auto-report-linker] append failed:',
          err
        );
        // Leave it unlinked — a future idle edge retries.
      }
    }
    if (alreadyLinked.size > 0) this.linked.set(sessionId, alreadyLinked);
  }
}
