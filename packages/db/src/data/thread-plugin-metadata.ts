import type { JsonObject } from '@zana-ai/zcc-domain/thread-runtime';
import {
  exceedsPluginMetadataLimit,
  parsePersistedPluginMetadata
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ZccDatabase } from '../connection.js';

export interface ThreadPluginMetadataPatch {
  threadId: string;
  pluginId: string;
  set: JsonObject;
  remove: readonly string[];
}

export interface ThreadPluginMetadataRead {
  metadata: JsonObject;
  corrupt: boolean;
}

export type ThreadPluginMetadataPatchResult =
  | { ok: true; metadata: JsonObject; replacedCorrupt: boolean }
  | { ok: false; reason: 'too_large' };

export function getThreadPluginMetadata(
  db: ZccDatabase,
  threadId: string,
  pluginId: string
): ThreadPluginMetadataRead {
  const row = db.sqlite.prepare(
    'SELECT metadata_json FROM thread_plugin_metadata WHERE thread_id = ? AND plugin_id = ?'
  ).get(threadId, pluginId) as { metadata_json: string } | undefined;
  if (row === undefined) return { metadata: {}, corrupt: false };
  const metadata = parsePersistedPluginMetadata(row.metadata_json);
  return metadata === undefined
    ? { metadata: {}, corrupt: true }
    : { metadata, corrupt: false };
}

export function listThreadPluginMetadataRows(
  db: ZccDatabase,
  threadId: string,
  pluginIds: readonly string[]
): Array<{ pluginId: string; metadataJson: string }> {
  if (pluginIds.length === 0) return [];
  const placeholders = pluginIds.map(() => '?').join(', ');
  const rows = db.sqlite.prepare(
    `SELECT plugin_id, metadata_json FROM thread_plugin_metadata
      WHERE thread_id = ? AND plugin_id IN (${placeholders})`
  ).all(threadId, ...pluginIds) as Array<{ plugin_id: string; metadata_json: string }>;
  return rows.map((row) => ({ pluginId: row.plugin_id, metadataJson: row.metadata_json }));
}

export function insertThreadPluginMetadata(
  db: ZccDatabase,
  input: { threadId: string; pluginId: string; metadata: JsonObject }
): void {
  if (Object.keys(input.metadata).length === 0) return;
  db.sqlite.prepare(
    `INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json)
     VALUES (?, ?, ?)`
  ).run(input.threadId, input.pluginId, JSON.stringify(input.metadata));
}

export function patchThreadPluginMetadata(
  db: ZccDatabase,
  input: ThreadPluginMetadataPatch
): ThreadPluginMetadataPatchResult {
  return db.transaction(() => {
    const existing = getThreadPluginMetadata(db, input.threadId, input.pluginId);
    const metadata: JsonObject = { ...existing.metadata, ...input.set };
    for (const key of input.remove) delete metadata[key];
    if (Object.keys(metadata).length === 0) {
      db.sqlite.prepare(
        'DELETE FROM thread_plugin_metadata WHERE thread_id = ? AND plugin_id = ?'
      ).run(input.threadId, input.pluginId);
      return { ok: true, metadata, replacedCorrupt: existing.corrupt };
    }
    const metadataJson = JSON.stringify(metadata);
    if (exceedsPluginMetadataLimit(metadataJson)) {
      return { ok: false, reason: 'too_large' };
    }
    db.sqlite.prepare(
      `INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json)
       VALUES (?, ?, ?)
       ON CONFLICT(thread_id, plugin_id) DO UPDATE SET metadata_json = excluded.metadata_json`
    ).run(input.threadId, input.pluginId, metadataJson);
    return { ok: true, metadata, replacedCorrupt: existing.corrupt };
  });
}
