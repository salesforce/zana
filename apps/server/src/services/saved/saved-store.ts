/**
 * SavedStore — durable, reusable copies of inbox reports.
 *
 * Where the inbox is an ephemeral push feed (append-only JSONL, docs are live
 * pointers), a *saved* report is a frozen snapshot the user explicitly keeps:
 * the comments plus a copy of each doc's content captured at save time, so it
 * stays usable even after the project's files change, move, or the project is
 * deleted.
 *
 * Persistence mirrors the scheduler store: one pretty-printed JSON file per
 * record at `~/.zcc/saved/<id>.json`, written atomically (tmp + rename).
 * Reads tolerate hand-edits and partial files (skip unparseable, never throw).
 * Change notifications use the full-list pattern (like scheduler/skill-bundles)
 * since the saved list is small and low-churn — the renderer replaces wholesale.
 *
 * GLOBAL only: there is no project-local saved dir. Each record carries
 * `projectId` so the UI and the bundled `saved-reports` skill can filter.
 */

import { randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { SavedRecord, SavedRecordInput } from '@zana-ai/zcc-domain/product';

export type { SavedRecord, SavedRecordInput } from '@zana-ai/zcc-domain/product';

/** Default directory: `~/.zcc/saved/`. One file per record `<id>.json`. */
export const DEFAULT_SAVED_DIR = join(homedir(), '.zcc', 'saved');

export interface ISavedStore {
  /** Persist a new record (assigns id + savedAt). Emits 'changed'. */
  save(input: SavedRecordInput): Promise<SavedRecord>;
  /** All records, newest-first by savedAt. [] if the dir doesn't exist. */
  list(): Promise<SavedRecord[]>;
  /** Hard-delete by id. Returns true if removed, false if no file matched. */
  delete(id: string): Promise<boolean>;
  /** Subscribe to full-list changes (save/delete). Returns a dispose fn. */
  onChanged(listener: (records: SavedRecord[]) => void): () => void;
}

// ==================== Validation ====================

function validateInput(input: SavedRecordInput): void {
  if (!input.projectId) {
    throw new Error('SavedStore.save: projectId is required');
  }
  if (!input.title || !input.title.trim()) {
    throw new Error('SavedStore.save: title is required');
  }
  const hasDocs = (input.docs?.length ?? 0) > 0;
  const hasComments = (input.comments ?? '').trim().length > 0;
  if (!hasDocs && !hasComments) {
    throw new Error('SavedStore.save: at least one of docs or comments must be present');
  }
}

// ==================== File-backed store ====================

export interface SavedStoreOptions {
  /** Override the directory (defaults to `~/.zcc/saved`). */
  dir?: string;
}

export function createSavedStore(opts: SavedStoreOptions = {}): ISavedStore {
  const dir = opts.dir ?? DEFAULT_SAVED_DIR;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  function fileFor(id: string): string {
    return join(dir, `${id}.json`);
  }

  async function list(): Promise<SavedRecord[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    const records: SavedRecord[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, name), 'utf-8');
        const rec = JSON.parse(raw) as SavedRecord;
        // Defensive: skip files missing the required shape rather than throw.
        if (rec && typeof rec.id === 'string' && typeof rec.savedAt === 'number') {
          records.push(rec);
        }
      } catch {
        // Unparseable / partial file — skip it, don't let one bad file nuke list().
      }
    }
    records.sort((a, b) => b.savedAt - a.savedAt);
    return records;
  }

  async function emitChanged(): Promise<void> {
    emitter.emit('changed', await list());
  }

  async function save(input: SavedRecordInput): Promise<SavedRecord> {
    validateInput(input);
    const record: SavedRecord = {
      ...input,
      id: randomUUID(),
      savedAt: Date.now()
    };
    await mkdir(dir, { recursive: true });
    const file = fileFor(record.id);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf-8');
    await rename(tmp, file);
    await emitChanged();
    return record;
  }

  async function deleteRecord(id: string): Promise<boolean> {
    try {
      await unlink(fileFor(id));
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
    await emitChanged();
    return true;
  }

  function onChanged(listener: (records: SavedRecord[]) => void): () => void {
    emitter.on('changed', listener);
    return () => {
      emitter.off('changed', listener);
    };
  }

  return { save, list, delete: deleteRecord, onChanged };
}

// ==================== In-memory store (tests) ====================

export function createMemorySavedStore(): ISavedStore {
  const records: SavedRecord[] = [];
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  function snapshot(): SavedRecord[] {
    return [...records].sort((a, b) => b.savedAt - a.savedAt);
  }

  async function save(input: SavedRecordInput): Promise<SavedRecord> {
    validateInput(input);
    const record: SavedRecord = { ...input, id: randomUUID(), savedAt: Date.now() };
    records.push(record);
    emitter.emit('changed', snapshot());
    return record;
  }

  async function list(): Promise<SavedRecord[]> {
    return snapshot();
  }

  async function deleteRecord(id: string): Promise<boolean> {
    const idx = records.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    records.splice(idx, 1);
    emitter.emit('changed', snapshot());
    return true;
  }

  function onChanged(listener: (records: SavedRecord[]) => void): () => void {
    emitter.on('changed', listener);
    return () => {
      emitter.off('changed', listener);
    };
  }

  return { save, list, delete: deleteRecord, onChanged };
}
