import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import type { HarnessHistoryAdapter, HarnessHistoryConversation } from '@zcc/harness-sdk';
import { NATIVE_HISTORY_ID } from '../../native-conversation-index.js';
import { nativeDirectories, nativePath } from '../history-files.js';

/** Cursor CLI's metadata is readable; encrypted/protobuf blobs are deliberately not a preview. */
export function createCursorHistory({ home }: { home: string }): HarnessHistoryAdapter {
  const root = join(home, '.cursor', 'chats');
  const directory = (cwd: string) => join(root, createHash('md5').update(cwd).digest('hex'));
  async function metadata(projectPath: string, group: string, id: string) {
    if (!NATIVE_HISTORY_ID.test(id)) throw new Error('Invalid native id');
    const path = await nativePath(root, join(group, id, 'store.db'));
    const db = createSqliteDatabase(path, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = '0' AND length(value) <= 524288").get() as { value: string } | undefined;
      if (!row) throw new Error('Missing conversation metadata');
      const text = /^[a-f0-9]+$/i.test(row.value) ? Buffer.from(row.value, 'hex').toString('utf8') : row.value;
      const meta = JSON.parse(text);
      if (meta.agentId !== id) throw new Error('Conversation identity changed');
      const cwd = meta.cwd ?? meta.workspacePath;
      if (cwd !== undefined && (typeof cwd !== 'string' || await realpath(cwd) !== await realpath(projectPath))) throw new Error('Conversation belongs to another project');
      const info = await stat(path);
      return { id, title: String(meta.name || 'Untitled conversation').slice(0, 200), lastActiveAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : info.mtimeMs };
    } finally { db.close(); }
  }
  async function directories(projectPath: string) { return [...new Set([directory(await realpath(projectPath)), directory(projectPath)])]; }
  return {
    async list({ projectPath, limit, signal }) {
      const rows: HarnessHistoryConversation[] = [];
      for (const group of await directories(projectPath)) {
        for (const id of await nativeDirectories(root, group, signal)) {
          if (signal.aborted || rows.length >= 10_000) break;
          if (!NATIVE_HISTORY_ID.test(id)) continue;
          try { rows.push(await metadata(projectPath, group, id)); } catch { /* Skip corrupt or foreign sessions. */ }
        }
      }
      return rows.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)).slice(0, limit);
    },
    async validateConversation({ projectPath, id, signal }) {
      for (const group of await directories(projectPath)) {
        if (signal.aborted) return false;
        try { await metadata(projectPath, group, id); return true; } catch { /* Try the canonical/alias group. */ }
      }
      return false;
    }
  };
}
