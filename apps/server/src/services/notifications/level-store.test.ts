import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveConversationThread,
  createConversationThread,
  getThreadPluginMetadata,
  openDatabase,
  patchThreadPluginMetadata,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  NOTIFICATION_METADATA_OWNER,
  NotificationLimitError,
  createNotificationLevelStore
} from './level-store.js';

let db: ZccDatabase;
let dir: string;
let hostId: string;

function thread(parentThreadId?: string): string {
  return createConversationThread(db, { projectId: 'p', hostId, providerId: 'codex', parentThreadId }).id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notification-level-store-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('notification level store', () => {
  it('reports inherit until a level is set and removes the row again on inherit', () => {
    const store = createNotificationLevelStore(db);
    const id = thread();
    expect(store.getOwn(id)).toBe('inherit');
    store.setOwn(id, 'muted');
    expect(store.getOwn(id)).toBe('muted');
    expect(store.count()).toBe(1);
    store.setOwn(id, 'all');
    expect(store.getOwn(id)).toBe('all');
    expect(store.count()).toBe(1);
    store.setOwn(id, 'inherit');
    expect(store.getOwn(id)).toBe('inherit');
    expect(store.count()).toBe(0);
  });

  it('survives reopening the database', () => {
    const id = thread();
    createNotificationLevelStore(db).setOwn(id, 'input-only');
    db.close();
    db = openDatabase(join(dir, 'db.sqlite'));
    expect(createNotificationLevelStore(db).getOwn(id)).toBe('input-only');
  });

  it('returns only set levels for the requested ids and skips corrupt or unknown values', () => {
    const store = createNotificationLevelStore(db);
    const [a, b, c, d] = [thread(), thread(), thread(), thread()];
    store.setOwn(a, 'muted');
    store.setOwn(b, 'all');
    db.sqlite
      .prepare('INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json) VALUES (?, ?, ?)')
      .run(c, NOTIFICATION_METADATA_OWNER, '{not json');
    db.sqlite
      .prepare('INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json) VALUES (?, ?, ?)')
      .run(d, NOTIFICATION_METADATA_OWNER, JSON.stringify({ level: 'loud' }));
    expect(store.ownLevels([a, b, c, d, 'thr_missing'])).toEqual(
      new Map([
        [a, 'muted'],
        [b, 'all']
      ])
    );
    expect(store.getOwn(c)).toBe('inherit');
    expect(store.getOwn(d)).toBe('inherit');
    expect(store.ownLevels([])).toEqual(new Map());
  });

  it('batches large id lists', () => {
    const store = createNotificationLevelStore(db);
    const id = thread();
    store.setOwn(id, 'muted');
    const ids = [...Array.from({ length: 2000 }, (_, index) => `thr_other_${index}`), id];
    expect(store.ownLevels(ids).get(id)).toBe('muted');
  });

  it('removes the level when its thread is deleted', () => {
    const store = createNotificationLevelStore(db);
    const id = thread();
    store.setOwn(id, 'muted');
    db.sqlite.prepare('DELETE FROM threads WHERE id = ?').run(id);
    expect(store.count()).toBe(0);
    expect(store.getOwn(id)).toBe('inherit');
  });

  it('leaves other owners metadata on the same thread alone', () => {
    const store = createNotificationLevelStore(db);
    const id = thread();
    patchThreadPluginMetadata(db, { threadId: id, pluginId: 'acme', set: { keep: true }, remove: [] });
    store.setOwn(id, 'muted');
    store.setOwn(id, 'inherit');
    expect(getThreadPluginMetadata(db, id, 'acme').metadata).toEqual({ keep: true });
  });

  it('rejects an invalid level and an unknown thread', () => {
    const store = createNotificationLevelStore(db);
    const id = thread();
    // @ts-expect-error intentional bad input
    expect(() => store.setOwn(id, 'loud')).toThrow(/invalid notification level/);
    expect(() => store.setOwn('thr_missing', 'muted')).toThrow();
    expect(store.count()).toBe(0);
  });

  describe('retention cap', () => {
    it('refuses a new override beyond the cap but allows changing or clearing existing ones', () => {
      const store = createNotificationLevelStore(db, { maxOverrides: 2 });
      const [a, b, c] = [thread(), thread(), thread()];
      store.setOwn(a, 'muted');
      store.setOwn(b, 'all');
      expect(() => store.setOwn(c, 'muted')).toThrow(NotificationLimitError);
      expect(store.getOwn(c)).toBe('inherit');
      store.setOwn(a, 'input-only');
      expect(store.getOwn(a)).toBe('input-only');
      store.setOwn(b, 'inherit');
      store.setOwn(c, 'muted');
      expect(store.count()).toBe(2);
    });

    it('does not count an inherit write for a new thread against the cap', () => {
      const store = createNotificationLevelStore(db, { maxOverrides: 1 });
      const [a, b] = [thread(), thread()];
      store.setOwn(a, 'muted');
      expect(() => store.setOwn(b, 'inherit')).not.toThrow();
    });

    it('reclaims overrides of archived threads before refusing', () => {
      const store = createNotificationLevelStore(db, { maxOverrides: 2 });
      const [a, b, c] = [thread(), thread(), thread()];
      store.setOwn(a, 'muted');
      store.setOwn(b, 'muted');
      archiveConversationThread(db, a);
      store.setOwn(c, 'muted');
      expect(store.getOwn(a)).toBe('inherit');
      expect(store.getOwn(b)).toBe('muted');
      expect(store.getOwn(c)).toBe('muted');
      expect(store.count()).toBe(2);
    });

    it('keeps the override of an archived ancestor while a descendant is still in use', () => {
      const store = createNotificationLevelStore(db, { maxOverrides: 3 });
      const root = thread();
      const middle = thread(root);
      const leaf = thread(middle);
      const done = thread();
      store.setOwn(root, 'muted');
      store.setOwn(middle, 'input-only');
      store.setOwn(done, 'muted');
      for (const id of [root, middle, done]) archiveConversationThread(db, id);
      store.setOwn(leaf, 'all');
      expect(store.getOwn(root)).toBe('muted');
      expect(store.getOwn(middle)).toBe('input-only');
      expect(store.getOwn(done)).toBe('inherit');
      expect(store.getOwn(leaf)).toBe('all');
    });

    it('still refuses when every archived override caps a thread in use', () => {
      const store = createNotificationLevelStore(db, { maxOverrides: 1 });
      const root = thread();
      thread(root);
      store.setOwn(root, 'muted');
      archiveConversationThread(db, root);
      expect(() => store.setOwn(thread(), 'muted')).toThrow(NotificationLimitError);
      expect(store.getOwn(root)).toBe('muted');
    });
  });
});
