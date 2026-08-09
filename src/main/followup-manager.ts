import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { watch, existsSync, mkdirSync, type FSWatcher } from 'node:fs';
import type {
  FollowUp,
  FollowUpCreateInput,
  FollowUpOrigin,
  FollowUpResume,
  FollowUpStatus,
  FollowUpUpdateInput,
  IdleTriageResult,
  Project
} from '../shared/types.js';
import type { IInboxStore } from './inbox-store.js';
import {
  deleteFollowUp,
  globalDir,
  listAllFollowUps,
  projectDir,
  saveFollowUp
} from './followup-store.js';
import type { store as Store } from './store.js';

/**
 * Per-project retention cap on TERMINAL follow-ups (resolved/dismissed). Open
 * ones are never auto-evicted — they're the whole point. Bounds unbounded growth
 * (CLAUDE.md rule 5) so a long-lived project doesn't accumulate dead records.
 */
const MAX_TERMINAL_PER_PROJECT = 200;

/**
 * Normalize a title into a stable dedup token: lowercase, collapse whitespace,
 * strip trailing punctuation, cap length. So "Should I commit?" and
 * "should I commit" from the same session collapse to one record.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\s?!.,;:]+$/g, '')
    .slice(0, 120);
}

/** Cap on option choices — mirrors the store's bound; a scannable picker, not a survey. */
const MAX_OPTIONS = 20;

