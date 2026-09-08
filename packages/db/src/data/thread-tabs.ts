import type { ZccDatabase } from '../connection.js';

export interface ThreadTabsRow {
  threadId: string;
  revision: number;
  tabsJson: string;
  updatedAt: number;
}

export function getThreadTabs(db: ZccDatabase, threadId: string): ThreadTabsRow | null {
  const row = db.sqlite.prepare(
    'SELECT thread_id, revision, tabs_json, updated_at FROM thread_tabs WHERE thread_id = ?'
  ).get(threadId) as {
    thread_id: string;
    revision: number;
    tabs_json: string;
    updated_at: number;
  } | undefined;
  if (!row) return null;
  return {
    threadId: row.thread_id,
    revision: row.revision,
    tabsJson: row.tabs_json,
    updatedAt: row.updated_at
  };
}

export function replaceThreadTabs(
  db: ZccDatabase,
  input: { threadId: string; expectedRevision: number; tabsJson: string }
): ThreadTabsRow | 'conflict' {
  const now = Date.now();
  const current = getThreadTabs(db, input.threadId);
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== input.expectedRevision) return 'conflict';
  const nextRevision = currentRevision + 1;
  db.sqlite.prepare(
    `INSERT INTO thread_tabs (thread_id, revision, tabs_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       revision = excluded.revision,
       tabs_json = excluded.tabs_json,
       updated_at = excluded.updated_at`
  ).run(input.threadId, nextRevision, input.tabsJson, now);
  return {
    threadId: input.threadId,
    revision: nextRevision,
    tabsJson: input.tabsJson,
    updatedAt: now
  };
}
