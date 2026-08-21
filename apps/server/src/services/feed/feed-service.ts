/**
 * FeedService — assembles a project's Activity Feed on demand (HYBRID model).
 *
 * The design council (see `.zcc/library/designs/project-activity-feed.md`)
 * chose a hybrid over a materialized aggregator: most events are DERIVED live
 * from stores that already persist them (inbox / followups / goals / library),
 * so we never duplicate that data; only the greenfield events with no other
 * home (git commits, extension + project lifecycle) are persisted, in
 * {@link FeedStore}.
 *
 * On a `list`/`refresh` the service:
 *   1. reads the persisted slice (`FeedStore.list`),
 *   2. derives milestone events from the other stores' current state,
 *   3. (on `refresh`, or `list` when the feed is cold) snapshots `git log` into
 *      the persisted slice so commits survive between opens,
 *   4. merges, sorts newest-first, de-dupes by id, and paginates.
 *
 * Only MILESTONE/OUTCOME events make the cut — not raw agent-status flips or
 * per-session spawns (unreadable noise, per the council). Reads main's own
 * stores; the renderer only supplies a projectId to scope + a cursor (rule 1).
 * Every collaborator is injected so this is unit-testable without Electron.
 * Never throws — a source that errors is simply omitted.
 */

import type {
  FeedEvent,
  FeedEventInput,
  FeedPage,
  FollowUp,
  Goal,
  GitCommit,
  InboxEntry,
  LibraryDoc
} from '@zana-ai/zcc-domain/product';
import { AUTO_CLOSE_KEY_PREFIX } from '@zana-ai/zcc-domain/inbox-grouping';
import type { FeedStore } from './feed-store.js';

/** Default page size for `feed:list`. */
export const FEED_PAGE_SIZE = 60;
/** How many commits to snapshot per refresh. Bounded (rule 5). */
export const FEED_GIT_LIMIT = 50;
/** Upper bound on derived events pulled from any one store, so a huge store
 *  can't dominate the merge (rule 5). */
export const FEED_DERIVED_CAP = 400;

export interface FeedServiceDeps {
  /** The persisted greenfield slice (commits / extension / project lifecycle). */
  store: FeedStore;
  /** Read recent inbox entries for a project (main's own store; newest-first). */
  readInbox: (projectId: string, limit: number) => Promise<InboxEntry[]>;
  /** All follow-ups (any project); the service filters by projectId. */
  listFollowups: () => FollowUp[];
  /** All goals (any project); the service filters by projectId. */
  listGoals: () => Goal[];
  /** All library docs (any project); the service filters by projectId. */
  listLibrary: () => LibraryDoc[];
  /** Read recent commits for a project's repo. Never throws (returns []). */
  getRecentCommits: (cwd: string, limit: number) => Promise<GitCommit[]>;
  /** Resolve a projectId to its filesystem path (for git) + label. */
  resolveProject: (projectId: string) => { path: string; name: string } | undefined;
  logger?: (context: string, err: unknown) => void;
}

/* ------------------------------- derivations ------------------------------ */
/* Each is pure (state in → FeedEvent[] out) and exported for tests.          */

/**
 * Derive feed events from inbox entries. An auto-close breadcrumb becomes a
 * `session-finished` milestone; a scheduled run becomes `schedule-run`; a
 * plain agent report becomes `report`. Questions are SKIPPED — those are the
 * Inbox's job (things needing attention), not passive history.
 */
export function deriveFromInbox(entries: readonly InboxEntry[]): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const e of entries) {
    if (e.question) continue; // needs-attention, not history
    const isAutoClose = !!e.dedupeKey && e.dedupeKey.startsWith(AUTO_CLOSE_KEY_PREFIX);
    let kind: FeedEvent['kind'];
    let title: string;
    const subject = e.subject?.trim();
    if (isAutoClose) {
      kind = 'session-finished';
      title = subject || firstLine(e.comments) || 'Agent session finished';
    } else if (e.scheduled) {
      kind = 'schedule-run';
      title = subject || firstLine(e.comments) || 'Scheduled run completed';
    } else {
      kind = 'report';
      title = subject || firstLine(e.comments) || docLabel(e) || 'Agent posted a report';
    }
    const context = e.intent?.trim() || e.origin?.title?.trim();
    out.push({
      id: `inbox:${e.id}`,
      projectId: e.projectId,
      kind,
      ts: e.ts,
      title,
      detail: inboxDetail(e, title),
      context: context && context !== title ? context : undefined,
      sessionId: e.sessionId
    });
  }
  return out;
}

