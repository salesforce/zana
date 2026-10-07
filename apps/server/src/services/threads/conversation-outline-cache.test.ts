import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, type ZccDatabase } from '@zana-ai/zcc-db';
import { cachedConversationOutline, OUTLINE_CACHE_BYTES, OUTLINE_CACHE_ENTRIES } from './conversation-outline-cache.js';

const homes: string[] = [];
const databases: ZccDatabase[] = [];
function database(path?: string) {
  if (!path) { const home = mkdtempSync(join(tmpdir(), 'zcc-outline-cache-')); homes.push(home); path = join(home, 'db.sqlite'); }
  const db = openDatabase(path); databases.push(db); return { db, path };
}
afterEach(() => { databases.splice(0).forEach(db => db.close()); homes.splice(0).forEach(home => rmSync(home, { recursive: true, force: true })); });
const result = (preview = 'Hello') => ({ maxSeq: 2, items: [{ id: 'message', role: 'assistant' as const, preview, attachmentSummary: null }] });

it('reuses unchanged snapshots without sharing mutable responses', () => {
  const { db } = database(); const project = vi.fn(() => result());
  const first = cachedConversationOutline(db, 'thread', 'context', project);
  first.items[0]!.preview = 'changed by caller';
  const second = cachedConversationOutline(db, 'thread', 'context', project);
  expect(second.items[0]!.preview).toBe('Hello'); second.items.length = 0;
  expect(cachedConversationOutline(db, 'thread', 'context', project)).toEqual(result());
  expect(project).toHaveBeenCalledTimes(1);
});

it('invalidates on owned and external writes, including an interior deletion', () => {
  const { db, path } = database();
  db.sqlite.exec('CREATE TABLE fixture(value INTEGER)');
  db.sqlite.prepare('INSERT INTO fixture VALUES (?)').run(1);
  const project = vi.fn(() => result(String((db.sqlite.prepare('SELECT count(*) AS n FROM fixture').get() as { n: number }).n)));
  expect(cachedConversationOutline(db, 'thread', 'context', project).items[0]!.preview).toBe('1');
  db.sqlite.prepare('INSERT INTO fixture VALUES (?)').run(2);
  expect(cachedConversationOutline(db, 'thread', 'context', project).items[0]!.preview).toBe('2');
  const external = database(path).db;
  external.sqlite.exec('DELETE FROM fixture WHERE value = 1');
  expect(cachedConversationOutline(db, 'thread', 'context', project).items[0]!.preview).toBe('1');
  expect(project).toHaveBeenCalledTimes(3);
});

it('isolates databases, threads and changing projection context', () => {
  const first = database().db; const second = database().db;
  const project = vi.fn(() => result());
  cachedConversationOutline(first, 'thread', 'context', project);
  cachedConversationOutline(second, 'thread', 'context', project);
  cachedConversationOutline(first, 'other', 'context', project);
  cachedConversationOutline(first, 'thread', 'new provider policy', project);
  expect(project).toHaveBeenCalledTimes(4);
});

it('propagates projection failures and recovers without returning a stale snapshot', () => {
  const { db } = database();
  cachedConversationOutline(db, 'thread', 'context', () => result());
  expect(() => cachedConversationOutline(db, 'thread', 'changed', () => { throw new Error('projection failed'); })).toThrow('projection failed');
  expect(cachedConversationOutline(db, 'thread', 'changed', () => result('Recovered'))).toEqual(result('Recovered'));
});

it('evicts least recently used entries at the count limit', () => {
  const { db } = database(); const project = vi.fn(() => result());
  for (let index = 0; index < OUTLINE_CACHE_ENTRIES; index++) cachedConversationOutline(db, String(index), 'context', project);
  cachedConversationOutline(db, '0', 'context', project);
  cachedConversationOutline(db, 'extra', 'context', project);
  cachedConversationOutline(db, '0', 'context', project);
  expect(project).toHaveBeenCalledTimes(OUTLINE_CACHE_ENTRIES + 1);
  cachedConversationOutline(db, '1', 'context', project);
  expect(project).toHaveBeenCalledTimes(OUTLINE_CACHE_ENTRIES + 2);
});

it('bounds aggregate bytes and does not retain oversized replacements', () => {
  const { db } = database(); const project = vi.fn(() => result('x'.repeat(OUTLINE_CACHE_BYTES / 2)));
  cachedConversationOutline(db, 'a', 'context', project);
  cachedConversationOutline(db, 'b', 'context', project);
  cachedConversationOutline(db, 'a', 'context', project);
  expect(project).toHaveBeenCalledTimes(3);
  const huge = vi.fn(() => result('界'.repeat(OUTLINE_CACHE_BYTES)));
  cachedConversationOutline(db, 'a', 'large', huge);
  cachedConversationOutline(db, 'a', 'large', huge);
  expect(huge).toHaveBeenCalledTimes(2);
  cachedConversationOutline(db, 'small', 'context', () => result());
  expect(cachedConversationOutline(db, 'small', 'context', () => { throw Error('should reuse'); })).toEqual(result());
});
