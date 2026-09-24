import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import type { ConversationTranscript, OpenCodeSessionSummary } from '@zana-ai/zcc-domain/product';
import type { HarnessHistoryAdapter } from '@zcc/harness-sdk';

export function createOpenCodeHistory({ home }: { home: string }): HarnessHistoryAdapter {
  return {
    list: ({ projectPath, limit }) => listOpenCodeHistory(home, projectPath, limit),
    validateConversation: async ({ projectPath, id }) => !(await readOpenCodeHistory(home, projectPath, id)).unavailableReason,
    readTranscript: ({ projectPath, id }) => readOpenCodeHistory(home, projectPath, id)
  };
}

/** The provider's own durable index, opened read-only; no arbitrary database paths cross IPC. */
export async function listOpenCodeHistory(home: string, projectPath: string, limit: number): Promise<OpenCodeSessionSummary[]> {
  const cwd = await realpath(projectPath);
  let db;
  try {
    const path = join(home, '.local/share/opencode/opencode.db');
    await stat(path);
    db = createSqliteDatabase(path, { readonly: true, fileMustExist: true });
    return db.prepare(`SELECT id, title, time_created AS startedAt, time_updated AS lastActiveAt
      FROM session WHERE directory IN (?, ?) AND parent_id IS NULL
      ORDER BY time_updated DESC, id DESC LIMIT ?`).all(cwd, projectPath, Math.max(1, Math.min(limit, 10_000))) as OpenCodeSessionSummary[];
  } catch (error) {
    if (['ENOENT', 'SQLITE_CANTOPEN'].includes((error as { code?: string }).code ?? '')) return [];
    throw error;
  } finally { db?.close(); }
}

export async function readOpenCodeHistory(home: string, projectPath: string, id: string): Promise<ConversationTranscript> {
  let db;
  try {
    const cwd = await realpath(projectPath);
    db = createSqliteDatabase(join(home, '.local/share/opencode/opencode.db'), { readonly: true, fileMustExist: true });
    const session = db.prepare('SELECT directory FROM session WHERE id = ? AND parent_id IS NULL').get(id) as { directory: string } | undefined;
    if (!session || await realpath(session.directory) !== cwd) throw new Error('Unknown conversation');
    const rows = db.prepare(`SELECT m.id, json_extract(m.data, '$.role') AS role,
      substr(json_extract(p.data, '$.text'), 1, 64000) AS text,
      length(json_extract(p.data, '$.text')) AS length
      FROM message m JOIN part p ON p.message_id = m.id AND p.session_id = m.session_id
      WHERE m.session_id = ? AND json_extract(m.data, '$.role') IN ('user', 'assistant')
        AND json_extract(p.data, '$.type') = 'text'
      ORDER BY m.time_created, m.id, p.time_created, p.id LIMIT 501`).all(id) as Array<{ id: string; role: 'user' | 'assistant'; text: string; length: number }>;
    let total = 0;
    let truncated = rows.length > 500;
    const messages: ConversationTranscript['messages'] = [];
    for (const row of rows.slice(0, 500)) {
      if (!row.text) continue;
      if (total + row.text.length > 1_000_000) { truncated = true; break; }
      total += row.text.length;
      truncated ||= row.length > 64_000;
      messages.push({ role: row.role, text: row.text });
    }
    return { messages, truncated };
  } catch {
    return { messages: [], truncated: false, unavailableReason: 'The saved OpenCode transcript is unavailable or belongs to a different project.' };
  } finally { db?.close(); }
}
