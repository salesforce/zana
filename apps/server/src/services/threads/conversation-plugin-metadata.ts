import {
  getConversationThread,
  getThreadPluginMetadata,
  insertThreadPluginMetadata,
  patchThreadPluginMetadata,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { JsonObject } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';

function warnCorruptPluginMetadata(threadId: string, pluginId: string, replaced: boolean): void {
  const action = replaced ? 'Replaced' : 'Ignoring';
  console.warn(`${action} corrupt plugin metadata for thread ${threadId}, plugin ${pluginId}`);
}

export function persistConversationPluginMetadataSeed(
  db: ZccDatabase,
  threadId: string,
  input: { originPluginId?: string | null; pluginMetadata?: JsonObject }
): void {
  if (input.pluginMetadata === undefined) return;
  const pluginId = input.originPluginId?.trim() ?? '';
  if (!pluginId) {
    throw new ThreadCreateError(400, 'invalid-input', 'pluginMetadata requires originPluginId');
  }
  insertThreadPluginMetadata(db, {
    threadId,
    pluginId,
    metadata: input.pluginMetadata
  });
}

export function readConversationPluginMetadata(
  db: ZccDatabase,
  threadId: string,
  pluginId: string
): JsonObject {
  const thread = getConversationThread(db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const { metadata, corrupt } = getThreadPluginMetadata(db, threadId, pluginId);
  if (corrupt) warnCorruptPluginMetadata(threadId, pluginId, false);
  return metadata;
}

export function updateConversationPluginMetadata(
  db: ZccDatabase,
  input: { threadId: string; pluginId: string; set: JsonObject; remove: readonly string[] }
): JsonObject {
  const thread = getConversationThread(db, input.threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const result = patchThreadPluginMetadata(db, input);
  if (!result.ok) {
    throw new ThreadCreateError(413, 'invalid-input', 'pluginMetadata exceeds 256 KiB');
  }
  if (result.replacedCorrupt) warnCorruptPluginMetadata(input.threadId, input.pluginId, true);
  return result.metadata;
}