/** Trim / drop-empty / cap an option list; undefined when nothing usable remains. */
function normalizeOptions(options: string[] | undefined): string[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const cleaned = options
    .map((o) => (typeof o === 'string' ? o.trim() : ''))
    .filter((o) => o.length > 0)
    .slice(0, MAX_OPTIONS);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Host-derive the coalescing key from the (host-stamped) origin — NEVER agent
 * free-text (Rule 1). Session-scoped: the same task re-hitting the same wall.
 *  - idle-triage → one open record per session (any re-triage refreshes it).
 *  - agent → one per (session, normalized title) — a re-filed near-identical
 *    question collapses, but a genuinely different question is its own record.
 *  - user → undefined: a human filing twice deliberately means two records.
 */
function deriveDedupeKey(input: FollowUpCreateInput): string | undefined {
  const o = input.origin;
  if (o?.source === 'idle-triage') return `idle:${o.sessionId}`;
  if (o?.source === 'agent') return `agent:${o.sessionId}:${normalizeTitle(input.title)}`;
  return undefined;
}

/**
 * When coalescing a re-filed follow-up, keep the best resume coords: the fresh
 * origin's if it resolved any (the session is still live), else fall back to the
 * existing record's (parked earlier while the session was alive) so a re-file
 * after the tab died doesn't erase the reopen target. Only meaningful for
 * agent/idle-triage origins; a `user` origin has none.
 */
function mergeOriginResume(fresh: FollowUpOrigin, existing: FollowUpOrigin): FollowUpOrigin {
  if (fresh.source === 'user') return fresh;
  if (fresh.resume) return fresh;
  const prior = existing.source !== 'user' ? existing.resume : undefined;
  return prior ? { ...fresh, resume: prior } : fresh;
}

type Logger = (context: string, err: unknown) => void;

/** Minimal session metadata the manager needs to honour the idle-creation rules. */
export interface FollowUpSessionInfo {
  /** Background sessions (scheduled runs, team workers) never create follow-ups. */
  scheduled?: boolean;
  headless?: boolean;
}

type Deps = {
  store: typeof Store;
  inbox?: IInboxStore;
  logger?: Logger;
  /** Session metadata lookup; gates idle-driven creation. Null ⇒ session gone. */
  getSession?: (sessionId: string) => FollowUpSessionInfo | null;
  /** Map a pty session id to its owning project id (for idle-driven creation). */
  resolveProjectForSession?: (sessionId: string) => string | undefined;
  /**
   * Resolve the live pty's resume coordinates (claudeSessionId / profile /
   * personaId / cwd) for a session id, so an agent/idle-triage follow-up carries
   * a reopen target that survives its tab. Host-authoritative (Rule 1) — the
   * agent never supplies its own. Null ⇒ session gone / not resumable; the
   * follow-up is stamped without resume coords and answers degrade to a fresh
   * spawn. Twin of the inbox's `resolveOrigin`.
   */
  resolveResume?: (sessionId: string) => FollowUpResume | null;
  /** Is auto-creation from idle-triage enabled? Read live so a toggle takes effect at once. */
  followupsFromIdle?: () => boolean;
};

/**
 * Owns {@link FollowUp} records: create / update / status / delete, plus the
 * `awaiting-reply` idle-triage → follow-up bridge ({@link createFromIdle}).
 * Modelled on `GoalManager` minus the spawn/evaluate loop — a follow-up is inert
 * until a human (or the agent) acts on it.
 *
 * Lifetime contract matches the scheduler / goals: lives only while the Electron
 * main process is alive. On boot, {@link loadAll} re-reads from disk.
 */
export class FollowUpManager extends EventEmitter {
  private items = new Map<string, FollowUp>();
  private deps: Deps | null = null;

  private watchers = new Map<string, FSWatcher>();
  private watchDebounce: NodeJS.Timeout | null = null;
  private suppressWatchUntil = 0;

  setDeps(deps: Deps) {
    this.deps = deps;
  }

  private log(context: string, err: unknown) {
    if (this.deps?.logger) this.deps.logger(context, err);
    // eslint-disable-next-line no-console
    else console.error(`[followups] ${context}:`, err);
  }

  list(): FollowUp[] {
    return [...this.items.values()];
  }

  /** Read every follow-up from disk. Called on boot and after external edits. */
  loadAll(projects: Project[]) {
    this.items.clear();
    const all = listAllFollowUps(projects, (path, reason) =>
      this.log(`load ${path}`, `invalid follow-up file dropped: ${reason}`)
    );
    for (const f of all) this.items.set(f.id, f);
    this.emit('changed');
  }

  create(input: FollowUpCreateInput): FollowUp {
    if (!input.title?.trim()) throw new Error('title is required');
    if (!input.projectId) throw new Error('projectId is required');
    const now = new Date().toISOString();
    const origin = this.stampResume(input.origin ?? { source: 'user' });

    // Coalesce onto an existing OPEN follow-up sharing the host-derived key
    // (agent re-filing the same question, or a steady idle agent re-triaged
    // across spells) rather than piling up duplicates — the durable twin of the
    // inbox dedupeKey idiom. User-created follow-ups get no key (never collapse).
    const dedupeKey = deriveDedupeKey(input);
    if (dedupeKey) {
      const existing = this.findOpenByKey(input.projectId, dedupeKey);
      if (existing) return this.coalesce(existing, input, dedupeKey, origin, now);
    }

    const followUp: FollowUp = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title.trim(),
      detail: input.detail?.trim() || undefined,
      options: normalizeOptions(input.options),
      kind: input.kind ?? 'question',
      status: 'open',
      origin,
      sessionId: input.sessionId ?? (origin.source !== 'user' ? origin.sessionId : undefined),
      createdAt: now,
      updatedAt: now,
      dedupeKey,
      source: input.scope ?? 'global'
    };
    this.persist(followUp);
    this.items.set(followUp.id, followUp);
    this.evictTerminal(followUp.projectId);
    this.emit('changed');
    return followUp;
  }

  /**
   * Host-stamp the originating agent's resume coordinates onto an agent /
   * idle-triage origin, resolved from the LIVE pty (Rule 1 — never agent input).
   * Fills `resume` only when the dep resolves non-null coords; a `user` origin
   * (no session) or a dead/unknown session is left as-is (answers degrade to a
   * fresh spawn). Called once at create time — the coords are frozen at parking,
   * mirroring how the inbox snapshots `origin` at push time.
   */
  private stampResume(origin: FollowUpOrigin): FollowUpOrigin {
    if (origin.source === 'user') return origin;
    if (origin.resume) return origin; // caller already resolved (e.g. re-file)
    const resume = this.deps?.resolveResume?.(origin.sessionId) ?? undefined;
    return resume ? { ...origin, resume } : origin;
  }

  /** The open follow-up in a project carrying `dedupeKey`, if one exists. */
  private findOpenByKey(projectId: string, dedupeKey: string): FollowUp | undefined {
    for (const f of this.items.values()) {
      if (f.status === 'open' && f.projectId === projectId && f.dedupeKey === dedupeKey) return f;
    }
    return undefined;
  }

  /**
   * Refresh an existing open follow-up in place instead of minting a duplicate:
   * bump the title to the latest phrasing, fill detail ONLY if the record has
   * none (never clobber a human-edited body), refresh the host-stamped origin,
   * and increment the `occurrences` counter that drives the `×N` chip.
   */
  private coalesce(
    existing: FollowUp,
    input: FollowUpCreateInput,
    dedupeKey: string,
    origin: FollowUp['origin'],
    now: string
  ): FollowUp {
    const detail = input.detail?.trim() || undefined;
    // Refresh the origin, but never DROP a resume target: if the session died
    // between the first parking and this re-file, `origin` has no coords while
    // `existing.origin` still does — keep the older-but-valid ones so the answer
    // loop can still resume. (A live re-file supplies fresh coords that win.)
    const mergedOrigin = mergeOriginResume(origin, existing.origin);
    const next: FollowUp = {
      ...existing,
      title: input.title.trim(),
      detail: existing.detail ?? detail,
      // Fill options only if the record has none (never clobber the original form).
      options: existing.options ?? normalizeOptions(input.options),
      origin: mergedOrigin,
      sessionId: existing.sessionId ?? input.sessionId ?? (origin.source !== 'user' ? origin.sessionId : undefined),
      dedupeKey,
      occurrences: (existing.occurrences ?? 1) + 1,
      updatedAt: now
    };
    this.persist(next);
    this.items.set(next.id, next);
    this.emit('changed');
    return next;
  }

  update(id: string, patch: FollowUpUpdateInput): FollowUp {
    const cur = this.items.get(id);
    if (!cur) throw new Error(`follow-up not found: ${id}`);
    const next: FollowUp = { ...cur };
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.detail !== undefined) next.detail = patch.detail.trim() || undefined;
    if (patch.kind !== undefined) next.kind = patch.kind;
    next.updatedAt = new Date().toISOString();
    this.persist(next);
    this.items.set(id, next);
    this.emit('changed');
    return next;
  }

  /**
   * Move a follow-up between `open` / `resolved` / `dismissed`. Leaving `open`
   * stamps `resolvedAt` and records an optional resolution note; reopening clears
   * both. Returns null if the id is unknown.
   */
  setStatus(id: string, status: FollowUpStatus, resolution?: string): FollowUp | null {
    const cur = this.items.get(id);
    if (!cur) return null;
    const now = new Date().toISOString();
    const next: FollowUp = { ...cur, status, updatedAt: now };
    if (status === 'open') {
      next.resolvedAt = undefined;
      next.resolution = undefined;
    } else {
      next.resolvedAt = now;
      // Drop the spawn lock on a terminal record so a later reopen can't briefly
      // re-show a stale "in progress" countdown from a long-past spawn.
      next.spawnedAt = undefined;
      if (resolution !== undefined) next.resolution = resolution.trim() || undefined;
    }
    this.persist(next);
    this.items.set(id, next);
    this.evictTerminal(next.projectId);
    this.emit('changed');
    return next;
  }

  /**
   * Stamp `spawnedAt = now`, marking the follow-up "work in progress". The UI
   * derives a short spawn-lock from this (see `FOLLOWUP_SPAWN_LOCK_MS`) so a
   * second agent can't be launched against the same follow-up within the window.
   * Only meaningful for open records; returns null if the id is unknown.
   */
  markSpawned(id: string): FollowUp | null {
    const cur = this.items.get(id);
    if (!cur) return null;
    const now = new Date().toISOString();
    const next: FollowUp = { ...cur, spawnedAt: now, updatedAt: now };
    this.persist(next);
    this.items.set(id, next);
    this.emit('changed');
    return next;
  }

  remove(id: string) {
    if (!this.items.has(id)) return;
    this.items.delete(id);
    if (this.deps) {
      this.suppressWatchUntil = Date.now() + 1_000;
      deleteFollowUp(id, this.deps.store.listProjects());
    }
    this.emit('changed');
  }

  onProjectRemoved(projectId: string) {
    let dropped = 0;
    for (const [id, f] of [...this.items]) {
      if (f.projectId === projectId) {
        this.items.delete(id);
        dropped += 1;
      }
    }
    if (dropped > 0) this.emit('changed');
  }

  // ----- idle-triage bridge ---------------------------------------------------

  /**
   * Turn an `awaiting-reply` idle-triage verdict into a durable follow-up. The
   * headline feature: the live "Needs you" badge is ephemeral (gone on kill /
   * restart); this record persists the parked question.
   *
   * Dedups on `(sessionId, kind='question')` and `status==='open'` so a steady
   * idle agent re-triaged across spells yields ONE open follow-up, refreshed in
   * place (title + confidence) rather than a pile of duplicates — mirroring the
   * inbox `dedupeKey` idiom. Self-gates on the config flag and skips background
   * sessions (they must never request attention — same rule idle-triage enforces).
   *
   * Returns the created/updated record, or null when gated out / not applicable.
   */
  createFromIdle(result: IdleTriageResult): FollowUp | null {
    if (result.resolution !== 'awaiting-reply') return null;
    if (this.deps?.followupsFromIdle && !this.deps.followupsFromIdle()) return null;
    const session = this.deps?.getSession?.(result.sessionId);
    // Unknown session ⇒ can't attribute to a project; background ⇒ never surface.
    if (!session || session.scheduled || session.headless) return null;

    const projectId = this.projectForSession(result.sessionId);
    if (!projectId) return null;

    // Coalescing is handled centrally by `create()` via the host-derived
    // `idle:<sessionId>` dedupeKey — a steady idle agent re-triaged across spells
    // refreshes ONE open follow-up rather than piling up duplicates.
    return this.create({
      projectId,
      title: result.summary?.trim() || 'Agent is waiting on you',
      detail: result.detail?.trim() || undefined,
      // Concrete choices the agent offered (host-capped in parseTriage) so an
      // awaiting-reply verdict shows the lettered picker. `create()` runs
      // `normalizeOptions` and `coalesce` only fills options when the record has
      // none — so this never clobbers options on an already-open follow-up.
      options: result.options,
      kind: 'question',
      origin: { source: 'idle-triage', sessionId: result.sessionId, confidence: result.confidence },
      sessionId: result.sessionId,
      scope: { projectId }
    });
  }

  private projectForSession(sessionId: string): string | undefined {
    return this.deps?.resolveProjectForSession?.(sessionId);
  }

  // ----- fs watching (external edits go live without restart) -----------------

  startWatching() {
    this.rebindWatchers();
  }

  rebindWatchers() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
    this.watchers.clear();
    const dirs = [globalDir()];
    if (this.deps) for (const p of this.deps.store.listProjects()) dirs.push(projectDir(p));
    for (const dir of dirs) this.attachWatcher(dir);
  }

  stopWatching() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
    this.watchers.clear();
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
  }

  private attachWatcher(dir: string) {
    if (this.watchers.has(dir)) return;
    try {
      if (!existsSync(dir)) {
        if (dir === globalDir()) mkdirSync(dir, { recursive: true });
        else return;
      }
      const w = watch(dir, { persistent: false }, () => this.scheduleReload());
      w.on('error', (err) => {
        this.log(`watch ${dir}`, err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.watchers.get(dir) === w) this.watchers.delete(dir);
      });
      this.watchers.set(dir, w);
    } catch (err) {
      this.log(`watch ${dir}`, err);
    }
  }

  private scheduleReload() {
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.watchDebounce = setTimeout(() => {
      this.watchDebounce = null;
      if (Date.now() < this.suppressWatchUntil) return;
      if (!this.deps) return;
      this.loadAll(this.deps.store.listProjects());
    }, 250);
  }

  // ----- helpers --------------------------------------------------------------

  private persist(followUp: FollowUp) {
    if (!this.deps) return;
    this.suppressWatchUntil = Date.now() + 1_000;
    saveFollowUp(followUp, this.deps.store.listProjects());
  }

  /**
   * Drop the oldest terminal (resolved/dismissed) records for a project beyond
   * the retention cap. Open records are never evicted. Deletes from disk + map.
   */
  private evictTerminal(projectId: string) {
    const terminal = [...this.items.values()]
      .filter((f) => f.projectId === projectId && f.status !== 'open')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (terminal.length <= MAX_TERMINAL_PER_PROJECT) return;
    for (const stale of terminal.slice(MAX_TERMINAL_PER_PROJECT)) {
      this.items.delete(stale.id);
      if (this.deps) {
        this.suppressWatchUntil = Date.now() + 1_000;
        deleteFollowUp(stale.id, this.deps.store.listProjects());
      }
    }
  }
}
