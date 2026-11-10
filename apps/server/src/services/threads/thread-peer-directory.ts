import {
  appendConversationThreadEvent,
  getConversationThread,
  listConversationThreadEventsWindow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { PEER_LIMIT, type ThreadPeer } from '../agents/peer-tool-contract.js';

export const PEER_REGISTERED_EVENT = 'peer/registered';
export const PEER_RECEIVED_EVENT = 'peer/message/received';
export const PEER_SENT_EVENT = 'peer/message/sent';
export const PEER_READ_EVENT = 'peer/inbox/read';

export function peerEvent<T>(db: ZccDatabase, threadId: string, type: string): T | undefined {
  return listConversationThreadEventsWindow(db, threadId, { type, limit: 1, maxBytes: 64_000 }).at(-1)?.payload as T | undefined;
}

/** Select bounded metadata first. No transcript or working directory is exposed. */
export function listThreadPeers(db: ZccDatabase, projectId?: string, sessionId?: string): ThreadPeer[] {
  const ids = db.sqlite.prepare(`SELECT t.id FROM threads t JOIN hosts h ON h.id = t.host_id
    WHERE t.archived_at IS NULL AND t.visibility = 'visible' AND t.status NOT IN ('stopping', 'error')
      AND h.destroyed_at IS NULL AND h.enrollment_capability = 'execution'
      ${projectId === undefined ? '' : 'AND t.project_id = ?'}
      ${sessionId === undefined ? '' : 'AND t.id = ?'}
    ORDER BY t.updated_at DESC, t.id LIMIT ?`).all(...(projectId === undefined ? [] : [projectId]),
      ...(sessionId === undefined ? [] : [sessionId]), PEER_LIMIT) as Array<{ id: string }>;
  return ids.map(({ id }) => {
    const thread = getConversationThread(db, id)!;
    const profile = peerEvent<{ handle: string; role?: string; capabilities?: string[] }>(db, id, PEER_REGISTERED_EVENT);
    return {
      sessionId: id,
      projectId: thread.projectId,
      kind: 'thread',
      displayName: thread.title?.trim() || id,
      status: thread.status,
      ...(profile ?? {})
    };
  });
}

export function writePeerEvent(db: ZccDatabase, threadId: string, type: string, payload: unknown): string {
  return db.transaction(() => {
    const event = appendConversationThreadEvent(db, { threadId, type, payload });
    const keep = type === PEER_RECEIVED_EVENT ? 200 : type === PEER_SENT_EVENT ? 30 : 1;
    // Retain bounded coordination metadata; the conversation keeps delivered prompts.
    // Delete only older entries so the event sequence tip is never removed.
    db.sqlite.prepare(`DELETE FROM thread_events WHERE id IN (
      SELECT id FROM thread_events WHERE thread_id = ? AND type = ? ORDER BY sequence DESC LIMIT 32 OFFSET ?
    )`).run(threadId, type, keep);
    return event.id;
  });
}