/**
 * Build the expandable `detail` body for an inbox-derived feed event. The inbox
 * entry carries far more than a one-line title — a `comments` markdown body, an
 * `intent` (the "why"/goal), and attached `docs`. We surface all of it so an
 * expanded feed row shows the actual report instead of "No extra details."
 * Returns undefined when there's genuinely nothing beyond the title.
 */
function inboxDetail(e: InboxEntry, title: string): string | undefined {
  const parts: string[] = [];
  // The full comments body (markdown, often multi-line); skip only if it IS
  // the title. The renderer shows this through the shared markdown pipeline, so
  // headings / lists / code structure survive.
  const body = e.comments?.trim();
  if (body && body !== title) parts.push(body);
  if (e.docs && e.docs.length > 0) {
    parts.push(e.docs.map((d) => `- 📄 ${d.path}`).join('\n'));
  }
  const detail = parts.join('\n\n').trim();
  return detail.length > 0 ? detail : undefined;
}

/** Derive created + resolved milestones from a project's follow-ups. */
export function deriveFromFollowups(followups: readonly FollowUp[], projectId: string): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const f of followups) {
    if (f.projectId !== projectId) continue;
    const created = Date.parse(f.createdAt);
    if (Number.isFinite(created)) {
      out.push({
        id: `followup-created:${f.id}`,
        projectId,
        kind: 'followup-created',
        ts: created,
        title: `Follow-up opened: ${f.title}`,
        sessionId: f.sessionId
      });
    }
    if (f.status !== 'open') {
      const resolved = Date.parse(f.resolvedAt ?? f.updatedAt);
      if (Number.isFinite(resolved)) {
        const verb = f.status === 'dismissed' ? 'dismissed' : 'resolved';
        out.push({
          id: `followup-resolved:${f.id}`,
          projectId,
          kind: 'followup-resolved',
          ts: resolved,
          title: `Follow-up ${verb}: ${f.title}`,
          detail: f.resolution || undefined,
          sessionId: f.sessionId
        });
      }
    }
  }
  return out;
}

/** Derive achieved/escalated milestones from a project's goals. */
export function deriveFromGoals(goals: readonly Goal[], projectId: string): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const g of goals) {
    if (g.projectId !== projectId) continue;
    if (g.status !== 'achieved' && g.status !== 'escalated') continue;
    const ts = Date.parse(g.updatedAt);
    if (!Number.isFinite(ts)) continue;
    const verb = g.status === 'achieved' ? 'achieved' : 'escalated';
    out.push({
      id: `goal:${g.id}:${g.status}`,
      projectId,
      kind: 'goal-achieved',
      ts,
      title: `Goal ${verb}: ${g.title}`
    });
  }
  return out;
}

/** Derive doc-written milestones from a project's library. Skips human edits
 *  (source.kind === 'user') — the feed tracks agent/schedule/inbox authorship. */
export function deriveFromLibrary(docs: readonly LibraryDoc[], projectId: string): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const d of docs) {
    if (d.projectId !== projectId) continue;
    if (d.source?.kind === 'user') continue;
    const ts = d.updatedAt;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    out.push({
      id: `library:${d.id}:${ts}`,
      projectId,
      kind: 'library-doc',
      ts,
      title: `Library doc written: ${d.title || d.relPath}`,
      sessionId: d.source?.sessionId
    });
  }
  return out;
}

/**
 * Merge many event lists, de-dupe by id (last wins is fine — ids are stable),
 * sort newest-first, and return a page from the cursor. Pure; exported for tests.
 */
