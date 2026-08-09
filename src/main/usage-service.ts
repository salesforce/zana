/**
 * Usage / cost rollup service (WARP R2 B7, "Foundation first" PR A).
 *
 * The renderer's Usage dashboard asks main for a cost/token summary across the
 * user's projects. Main is the only side that may read Claude transcripts off
 * disk and map a renderer-supplied projectId to a real path (CLAUDE.md Rule 1),
 * so the aggregation lives here — the renderer only ever receives the finished,
 * privacy-safe {@link UsageSummary}.
 *
 * Every collaborator is INJECTED (mirroring {@link InboxSummaryService}) so the
 * orchestration is unit-testable without Electron, the filesystem, or a real
 * transcript — the DI seam is the whole point of this file's testability.
 *
 * Two disciplines this file exists to enforce:
 *   1. **Privacy by construction.** Each session becomes a {@link UsageSessionEvent}
 *      — id + project + persona + model + cost/tokens/duration, and NOTHING a
 *      session said or touched. Every event is run through {@link assertUgcFree}
 *      before it enters the rollup, so a smuggled field (or an over-long "name")
 *      is rejected rather than leaked into the Top-N list.
 *   2. **Bounded work (Rule 5).** Reading a transcript is a multi-MB file read;
 *      doing it for every session of every project would be an unbounded read
 *      storm on an on-demand call. We cap projects scanned, sessions read per
 *      project, and total transcripts read — and `log` what we dropped so the
 *      cap is visible, never a silent undercount.
 *
 * Never throws: the dashboard is a convenience surface. A failed project/session
 * read is skipped (it contributes nothing) rather than failing the whole summary.
 */

import type { ClaudeSessionSummary, SessionStats } from '../shared/types.js';
import {
  aggregateUsage,
  assertUgcFree,
  isUgcFree,
  MAX_IDENTIFIER_LEN,
  TOP_SESSIONS_MAX,
  type UsageSessionEvent,
  type UsageSummary
} from '../shared/telemetry-events.js';

/** Cap on projects scanned per summary — the rail rarely exceeds this, and it
 *  bounds the outer loop regardless of how many projects are registered. */
export const USAGE_MAX_PROJECTS = 60;
/** Cap on transcripts fully READ (for stats) per project — only the newest are
 *  read; older sessions are counted-but-unread so the read stays bounded. */
export const USAGE_MAX_SESSIONS_PER_PROJECT = 25;
/** Global cap on transcripts read across ALL projects in one summary. */
export const USAGE_MAX_SESSIONS_TOTAL = 400;

/** A registered project as the service needs it — id + display name + path. */
export interface UsageProjectRef {
  id: string;
  name: string;
  path: string;
}

export interface UsageServiceDeps {
  /**
   * The projects to aggregate over — main's OWN registry (Rule 1), never a
   * renderer-supplied list. Paths here are already confined (registered).
   */
  listProjects: () => UsageProjectRef[];
  /**
   * Enumerate a project's Claude transcript sessions (newest-first, bounded).
   * The `listClaudeSessions` primitive from `claude.ts`.
   */
  listSessions: (projectPath: string) => Promise<ClaudeSessionSummary[]>;
  /**
   * Read a single session's cost/token stats from its transcript, or null when
   * the file is missing/unreadable. Wraps `readSessionStats` over the derived
   * transcript path.
   */
  readStats: (projectPath: string, sessionId: string) => Promise<SessionStats | null>;
  /**
   * Optional: the persona a session ran under, if known (e.g. from the live
   * session map). Transcripts don't record the persona, so this is best-effort
   * — an unknown session simply has no persona in its event.
   */
  personaFor?: (sessionId: string) => string | undefined;
  /** Optional progress/diagnostic sink (e.g. main's logger). No-op if absent. */
  log?: (msg: string) => void;
}

/** Clamp a string to identifier length so {@link assertUgcFree} never rejects a
 *  merely-long-but-benign label (a pathological project name won't fail a whole
 *  summary — it's truncated to a safe identifier). */
function clampId(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.length > MAX_IDENTIFIER_LEN ? s.slice(0, MAX_IDENTIFIER_LEN) : s;
}

