/**
 * InboxStore — project-anchored push surface, Linear-inbox model.
 *
 * The atomic concept is the **Project**, not Linear's "Issue". The agent runs inside a
 * project, and its work product is the project folder's files — not
 * single comments authored at notification time. So an inbox entry
 * carries:
 *
 *   - `docs`     pointers to files in the project ("go read these")
 *                — rendered live at view time, never snapshotted
 *   - `comments` the agent's voice — markdown, the actual message body
 *                ("hey boss, here's what I want to say about it")
 *
 * Both are optional but at least one must be present. Pointer-only on
 * docs is deliberate: the project folder is its own version-controlled
 * source of truth, so snapshotting into the inbox would just create a
 * stale parallel copy. Project deletion → inbox tombstones; that's
 * correct semantics, not a lifecycle bug.
 *
 * Persistence: append-only JSONL at `~/.zcc/inbox/entries.jsonl`,
 * `projectId` required, at least one of {docs, comments} required.
 * Atomic delete via tmp + rename (matches the pattern in `store.ts`).
 */

import { randomUUID } from 'node:crypto';
import { readFile, appendFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { InboxDoc, InboxEntry, InboxNotifyLevel, InboxQuestion } from '@zana-ai/zcc-domain/product';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';

export type { InboxDoc, InboxEntry } from '@zana-ai/zcc-domain/product';

export interface InboxInput {
  projectId: string;
  /** Display snapshot of the project label. Optional; readers fall back to projectId. */
  projectLabel?: string;
  /** Project files to render. Each entry is a pointer — content is fetched live at view time. */
  docs?: InboxDoc[];
  /** Agent's message body (markdown). Renders below docs. */
  comments?: string;
  /**
   * OPTIONAL author-set one-line heading — see {@link InboxEntry.subject}. The
   * store normalizes it in {@link validateInput} (trim, single-line, length cap)
   * before persisting; it is NOT counted as content (a subject-only push is
   * rejected).
   */
  subject?: string;
  /**
   * OPTIONAL author-set "why"/goal for this entry — the context the agent was
   * pursuing. Normalized in {@link validateInput} (trim, single-line, capped)
   * like {@link subject}; NOT counted as content (an intent-only push is
   * rejected). See {@link InboxEntry.intent}.
   */
  intent?: string;
  /**
   * OPTIONAL author-set flag marking this push as a REPORT (a finished
   * deliverable/analysis, not a routine check-in). Persisted as-is on the entry
   * and used by the renderer's report-only surfaces (Reports tab, filter, badge).
   * See {@link InboxEntry.report}. NOT counted as content — a report-only push
   * (no docs/comments/question) is still rejected.
   */
  report?: boolean;
  /**
   * Structured multiple-choice question form (the `inbox_ask` tool). When set,
   * the entry renders Cursor-style options + Skip/Continue and the chosen answer
   * is injected back into {@link sessionId}'s pty. See {@link InboxQuestion}.
   */
  question?: InboxQuestion;
  /**
   * Multiple structured questions asked together (the `inbox_ask` tool with a
   * `questions` array). Mutually exclusive with {@link question}. See
   * {@link InboxEntry.questions}.
   */
  questions?: InboxQuestion[];
  /** Originating terminal session, when known. Persisted as-is on the entry. */
  sessionId?: string;
  /**
   * Resume/reopen coordinates for the originating agent, resolved server-side
   * from the live pty at push time. Persisted as-is so the inbox can reopen the
   * agent's work after its tab is gone. See {@link InboxEntry.origin}.
   */
  origin?: import('@zana-ai/zcc-domain/product').InboxOrigin;
  /** True when the push came from a scheduled (background) run. */
  scheduled?: boolean;
  /** Loudness for scheduled entries; copied onto the entry. See {@link InboxNotifyLevel}. */
  notify?: InboxNotifyLevel;
  /**
   * Coalescing key. When present, this push folds into the most-recent live
   * entry sharing the same `(projectId, dedupeKey)` instead of appending a new
   * one — see {@link InboxEntry.dedupeKey}. Absent ⇒ always a fresh entry.
   */
  dedupeKey?: string;
  /**
   * Host-stamped extension provenance — see {@link InboxEntry.extensionSource}.
   * Only the brokered `ctx.inbox.push` performer (`broker-caps.ts`) sets this,
   * from the AUTHENTICATED moduleId; every other caller omits it.
   */
  extensionSource?: { extensionId: string };
  /**
   * OPTIONAL click-navigation redirect for an extension-pushed entry — see
   * {@link InboxEntry.target}. Only ever set alongside {@link extensionSource}
   * (`pushInboxOnBehalfOf` rejects it otherwise) and only ever naming that same
   * `extensionId` — an extension may redirect a click to its OWN surface, never
   * a sibling's.
   */
  target?: { moduleId: string };
}

export interface InboxReadOpts {
  limit?: number;
  before?: string;
  projectId?: string;
}

export interface IInboxStore {
  append(input: InboxInput): Promise<InboxEntry>;
  read(opts?: InboxReadOpts): Promise<{ entries: InboxEntry[]; hasMore: boolean }>;
  /**
   * Hard-delete an entry by id. Returns true if removed, false if no
   * entry matched. JSONL rewrites are atomic (tmp + rename).
   */
  delete(id: string): Promise<boolean>;
  /**
   * Hard-delete many entries in a single atomic rewrite. Takes an explicit
   * id list (the entries to REMOVE) — never "keep only these" — so an entry
   * appended concurrently with a clear can't be deleted by accident. Emits
   * one `removed` event per deleted id. Returns the count removed.
   */
  deleteMany(ids: string[]): Promise<number>;
  onAppended(listener: (entry: InboxEntry) => void): () => void;
  /** Subscribe to live removals. Returns a dispose function. */
  onRemoved(listener: (id: string) => void): () => void;
  /**
   * Subscribe to live coalesces: a push that folded into an existing entry
   * (same `(projectId, dedupeKey)`) rather than appending. The listener gets
   * the full refreshed entry (same `id`, bumped `ts`/`occurrences`). Returns a
   * dispose function. See {@link InboxEntry.dedupeKey}.
   */
  onUpdated(listener: (entry: InboxEntry) => void): () => void;
  /**
   * Subscribe to retention evictions: when compaction drops old entries to stay
   * within the tier caps, this fires once with their ids. Lets the renderer drop
   * the evicted rows live AND prune their persisted read/keep/answered markers,
   * so those localStorage maps don't grow unbounded as history rolls over.
   * Mirrors `agent-message-log`'s `onPruned`. Returns a dispose function.
   */
  onPruned(listener: (removedIds: string[]) => void): () => void;
}

/** Default on-disk JSONL path: `$ZCC_DATA_DIR/inbox/entries.jsonl` (else `~/.zcc/...`). */
export function defaultInboxFile(): string {
  return join(resolveZccDataDir(), 'inbox', 'entries.jsonl');
}

/**
 * Retention cap: how many of the newest entries the JSONL keeps. The inbox is
 * append-only and scheduled runs push steadily, so without a cap the file grows
 * unbounded and every `read()` (full parse) and `delete()` (full rewrite) gets
 * slower forever. Capping bounds both at O(cap). 5000 entries is months of
 * history at a heavy cadence — well past what the UI paginates — while keeping
 * the file small enough to parse in a frame.
 */
export const DEFAULT_MAX_INBOX_ENTRIES = 5000;

/**
 * Retention cap for QUIET scheduled entries specifically — recurring-job
 * notices that stay collapsed and badge-free (`scheduled && notify !== 'loud'`).
 * These are the high-volume, low-value tier. Capping them SEPARATELY from the
 * protected tier ({@link DEFAULT_MAX_INBOX_ENTRIES}) is the whole point: a
 * chatty job can only ever evict other quiet notices, never the user's manual
 * entries or `loud` alerts. 500 is generous now that same-task notices coalesce
 * into one row (so this bounds *distinct* quiet rows, not raw run count).
 */
export const DEFAULT_MAX_QUIET_INBOX_ENTRIES = 500;

/**
 * Classify an entry as QUIET (the evictable tier). Mirrors the renderer's badge
 * rule (`scheduled && notify !== 'loud'`) and the sidebar's collapse rule so
 * "what the user sees as low-priority" and "what retention sacrifices first"
 * are the same set. Everything else — manual pushes, agent pushes, and `loud`
 * scheduled alerts — is PROTECTED.
 */
function isQuiet(entry: Pick<InboxEntry, 'scheduled' | 'notify'>): boolean {
  return entry.scheduled === true && entry.notify !== 'loud';
}

// ==================== Validation ====================

/**
 * Max length of a {@link InboxEntry.subject} heading. Generous for a single
 * line (roughly two sidebar rows' worth) but bounded so a pasted paragraph
 * can't ride into the heading. Truncated, never rejected — a too-long subject
 * is a formatting slip, not a hard error.
 */
export const MAX_INBOX_SUBJECT_CHARS = 200;

/**
 * Normalize an author-set subject into a single-line, bounded plain-text
 * heading: strip surrounding whitespace, collapse any embedded newlines/tabs to
 * single spaces (so a multi-line paste can't become the heading), and cap at
 * {@link MAX_INBOX_SUBJECT_CHARS}. Returns undefined when nothing meaningful
 * remains, so an empty/whitespace subject is dropped rather than persisted.
 * Never throws — a bad subject degrades to "no subject", never a failed append.
 */
function normalizeSubject(subject: string | undefined): string | undefined {
  return normalizeOneLine(subject, MAX_INBOX_SUBJECT_CHARS);
}

/**
 * Max length of an {@link InboxEntry.intent} line. A touch more generous than a
 * subject — an intent is a "why", which can need a clause more than a headline —
 * but still bounded so it can't grow into a paragraph. Truncated, never rejected.
 */
export const MAX_INBOX_INTENT_CHARS = 280;

function normalizeIntent(intent: string | undefined): string | undefined {
  return normalizeOneLine(intent, MAX_INBOX_INTENT_CHARS);
}

/**
 * Shared one-line normalizer (subject / intent): strip surrounding whitespace,
 * collapse embedded newlines/tabs/runs to single spaces (so a multi-line paste
 * can't become the line), and cap at `max`. Returns undefined when nothing
 * meaningful remains, so an empty/whitespace value is dropped rather than
 * persisted. Never throws — a bad value degrades to "absent", never a failed
 * append.
 */
function normalizeOneLine(value: string | undefined, max: number): string | undefined {
  if (value == null) return undefined;
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  return oneLine.length > max ? oneLine.slice(0, max) : oneLine;
}

function validateInput(input: InboxInput): void {
  if (!input.projectId) {
    throw new Error('InboxStore.append: projectId is required');
  }
  const hasDocs = (input.docs?.length ?? 0) > 0;
  const hasComments = (input.comments ?? '').trim().length > 0;
  // A question is "present" when it carries options — for either shape.
  const allQuestions = [
    ...(input.question ? [input.question] : []),
    ...(input.questions ?? [])
  ];
  const hasQuestion = allQuestions.some((q) => (q.options?.length ?? 0) > 0);
  if (!hasDocs && !hasComments && !hasQuestion) {
    throw new Error(
      'InboxStore.append: at least one of docs, comments, or question must be present'
    );
  }
  // Normalize the author-set subject in place (single line, trimmed, capped) so
  // every append() caller — MCP tools AND host producers — is covered by one
  // gate. Deliberately AFTER the content check above: a subject is a heading,
  // not content, so it can't satisfy the at-least-one-of rule. Dropping it to
  // undefined when empty keeps a blank subject off the persisted entry.
  input.subject = normalizeSubject(input.subject);
  // Same gate for the author-set intent (the "why"/goal). Also AFTER the content
  // check — an intent is context, not content, so an intent-only push is still
  // rejected. Empty/whitespace collapses to undefined and stays off the entry.
  input.intent = normalizeIntent(input.intent);
  if (input.docs) {
    for (const d of input.docs) {
      if (!d.path || typeof d.path !== 'string') {
        throw new Error('InboxStore.append: each doc must have a non-empty `path` string');
      }
    }
  }
  for (const q of allQuestions) {
    for (const o of q.options) {
      if (!o.id || typeof o.id !== 'string' || !o.label || typeof o.label !== 'string') {
        throw new Error('InboxStore.append: each question option needs a non-empty id + label');
      }
    }
  }
}

// ==================== JSONL store ====================

export interface InboxStoreOptions {
  /** Override the JSONL file path (defaults to `~/.zcc/inbox/entries.jsonl`). */
  filePath?: string;
  /**
   * Retain at most this many newest entries; older ones are dropped during an
   * amortized compaction (see {@link DEFAULT_MAX_INBOX_ENTRIES}). Pass a small
   * value in tests to exercise the cap. <= 0 disables retention entirely.
   *
   * This caps the PROTECTED tier (manual / agent / `loud` scheduled entries).
   * Quiet scheduled notices have their own, smaller cap — see {@link quietMaxEntries}.
   */
  maxEntries?: number;
  /**
   * Retain at most this many newest QUIET scheduled entries (`scheduled &&
   * notify !== 'loud'`). Capped independently of {@link maxEntries} so a noisy
   * recurring job can only evict other quiet notices, never the user's manual
   * entries or `loud` alerts. <= 0 disables the quiet cap (quiet entries then
   * fall under the protected cap like everything else). Defaults to
   * {@link DEFAULT_MAX_QUIET_INBOX_ENTRIES}.
   */
  quietMaxEntries?: number;
}

export function createInboxStore(opts: InboxStoreOptions = {}): IInboxStore {
  const filePath = opts.filePath ?? defaultInboxFile();
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_INBOX_ENTRIES;
  const quietMaxEntries = opts.quietMaxEntries ?? DEFAULT_MAX_QUIET_INBOX_ENTRIES;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  // The file can legitimately hold up to both caps' worth of lines (protected +
  // quiet). Trigger compaction off that COMBINED ceiling, not the protected cap
  // alone, so a healthy mix of quiet + protected entries doesn't trip a trim on
  // every append once protected-count alone passes maxEntries.
  const retentionCeiling = maxEntries + (quietMaxEntries > 0 ? quietMaxEntries : 0);
  // Amortize compaction: rather than rewrite on every append once we're at the
  // ceiling, let the file overshoot by this slack and compact in one pass. So
  // with a 5000 cap we trim ~once per 500 appends, not every append. A negative
  // or zero `maxEntries` disables the whole mechanism.
  const compactionSlack = Math.max(1, Math.floor(maxEntries * 0.1));
  const compactThreshold = retentionCeiling + compactionSlack;
  // Best-effort in-memory line-count hint. Seeded lazily from disk on the first
  // append of a process, then maintained incrementally. It only GATES whether
  // we bother to compact — the compaction itself re-reads the file as the
  // source of truth — so a stale hint can at worst delay or trigger an extra
  // (correct) compaction, never corrupt data.
  let lineCountHint: number | null = null;

  // In-process mutex. Every file-mutating critical section (append+compaction,
  // delete, deleteMany) appends itself to this promise chain so they run
  // strictly one-at-a-time WITHIN this store instance. Without it, append B's
  // appendFile can land between append A's compact() readFile and rename,
  // letting A rewrite from a stale snapshot and silently drop B. The chain's
  // tail is always kept resolved (errors are isolated per-task) so one failed
  // mutation can never wedge later ones; the original outcome (value or
  // rejection) is still surfaced to that task's own caller.
  let tail: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    // Keep the chain alive regardless of this task's success/failure.
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function countLines(): Promise<number> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return raw.split('\n').filter((l) => l.trim()).length;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw err;
    }
  }

  /**
   * Tiered retention. Keep the newest `maxEntries` PROTECTED lines (manual /
   * agent / `loud` scheduled) and, independently, the newest `quietMaxEntries`
   * QUIET lines, then re-emit the survivors in their ORIGINAL file order (so
   * read()'s newest-first reversal stays correct and coalesce's last-match scan
   * still finds the right entry). Atomic (tmp + rename), reads fresh so it's
   * correct regardless of the hint. No-op when retention is disabled or nothing
   * is over its cap. Returns the resulting live-line count for the hint.
   *
   * The two tiers are capped separately so a chatty quiet producer can only
   * push out other quiet notices — never the user's protected entries.
   */
  async function compact(): Promise<number> {
    if (maxEntries <= 0) return 0;
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw err;
    }
    const lines = raw.split('\n').filter((l) => l.trim());

    // Walk newest→oldest, keeping a per-tier survivor budget. An unparseable
    // line is always kept (can't classify it; never silently drop data).
    const keepIdx = new Set<number>();
    const evictedIds: string[] = [];
    let protectedBudget = maxEntries;
    const quietCapped = quietMaxEntries > 0;
    let quietBudget = quietCapped ? quietMaxEntries : Infinity;
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: InboxEntry | null = null;
      try {
        entry = JSON.parse(lines[i]) as InboxEntry;
      } catch {
        keepIdx.add(i);
        continue;
      }
      if (isQuiet(entry)) {
        if (quietBudget > 0) {
          quietBudget -= 1;
          keepIdx.add(i);
        } else {
          evictedIds.push(entry.id);
        }
      } else if (protectedBudget > 0) {
        protectedBudget -= 1;
        keepIdx.add(i);
      } else {
        evictedIds.push(entry.id);
      }
    }
    if (keepIdx.size === lines.length) return lines.length;

    // Re-emit in original order.
    const kept = lines.filter((_, i) => keepIdx.has(i));
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, kept.join('\n') + '\n', 'utf-8');
    await rename(tmp, filePath);
    // Tell subscribers which ids rolled off so they can drop the rows and prune
    // persisted markers. Emitted after the rename so the file already reflects it.
    if (evictedIds.length > 0) emitter.emit('pruned', evictedIds);
    return kept.length;
  }

  /**
   * Coalescing read-modify-write. Find the LAST on-disk entry matching
   * `(projectId, dedupeKey)`; if present, fold `next` into it (same `id`,
   * refreshed `ts`/`docs`/`comments`, `occurrences++`), MOVE it to the end so
   * file order stays chronological-by-last-write (read() reverses it to
   * newest-first), and rewrite atomically. Returns the merged entry, or `null`
   * if no prior entry shared the key (caller falls back to a plain append).
   *
   * This is the mechanism that keeps a chatty recurring producer to ONE row:
   * the rewrite swaps a line rather than growing the file, so coalescing also
   * keeps the JSONL small instead of relying on the retention cap to trim it.
   * Runs ONLY inside {@link runExclusive} — it's a read-modify-write that must
   * not interleave with a racing append/delete.
   */
  async function coalesce(next: InboxEntry): Promise<InboxEntry | null> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
    const lines = raw.split('\n').filter((l) => l.trim());
    // Scan from the end for the newest entry carrying this key.
    let matchIdx = -1;
    let prior: InboxEntry | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]) as InboxEntry;
        if (e.projectId === next.projectId && e.dedupeKey && e.dedupeKey === next.dedupeKey) {
          matchIdx = i;
          prior = e;
          break;
        }
      } catch {
        // Skip unparseable lines — never let one abort coalescing.
      }
    }
    if (matchIdx < 0 || !prior) return null;

    const merged: InboxEntry = {
      ...prior,
      // Overlay the new push's content; keep the prior id (stable row).
      projectLabel: next.projectLabel ?? prior.projectLabel,
      docs: next.docs ?? prior.docs,
      comments: next.comments ?? prior.comments,
      // Keep the heading across refreshes: a recurring producer (scheduler, goal,
      // heartbeat, auto-close) sets a stable subject on the first push, so carry
      // it forward when a later occurrence omits it — else the subject would show
      // once then vanish on every coalesced refresh.
      subject: next.subject ?? prior.subject,
      // Same carry-forward for the author-set intent — a recurring producer sets
      // it once, so a later omitting occurrence keeps the original context.
      intent: next.intent ?? prior.intent,
      // Carry the report flag forward: once an entry is flagged a report it stays
      // one across coalesced refreshes (a later occurrence omitting the flag
      // shouldn't silently demote it out of the Reports surfaces).
      report: next.report ?? prior.report,
      sessionId: next.sessionId ?? prior.sessionId,
      // Refresh the resume target so a self-coalescing recurring row points at
      // the LATEST live session, not the first one that ever pushed under the key.
      origin: next.origin ?? prior.origin,
      scheduled: next.scheduled ?? prior.scheduled,
      notify: next.notify ?? prior.notify,
      ts: next.ts,
      occurrences: (prior.occurrences ?? 1) + 1
    };
    // Remove the old line and re-append the merged entry as the newest.
    const kept = lines.filter((_, i) => i !== matchIdx);
    kept.push(JSON.stringify(merged));
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, kept.join('\n') + '\n', 'utf-8');
    await rename(tmp, filePath);
    // Line count is unchanged (swap, not grow) — refresh the hint to be exact.
    if (lineCountHint !== null) lineCountHint = kept.length;
    emitter.emit('updated', merged);
    return merged;
  }

  async function append(input: InboxInput): Promise<InboxEntry> {
    // Validate OUTSIDE the mutex — pure, no shared state — so a bad input
    // rejects immediately without queueing behind in-flight file mutations.
    validateInput(input);
    const entry: InboxEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now()
    };
    return runExclusive(async () => {
      await mkdir(dirname(filePath), { recursive: true });

      // Coalescing path: a keyed push folds into its most-recent prior entry
      // (one self-refreshing row per recurring producer) instead of appending.
      // Falls through to a plain append when no prior entry shares the key.
      if (input.dedupeKey) {
        const merged = await coalesce(entry);
        if (merged) return merged;
      }

      await appendFile(filePath, JSON.stringify(entry) + '\n');
      // Emit before any compaction so a subscriber sees the new entry promptly;
      // trimming old history is housekeeping, not part of the append's contract.
      // Still inside the mutex, so no other mutation can interleave between this
      // write and a racing compaction's read-modify-write.
      emitter.emit('appended', entry);

      if (maxEntries > 0) {
        if (lineCountHint === null) lineCountHint = await countLines();
        else lineCountHint += 1;
        if (lineCountHint > compactThreshold) {
          try {
            lineCountHint = await compact();
          } catch {
            // Compaction is best-effort housekeeping — a failed trim must never
            // fail the append. Reset the hint so the next append re-measures.
            lineCountHint = null;
          }
        }
      }
      return entry;
    });
  }

  async function read(opts: InboxReadOpts = {}): Promise<{ entries: InboxEntry[]; hasMore: boolean }> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: [], hasMore: false };
      }
      throw err;
    }

    let all: InboxEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        all.push(JSON.parse(line) as InboxEntry);
      } catch {
        // A crash can tear an append mid-line. Preserve the readable history.
      }
    }

    if (opts.projectId) {
      all = all.filter((e) => e.projectId === opts.projectId);
    }

    let scoped = all;
    if (opts.before) {
      const idx = all.findIndex((e) => e.id === opts.before);
      scoped = idx >= 0 ? all.slice(0, idx) : [];
    }

    const limit = opts.limit ?? 100;
    const window = scoped.slice(-limit);
    const entries = [...window].reverse();
    const hasMore = window.length < scoped.length;
    return { entries, hasMore };
  }

  async function deleteEntry(id: string): Promise<boolean> {
    return runExclusive(async () => {
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf-8');
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return false;
        }
        throw err;
      }
      const lines = raw.split('\n').filter((l) => l.trim());
      let removed = false;
      const kept: string[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as InboxEntry;
          if (entry.id === id) {
            removed = true;
            continue;
          }
          kept.push(line);
        } catch {
          // Preserve unparseable lines so a malformed entry can't be used to
          // accidentally wipe the file via delete().
          kept.push(line);
        }
      }
      if (!removed) return false;

      // Atomic rewrite — tmp + rename. Crash mid-write leaves the previous
      // file intact instead of producing a half-truncated JSONL. Matches
      // the pattern in `src/main/store.ts`. Unique tmp suffix so a concurrent
      // rewrite in another process/instance can't collide on the tmp path.
      const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      const body = kept.length > 0 ? kept.join('\n') + '\n' : '';
      await writeFile(tmp, body, 'utf-8');
      await rename(tmp, filePath);
      // Keep the hint consistent so a later append doesn't over-count.
      if (lineCountHint !== null) lineCountHint = kept.length;
      emitter.emit('removed', id);
      return true;
    });
  }

  async function deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const remove = new Set(ids);
    return runExclusive(async () => {
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf-8');
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return 0;
        }
        throw err;
      }
      const lines = raw.split('\n').filter((l) => l.trim());
      const removedIds: string[] = [];
      const kept: string[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as InboxEntry;
          if (remove.has(entry.id)) {
            removedIds.push(entry.id);
            continue;
          }
          kept.push(line);
        } catch {
          // Preserve unparseable lines — a malformed entry can't be targeted.
          kept.push(line);
        }
      }
      if (removedIds.length === 0) return 0;

      const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      const body = kept.length > 0 ? kept.join('\n') + '\n' : '';
      await writeFile(tmp, body, 'utf-8');
      await rename(tmp, filePath);
      if (lineCountHint !== null) lineCountHint = kept.length;
      for (const id of removedIds) emitter.emit('removed', id);
      return removedIds.length;
    });
  }

  function onAppended(listener: (entry: InboxEntry) => void): () => void {
    emitter.on('appended', listener);
    return () => {
      emitter.off('appended', listener);
    };
  }

  function onRemoved(listener: (id: string) => void): () => void {
    emitter.on('removed', listener);
    return () => {
      emitter.off('removed', listener);
    };
  }

  function onUpdated(listener: (entry: InboxEntry) => void): () => void {
    emitter.on('updated', listener);
    return () => {
      emitter.off('updated', listener);
    };
  }

  function onPruned(listener: (removedIds: string[]) => void): () => void {
    emitter.on('pruned', listener);
    return () => {
      emitter.off('pruned', listener);
    };
  }

  return {
    append,
    read,
    delete: deleteEntry,
    deleteMany,
    onAppended,
    onRemoved,
    onUpdated,
    onPruned
  };
}