export function mergeAndPaginate(
  lists: FeedEvent[][],
  opts: { limit: number; before?: number }
): FeedPage {
  const byId = new Map<string, FeedEvent>();
  for (const list of lists) {
    for (const ev of list) byId.set(ev.id, ev);
  }
  let all = [...byId.values()].sort((a, b) => b.ts - a.ts);
  if (typeof opts.before === 'number') {
    all = all.filter((e) => e.ts < opts.before!);
  }
  const page = all.slice(0, opts.limit);
  return { events: page, hasMore: all.length > opts.limit };
}

/** Turn a commit into a persisted feed-event input (idempotent via hash key). */
export function commitToInput(projectId: string, c: GitCommit): FeedEventInput {
  return {
    projectId,
    kind: 'commit',
    ts: c.ts,
    title: c.subject || `Commit ${c.shortHash}`,
    detail: `${c.shortHash} · ${c.author}`,
    dedupeKey: `commit:${c.hash}`
  };
}

/* --------------------------------- service -------------------------------- */

export class FeedService {
  constructor(private readonly deps: FeedServiceDeps) {}

  private log(context: string, err: unknown) {
    this.deps.logger?.(context, err);
  }

  /**
   * Assemble a page of the feed for a project. When `refreshGit` is true (a
   * `refresh` call, or a cold `list`), snapshots `git log` into the persisted
   * slice first so commits survive between opens.
   */
  async list(
    projectId: string,
    opts: { limit?: number; before?: number; refreshGit?: boolean } = {}
  ): Promise<FeedPage> {
    const limit = clampLimit(opts.limit);
    if (opts.refreshGit) {
      await this.snapshotGit(projectId);
    }

    const lists: FeedEvent[][] = [];

    // 1. persisted greenfield slice (commits + extension + project lifecycle).
    try {
      lists.push(this.deps.store.list(projectId).slice(0, FEED_DERIVED_CAP));
    } catch (err) {
      this.log('feed persisted slice', err);
    }

    // 2. derived: inbox reports / session-finished / schedule-run.
    try {
      const entries = await this.deps.readInbox(projectId, FEED_DERIVED_CAP);
      lists.push(deriveFromInbox(entries));
    } catch (err) {
      this.log('feed derive inbox', err);
    }

    // 3. derived: follow-ups / goals / library (all read from memory).
    try {
      lists.push(deriveFromFollowups(this.deps.listFollowups(), projectId));
    } catch (err) {
      this.log('feed derive followups', err);
    }
    try {
      lists.push(deriveFromGoals(this.deps.listGoals(), projectId));
    } catch (err) {
      this.log('feed derive goals', err);
    }
    try {
      lists.push(deriveFromLibrary(this.deps.listLibrary(), projectId));
    } catch (err) {
      this.log('feed derive library', err);
    }

    return mergeAndPaginate(lists, { limit, before: opts.before });
  }

  /** Read `git log` for the project and persist any new commits. Never throws. */
  private async snapshotGit(projectId: string): Promise<void> {
    const project = this.deps.resolveProject(projectId);
    if (!project) return;
    try {
      const commits = await this.deps.getRecentCommits(project.path, FEED_GIT_LIMIT);
      if (commits.length === 0) return;
      const inputs = commits.map((c) => commitToInput(projectId, c));
      this.deps.store.appendMany(projectId, inputs);
    } catch (err) {
      this.log('feed snapshot git', err);
    }
  }
}

/* --------------------------------- helpers -------------------------------- */

function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return FEED_PAGE_SIZE;
  return Math.max(1, Math.min(200, Math.floor(limit)));
}

/** First non-empty line of a markdown body, markers stripped. */
function firstLine(text?: string): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  const line = t.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.replace(/^[#>*\-\s]+/, '').trim().slice(0, 160);
}

function docLabel(e: InboxEntry): string {
  if (e.docs && e.docs.length > 0 && e.docs[0]) {
    const extra = e.docs.length > 1 ? ` (+${e.docs.length - 1} more)` : '';
    return `📄 ${e.docs[0].path}${extra}`;
  }
  return '';
}