/**
 * Build a privacy-safe {@link UsageSessionEvent} from a transcript session +
 * its stats. Returns null when the session carried no usage at all (nothing to
 * price or count) or — defensively — if the assembled event somehow fails the
 * UGC guard. Pure; exported for tests.
 */
export function toSessionEvent(
  project: UsageProjectRef,
  session: ClaudeSessionSummary,
  stats: SessionStats | null,
  persona?: string
): UsageSessionEvent | null {
  // A session with no token accounting AND no activity contributes nothing to
  // the rollup — drop it rather than pad the count with empty rows.
  const totalTokens = stats?.tokens
    ? stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite
    : undefined;
  if (
    totalTokens === undefined &&
    stats?.promptCount === undefined &&
    stats?.toolCalls === undefined
  ) {
    return null;
  }

  const durationMs = Math.max(0, session.lastActiveAt - session.startedAt);
  const event: UsageSessionEvent = {
    kind: 'usage.session',
    sessionId: session.id,
    projectId: project.id,
    projectName: clampId(project.name) ?? project.id,
    ...(clampId(persona) ? { persona: clampId(persona) } : {}),
    ...(clampId(stats?.model) ? { model: clampId(stats?.model) } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(stats?.promptCount !== undefined ? { promptCount: stats.promptCount } : {}),
    ...(stats?.toolCalls !== undefined ? { toolCalls: stats.toolCalls } : {}),
    ...(stats?.mcpCalls !== undefined ? { mcpCalls: stats.mcpCalls } : {}),
    ...(durationMs > 0 ? { durationMs } : {})
  };

  // Belt-and-suspenders: the type system already forbids a content field; this
  // rejects a smuggled one built from untyped disk data. Drop rather than throw
  // so one odd session can't fail the whole summary.
  return isUgcFree(event) ? event : null;
}

export class UsageService {
  constructor(
    private readonly deps: UsageServiceDeps,
    /** Injectable clock so `generatedAt` (and thus tests) are deterministic. */
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Compute the cost/usage summary across all registered projects. Bounded per
   * Rule 5 (projects, sessions-per-project, total transcripts read). Never
   * throws — a project/session that fails to read is skipped. `topN` overrides
   * the Top-N session cap (defaults to {@link TOP_SESSIONS_MAX}).
   */
  async summarize(topN: number = TOP_SESSIONS_MAX): Promise<UsageSummary> {
    const log = this.deps.log ?? (() => {});
    const allProjects = this.deps.listProjects();
    const projects = allProjects.slice(0, USAGE_MAX_PROJECTS);
    if (projects.length < allProjects.length) {
      log(`usage: scanning ${projects.length}/${allProjects.length} projects (cap ${USAGE_MAX_PROJECTS})`);
    }

    const events: UsageSessionEvent[] = [];
    let readBudget = USAGE_MAX_SESSIONS_TOTAL;

    for (const project of projects) {
      if (readBudget <= 0) {
        log(`usage: hit global read cap (${USAGE_MAX_SESSIONS_TOTAL}) — remaining projects skipped`);
        break;
      }

      let sessions: ClaudeSessionSummary[];
      try {
        sessions = await this.deps.listSessions(project.path);
      } catch {
        continue; // a project whose transcript dir can't be listed contributes nothing
      }

      // Newest-first already (listClaudeSessions orders by mtime desc). Read only
      // the newest few per project, and never more than the global budget allows.
      const perProject = Math.min(USAGE_MAX_SESSIONS_PER_PROJECT, readBudget);
      const toRead = sessions.slice(0, perProject);
      if (sessions.length > toRead.length) {
        log(`usage: ${project.name}: reading ${toRead.length}/${sessions.length} sessions`);
      }
      readBudget -= toRead.length;

      const built = await Promise.all(
        toRead.map(async (session) => {
          let stats: SessionStats | null;
          try {
            stats = await this.deps.readStats(project.path, session.id);
          } catch {
            return null;
          }
          const persona = this.deps.personaFor?.(session.id);
          return toSessionEvent(project, session, stats, persona);
        })
      );
      for (const e of built) {
        if (e) events.push(assertUgcFree(e));
      }
    }

    return aggregateUsage(events, this.now(), topN);
  }
}
