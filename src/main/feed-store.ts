/**
 * FeedStore — the PERSISTED slice of the per-project Activity Feed.
 *
 * The feed is mostly DERIVED live (from the inbox / followups / goals / library
 * stores + `git log`), so it needs no new persistence for those. This store
 * holds only the small set of "greenfield" events that have no other durable
 * home and must survive between feed opens:
 *
 *   - `commit`                  — snapshots of `git log` (so history the log
 *                                 window has rolled past still shows), and so a
 *                                 commit shows even after the working copy moves.
 *   - `extension-installed` /
 *     `extension-uninstalled`   — stamped by main's extension lifecycle handlers.
 *   - `project-created`         — stamped when a project is added.
 *
 * Persistence mirrors {@link InboxStore}: append-only JSONL at
 * `<project>/.zcc/activity.jsonl`, atomic tmp+rename rewrites (CLAUDE.md rule 4),
 * bounded to {@link MAX_FEED_ENTRIES_PER_PROJECT} newest entries (rule 5). It is
 * an `EventEmitter` — emits `'changed'` with the projectId so `index.ts` can
 * push `feed:onChanged` to an open feed view.
 *
 * Provenance is host-stamped: agents never call into this (there is no
 * `feed_push` MCP tool — the design council rejected it as a noise magnet).
 * All writers are trusted main-process code that already knows the projectId
 * (rule 1). `dedupeKey` makes re-stamping the same commit/extension idempotent,
 * so re-reading `git log` on every feed open doesn't create duplicate rows.
 */

import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import type { FeedEvent, FeedEventInput, Project } from '../shared/types.js';

/**
 * Per-project retention cap on persisted feed rows. The persisted slice is the
 * low-volume tier (commits + extension/project lifecycle — tens per active day,
 * not the inbox's per-message cadence), so 500 is generous while keeping the
 * file small enough to parse in a frame. Beyond this, the oldest rows are
 * dropped on the next write.
 */
export const MAX_FEED_ENTRIES_PER_PROJECT = 500;

/** Per-project on-disk path: `<project>/.zcc/activity.jsonl`. */
export function activityFile(project: Project): string {
  return join(project.path, '.zcc', 'activity.jsonl');
}

type Logger = (context: string, err: unknown) => void;

interface StoredEvent {
  id: string;
  projectId: string;
  kind: FeedEvent['kind'];
  ts: number;
  title: string;
  detail?: string;
  /** De-dupe key; kept on disk so re-stamping the same source event is a no-op. */
  dedupeKey: string;
}

function ensureDirFor(file: string) {
  const dir = file.slice(0, file.lastIndexOf('/'));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Read + validate the JSONL for one project. Tolerant of hand edits / partial
 * lines (a torn last line from a crash is skipped, not fatal). Returns
 * newest-last (file order); callers sort. Pure-ish; no throw.
 */
export function readProjectFeed(file: string, onInvalid?: Logger): StoredEvent[] {
  if (!existsSync(file)) return [];
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    onInvalid?.(`read ${file}`, err);
    return [];
  }
  const out: StoredEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Torn/partial line (e.g. crash mid-append) — skip it, keep the rest.
      continue;
    }
    const ev = coerce(parsed);
    if (ev) out.push(ev);
  }
  return out;
}

function coerce(raw: unknown): StoredEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.projectId !== 'string' || !r.projectId) return null;
  if (typeof r.kind !== 'string') return null;
  if (typeof r.ts !== 'number' || !Number.isFinite(r.ts)) return null;
  if (typeof r.title !== 'string') return null;
  if (typeof r.dedupeKey !== 'string' || !r.dedupeKey) return null;
  return {
    id: r.id,
    projectId: r.projectId,
    kind: r.kind as FeedEvent['kind'],
    ts: r.ts,
    title: r.title,
    detail: typeof r.detail === 'string' ? r.detail : undefined,
    dedupeKey: r.dedupeKey
  };
}

let seq = 0;
/** Mint a stable-ish id without Math.random (unavailable in some sandboxes). */
function mintId(input: FeedEventInput): string {
  seq += 1;
  return `feed_${input.ts.toString(36)}_${(seq).toString(36)}`;
}

export class FeedStore extends EventEmitter {
  /** In-memory mirror per projectId, newest-first. Lazily loaded on first touch. */
  private cache = new Map<string, StoredEvent[]>();
  private loaded = new Set<string>();
  private logger?: Logger;

  constructor(private readonly resolveProject: (projectId: string) => Project | undefined) {
    super();
  }

