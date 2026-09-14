import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PLUGIN_METADATA_MAX_BYTES } from '@zana-ai/zcc-domain/thread-runtime';
import {
  createConversationThread,
  createEnvironment,
  getThreadPluginMetadata,
  insertThreadPluginMetadata,
  listThreadPluginMetadataRows,
  openDatabase,
  patchThreadPluginMetadata,
  upsertHost,
  type ZccDatabase
} from '../index.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function seedThread(): { db: ZccDatabase; threadId: string; otherThreadId: string } {
  dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-meta-'));
  db = openDatabase(join(dir, 'zcc.sqlite'));
  const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(db, {
    projectId: 'proj-1',
    hostId: host.id,
    path: '/tmp/proj',
    workspaceProvisionType: 'unmanaged'
  });
  const thread = createConversationThread(db, {
    projectId: 'proj-1',
    hostId: host.id,
    environmentId: environment.id,
    providerId: 'claude-code'
  });
  const other = createConversationThread(db, {
    projectId: 'proj-1',
    hostId: host.id,
    environmentId: environment.id,
    providerId: 'claude-code',
    parentThreadId: thread.id,
    originKind: 'fork'
  });
  return { db, threadId: thread.id, otherThreadId: other.id };
}

describe('thread_plugin_metadata', () => {
  it('reads missing namespaces as empty and isolates forks', () => {
    const seeded = seedThread();
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes')).toEqual({
      metadata: {},
      corrupt: false
    });
    insertThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      metadata: { ticket: 'W-1' }
    });
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes').metadata).toEqual({
      ticket: 'W-1'
    });
    expect(getThreadPluginMetadata(seeded.db, seeded.otherThreadId, 'notes').metadata).toEqual({});
    expect(listThreadPluginMetadataRows(seeded.db, seeded.threadId, ['notes', 'other'])).toEqual([
      { pluginId: 'notes', metadataJson: '{"ticket":"W-1"}' }
    ]);
  });

  it('skips empty inserts, upserts patches, and deletes empty namespaces', () => {
    const seeded = seedThread();
    insertThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      metadata: {}
    });
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes').metadata).toEqual({});
    expect(patchThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      set: { a: 1, b: 2 },
      remove: []
    })).toEqual({ ok: true, metadata: { a: 1, b: 2 }, replacedCorrupt: false });
    expect(patchThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      set: { c: 3 },
      remove: ['b']
    })).toEqual({ ok: true, metadata: { a: 1, c: 3 }, replacedCorrupt: false });
    expect(patchThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      set: {},
      remove: ['a', 'c']
    })).toEqual({ ok: true, metadata: {}, replacedCorrupt: false });
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes')).toEqual({
      metadata: {},
      corrupt: false
    });
  });

  it('leaves the namespace unchanged when a merged patch would exceed 256 KiB', () => {
    const seeded = seedThread();
    patchThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      set: { keep: 'yes' },
      remove: []
    });
    const result = patchThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      set: { blob: 'x'.repeat(PLUGIN_METADATA_MAX_BYTES) },
      remove: []
    });
    expect(result).toEqual({ ok: false, reason: 'too_large' });
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes').metadata).toEqual({
      keep: 'yes'
    });
  });

  it('treats corrupt persisted JSON as empty without exposing contents', () => {
    const seeded = seedThread();
    seeded.db.sqlite.prepare(
      `INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json)
       VALUES (?, ?, ?)`
    ).run(seeded.threadId, 'notes', '{not-json');
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes')).toEqual({
      metadata: {},
      corrupt: true
    });
    const patched = patchThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      set: { recovered: true },
      remove: []
    });
    expect(patched).toEqual({
      ok: true,
      metadata: { recovered: true },
      replacedCorrupt: true
    });
  });

  it('cascades deletes with the parent thread', () => {
    const seeded = seedThread();
    insertThreadPluginMetadata(seeded.db, {
      threadId: seeded.threadId,
      pluginId: 'notes',
      metadata: { ticket: 'W-1' }
    });
    seeded.db.sqlite.prepare('DELETE FROM threads WHERE id = ?').run(seeded.threadId);
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes').metadata).toEqual({});
  });
});