// ==================== In-memory store (tests) ====================

export function createMemoryInboxStore(): IInboxStore {
  const entries: InboxEntry[] = [];
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  async function append(input: InboxInput): Promise<InboxEntry> {
    validateInput(input);
    const entry: InboxEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now()
    };
    // Coalescing path mirrors the JSONL store: fold a keyed push into its
    // newest prior entry, moving it to the end (newest) of the array.
    if (input.dedupeKey) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.projectId === entry.projectId && e.dedupeKey && e.dedupeKey === entry.dedupeKey) {
          const merged: InboxEntry = {
            ...e,
            projectLabel: entry.projectLabel ?? e.projectLabel,
            docs: entry.docs ?? e.docs,
            comments: entry.comments ?? e.comments,
            // Carry the heading forward across refreshes — mirrors the JSONL
            // store's coalesce (see there for the rationale).
            subject: entry.subject ?? e.subject,
            intent: entry.intent ?? e.intent,
            report: entry.report ?? e.report,
            sessionId: entry.sessionId ?? e.sessionId,
            origin: entry.origin ?? e.origin,
            scheduled: entry.scheduled ?? e.scheduled,
            notify: entry.notify ?? e.notify,
            ts: entry.ts,
            occurrences: (e.occurrences ?? 1) + 1
          };
          entries.splice(i, 1);
          entries.push(merged);
          emitter.emit('updated', merged);
          return merged;
        }
      }
    }
    entries.push(entry);
    emitter.emit('appended', entry);
    return entry;
  }

  async function read(opts: InboxReadOpts = {}): Promise<{ entries: InboxEntry[]; hasMore: boolean }> {
    let scoped = opts.projectId ? entries.filter((e) => e.projectId === opts.projectId) : entries;
    if (opts.before) {
      const idx = scoped.findIndex((e) => e.id === opts.before);
      scoped = idx >= 0 ? scoped.slice(0, idx) : [];
    }
    const limit = opts.limit ?? 100;
    const window = scoped.slice(-limit);
    return { entries: [...window].reverse(), hasMore: window.length < scoped.length };
  }

  async function deleteEntry(id: string): Promise<boolean> {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    entries.splice(idx, 1);
    emitter.emit('removed', id);
    return true;
  }

  async function deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const remove = new Set(ids);
    const removedIds = entries.filter((e) => remove.has(e.id)).map((e) => e.id);
    if (removedIds.length === 0) return 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (remove.has(entries[i].id)) entries.splice(i, 1);
    }
    for (const id of removedIds) emitter.emit('removed', id);
    return removedIds.length;
  }

  function onAppended(listener: (entry: InboxEntry) => void): () => void {
    emitter.on('appended', listener);
    return () => {
      emitter.off('appended', listener);
    };
  }

  function onRemoved(listener: (id: string) => void): () => void {
    emitter.on('removed', listener);
    return () => {
      emitter.off('removed', listener);
    };
  }

  function onUpdated(listener: (entry: InboxEntry) => void): () => void {
    emitter.on('updated', listener);
    return () => {
      emitter.off('updated', listener);
    };
  }

  // The memory store has no retention, so 'pruned' never fires — but the
  // subscription must exist to satisfy IInboxStore.
  function onPruned(listener: (removedIds: string[]) => void): () => void {
    emitter.on('pruned', listener);
    return () => {
      emitter.off('pruned', listener);
    };
  }

  return {
    append,
    read,
    delete: deleteEntry,
    deleteMany,
    onAppended,
    onRemoved,
    onUpdated,
    onPruned
  };
}