  setLogger(logger: Logger) {
    this.logger = logger;
  }

  private log(context: string, err: unknown) {
    if (this.logger) this.logger(context, err);
  }

  private ensureLoaded(projectId: string): StoredEvent[] {
    if (this.loaded.has(projectId)) return this.cache.get(projectId) ?? [];
    const project = this.resolveProject(projectId);
    let events: StoredEvent[] = [];
    if (project) {
      events = readProjectFeed(activityFile(project), (c, e) => this.log(c, e));
      // Sort newest-first once on load; appends maintain the invariant.
      events.sort((a, b) => b.ts - a.ts);
    }
    this.cache.set(projectId, events);
    this.loaded.add(projectId);
    return events;
  }

  /** All persisted events for a project, newest-first. Reads disk once, then memory. */
  list(projectId: string): FeedEvent[] {
    return this.ensureLoaded(projectId).map(toFeedEvent);
  }

  /**
   * Append a greenfield event, or a no-op if `dedupeKey` already exists for the
   * project (idempotent re-stamping). Rewrites the JSONL atomically, trims to
   * the retention cap, and emits `'changed'` with the projectId. Never throws —
   * a write failure logs and returns null.
   */
  append(input: FeedEventInput): FeedEvent | null {
    const project = this.resolveProject(input.projectId);
    if (!project) return null;
    const events = this.ensureLoaded(input.projectId);
    if (events.some((e) => e.dedupeKey === input.dedupeKey)) return null;

    const stored: StoredEvent = {
      id: mintId(input),
      projectId: input.projectId,
      kind: input.kind,
      ts: input.ts,
      title: input.title,
      detail: input.detail,
      dedupeKey: input.dedupeKey
    };
    // Insert maintaining newest-first, then cap.
    events.push(stored);
    events.sort((a, b) => b.ts - a.ts);
    if (events.length > MAX_FEED_ENTRIES_PER_PROJECT) {
      events.length = MAX_FEED_ENTRIES_PER_PROJECT;
    }
    if (!this.rewrite(project, events)) return null;
    this.emit('changed', input.projectId);
    return toFeedEvent(stored);
  }

  /**
   * Append MANY greenfield events in one atomic rewrite (used by the git-commit
   * snapshot, which stamps up to 100 commits per feed open). Skips any whose
   * `dedupeKey` is already present. Emits a single `'changed'` if anything was
   * added. Returns the count added.
   */
  appendMany(projectId: string, inputs: FeedEventInput[]): number {
    const project = this.resolveProject(projectId);
    if (!project) return 0;
    const events = this.ensureLoaded(projectId);
    const seen = new Set(events.map((e) => e.dedupeKey));
    let added = 0;
    for (const input of inputs) {
      if (input.projectId !== projectId) continue;
      if (seen.has(input.dedupeKey)) continue;
      seen.add(input.dedupeKey);
      events.push({
        id: mintId(input),
        projectId,
        kind: input.kind,
        ts: input.ts,
        title: input.title,
        detail: input.detail,
        dedupeKey: input.dedupeKey
      });
      added += 1;
    }
    if (added === 0) return 0;
    events.sort((a, b) => b.ts - a.ts);
    if (events.length > MAX_FEED_ENTRIES_PER_PROJECT) {
      events.length = MAX_FEED_ENTRIES_PER_PROJECT;
    }
    if (!this.rewrite(project, events)) return 0;
    this.emit('changed', projectId);
    return added;
  }

  /** Drop a project's persisted feed + cache (called when a project is removed). */
  onProjectRemoved(projectId: string) {
    this.cache.delete(projectId);
    this.loaded.delete(projectId);
    // The JSONL lives under the project dir; project removal takes the dir, so
    // there's nothing to clean here (mirrors followups leaving files in place).
  }

  private rewrite(project: Project, events: StoredEvent[]): boolean {
    const file = activityFile(project);
    try {
      ensureDirFor(file);
      const payload = events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
      const tmp = `${file}.tmp-${process.pid}-${seq}`;
      writeFileSync(tmp, payload);
      renameSync(tmp, file);
      return true;
    } catch (err) {
      this.log(`rewrite ${file}`, err);
      return false;
    }
  }
}

function toFeedEvent(e: StoredEvent): FeedEvent {
  return {
    id: e.id,
    projectId: e.projectId,
    kind: e.kind,
    ts: e.ts,
    title: e.title,
    detail: e.detail
  };
}
