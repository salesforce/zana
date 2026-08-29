/**
 * SuggestionsStore — the Suggested Actions launcher's backing store (afl-03).
 *
 * A sibling of {@link ../inbox/inbox-store.ts}, NOT a feed category: it holds RUNNABLE
 * next actions an agent proposes for the operator ("here's a thing you could DO
 * next"), whereas the inbox holds questions/reports ("here's something to read /
 * answer"). Same durable JSONL shape — atomic tmp+rename, in-process mutex,
 * `(projectId, dedupeKey)` coalescing, single-tier retention — plus a read-time
 * EXPIRY filter (a stale suggestion is never surfaced) that the inbox lacks.
 *
 * Persistence: append-only JSONL at `~/.zcc/suggestions/entries.jsonl`.
 * `projectId` + `title` + a known-`kind` `action` are required. Every action
 * field is advisory — main re-authorizes each step at run time (Rule 1/2).
 */

import { randomUUID } from 'node:crypto';
import { readFile, appendFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { Suggestion, SuggestionInput, SuggestedActionKind } from '@zana-ai/zcc-domain/product';

export type { Suggestion, SuggestionInput } from '@zana-ai/zcc-domain/product';

export interface SuggestionsReadOpts {
  limit?: number;
  before?: string;
  projectId?: string;
}

export interface ISuggestionsStore {
  append(input: SuggestionInput): Promise<Suggestion>;
  read(opts?: SuggestionsReadOpts): Promise<{ entries: Suggestion[]; hasMore: boolean }>;
  delete(id: string): Promise<boolean>;
  deleteMany(ids: string[]): Promise<number>;
  onAppended(listener: (entry: Suggestion) => void): () => void;
  onRemoved(listener: (id: string) => void): () => void;
  onUpdated(listener: (entry: Suggestion) => void): () => void;
  onPruned(listener: (removedIds: string[]) => void): () => void;
}

/** Default on-disk JSONL path: `~/.zcc/suggestions/entries.jsonl`. */
export const DEFAULT_SUGGESTIONS_FILE = join(homedir(), '.zcc', 'suggestions', 'entries.jsonl');

/**
 * Single-tier retention cap: how many newest suggestions the JSONL keeps. Unlike
 * the inbox there's no quiet/protected split — suggestions are all peer runnable
 * actions and expire naturally, so one flat cap suffices. 500 is generous for a
 * launcher (they're consumed or dismissed, not archived).
 */
export const DEFAULT_MAX_SUGGESTIONS = 500;

/** The action kinds the store accepts; anything else is rejected at append. */
const KNOWN_ACTION_KINDS = new Set([
  'start-terminal',
  'start-agent',
  'open-view',
  'navigate',
  'combo'
]);

/**
 * Top-level kinds a STANDALONE suggestion may use — the payload-bearing ones.
 * `open-view`/`navigate` are combo-tail only (see `SuggestedActionKind` docs);
 * this is the store's defense-in-depth mirror of `sanitizeAction`'s depth-0 gate.
 */
const STANDALONE_KINDS = new Set(['start-terminal', 'start-agent', 'combo']);

// ==================== Validation ====================

function isKnownAction(action: unknown): action is SuggestedActionKind {
  if (!action || typeof action !== 'object') return false;
  const kind = (action as { kind?: unknown }).kind;
  return typeof kind === 'string' && KNOWN_ACTION_KINDS.has(kind);
}

function validateInput(input: SuggestionInput): void {
  if (!input.projectId) {
    throw new Error('SuggestionsStore.append: projectId is required');
  }
  if (!input.title || !input.title.trim()) {
    throw new Error('SuggestionsStore.append: title is required');
  }
  if (!input.reason || !input.reason.trim()) {
    throw new Error('SuggestionsStore.append: reason is required');
  }
  if (!isKnownAction(input.action)) {
    throw new Error('SuggestionsStore.append: action must have a known `kind`');
  }
  if (!STANDALONE_KINDS.has(input.action.kind)) {
    throw new Error(
      'SuggestionsStore.append: a standalone suggestion must be start-terminal, start-agent, or combo'
    );
  }
}

// ==================== JSONL store ====================

export interface SuggestionsStoreOptions {
  /** Override the JSONL file path (defaults to `~/.zcc/suggestions/entries.jsonl`). */
  filePath?: string;
  /** Retain at most this many newest entries. <= 0 disables retention. */
  maxEntries?: number;
  /** Clock for read-time expiry filtering. Defaults to Date.now. */
  clock?: () => number;
}

export function createSuggestionsStore(opts: SuggestionsStoreOptions = {}): ISuggestionsStore {
  const filePath = opts.filePath ?? DEFAULT_SUGGESTIONS_FILE;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_SUGGESTIONS;
  const clock = opts.clock ?? (() => Date.now());
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  // Amortize compaction: overshoot the cap by this slack, then trim in one pass.
  const compactionSlack = Math.max(1, Math.floor(maxEntries * 0.1));
  const compactThreshold = maxEntries + compactionSlack;
  let lineCountHint: number | null = null;

  // In-process mutex — every file-mutating critical section chains onto this so
  // they run strictly one-at-a-time (mirrors inbox-store). The tail is kept
  // resolved so one failed mutation can't wedge later ones.
  let tail: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
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
   * Single-tier retention: keep the newest `maxEntries` lines, re-emit survivors
   * in original file order (so read()'s newest-first reversal + coalesce's
   * last-match scan stay correct). Atomic (tmp + rename). Unparseable lines are
   * always kept. Returns the resulting live-line count for the hint.
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
    if (lines.length <= maxEntries) return lines.length;

    const keepIdx = new Set<number>();
    const evictedIds: string[] = [];
    let budget = maxEntries;
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: Suggestion | null = null;
      try {
        entry = JSON.parse(lines[i]) as Suggestion;
      } catch {
        keepIdx.add(i);
        continue;
      }
      if (budget > 0) {
        budget -= 1;
        keepIdx.add(i);
      } else {
        evictedIds.push(entry.id);
      }
    }
    if (keepIdx.size === lines.length) return lines.length;

    const kept = lines.filter((_, i) => keepIdx.has(i));
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, kept.join('\n') + '\n', 'utf-8');
    await rename(tmp, filePath);
    if (evictedIds.length > 0) emitter.emit('pruned', evictedIds);
    return kept.length;
  }

  /**
   * Coalescing read-modify-write — find the LAST on-disk entry matching
   * `(projectId, dedupeKey)`, fold `next` into it (same `id`, refreshed content,
   * `occurrences++`), move it to the end, rewrite atomically. Returns the merged
   * entry, or `null` if no prior entry shared the key. Runs only inside
   * {@link runExclusive}.
   */
  async function coalesce(next: Suggestion): Promise<Suggestion | null> {
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
    let matchIdx = -1;
    let prior: Suggestion | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]) as Suggestion;
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

    const merged: Suggestion = {
      ...prior,
      projectLabel: next.projectLabel ?? prior.projectLabel,
      title: next.title,
      reason: next.reason ?? prior.reason,
      detail: next.detail ?? prior.detail,
      action: next.action,
      sessionId: next.sessionId ?? prior.sessionId,
      origin: next.origin ?? prior.origin,
      expiresAt: next.expiresAt ?? prior.expiresAt,
      ts: next.ts,
      occurrences: (prior.occurrences ?? 1) + 1
    };
    const kept = lines.filter((_, i) => i !== matchIdx);
    kept.push(JSON.stringify(merged));
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, kept.join('\n') + '\n', 'utf-8');
    await rename(tmp, filePath);
    if (lineCountHint !== null) lineCountHint = kept.length;
    emitter.emit('updated', merged);
    return merged;
  }

  async function append(input: SuggestionInput): Promise<Suggestion> {
    validateInput(input);
    const entry: Suggestion = {
      ...input,
      id: randomUUID(),
      ts: Date.now()
    };
    return runExclusive(async () => {
      await mkdir(dirname(filePath), { recursive: true });

      if (input.dedupeKey) {
        const merged = await coalesce(entry);
        if (merged) return merged;
      }

      await appendFile(filePath, JSON.stringify(entry) + '\n');
      emitter.emit('appended', entry);

      if (maxEntries > 0) {
        if (lineCountHint === null) lineCountHint = await countLines();
        else lineCountHint += 1;
        if (lineCountHint > compactThreshold) {
          try {
            lineCountHint = await compact();
          } catch {
            lineCountHint = null;
          }
        }
      }
      return entry;
    });
  }

  async function read(opts: SuggestionsReadOpts = {}): Promise<{ entries: Suggestion[]; hasMore: boolean }> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: [], hasMore: false };
      }
      throw err;
    }

    let all: Suggestion[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        all.push(JSON.parse(line) as Suggestion);
      } catch {
        // A crash can tear an append mid-line. Preserve the readable history.
      }
    }

    // Read-time expiry filter — a stale suggestion is never surfaced.
    const now = clock();
    all = all.filter((e) => !e.expiresAt || e.expiresAt > now);

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
          const entry = JSON.parse(line) as Suggestion;
          if (entry.id === id) {
            removed = true;
            continue;
          }
          kept.push(line);
        } catch {
          kept.push(line);
        }
      }
      if (!removed) return false;

      const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      const body = kept.length > 0 ? kept.join('\n') + '\n' : '';
      await writeFile(tmp, body, 'utf-8');
      await rename(tmp, filePath);
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
          const entry = JSON.parse(line) as Suggestion;
          if (remove.has(entry.id)) {
            removedIds.push(entry.id);
            continue;
          }
          kept.push(line);
        } catch {
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

  function onAppended(listener: (entry: Suggestion) => void): () => void {
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

  function onUpdated(listener: (entry: Suggestion) => void): () => void {
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

export function createMemorySuggestionsStore(clock: () => number = () => Date.now()): ISuggestionsStore {
  const entries: Suggestion[] = [];
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  async function append(input: SuggestionInput): Promise<Suggestion> {
    validateInput(input);
    const entry: Suggestion = {
      ...input,
      id: randomUUID(),
      ts: Date.now()
    };
    if (input.dedupeKey) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.projectId === entry.projectId && e.dedupeKey && e.dedupeKey === entry.dedupeKey) {
          const merged: Suggestion = {
            ...e,
            projectLabel: entry.projectLabel ?? e.projectLabel,
            title: entry.title,
            reason: entry.reason ?? e.reason,
            detail: entry.detail ?? e.detail,
            action: entry.action,
            sessionId: entry.sessionId ?? e.sessionId,
            origin: entry.origin ?? e.origin,
            expiresAt: entry.expiresAt ?? e.expiresAt,
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

  async function read(opts: SuggestionsReadOpts = {}): Promise<{ entries: Suggestion[]; hasMore: boolean }> {
    const now = clock();
    let scoped = entries.filter((e) => !e.expiresAt || e.expiresAt > now);
    if (opts.projectId) scoped = scoped.filter((e) => e.projectId === opts.projectId);
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

  function onAppended(listener: (entry: Suggestion) => void): () => void {
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

  function onUpdated(listener: (entry: Suggestion) => void): () => void {
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
