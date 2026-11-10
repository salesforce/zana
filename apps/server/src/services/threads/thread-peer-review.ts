import { randomUUID } from 'node:crypto';
import { getConversationThread, isThreadQueueAutoSendPaused, listDeferredThreadMessages, deleteDeferredThreadMessage } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { PeerCaller, ThreadPeer } from '../agents/peer-tool-contract.js';
import { deferConversationSend } from './conversation-deferred-messages.js';
import { conversationThreadView } from './conversation-thread-view.js';
import { PEER_RECEIVED_EVENT, writePeerEvent } from './thread-peer-directory.js';

export interface PeerReview {
  id: string; ownerThreadId: string; projectId: string; sender: PeerCaller; recipient: ThreadPeer;
  body: string; transport: string; status: 'pending' | 'approved' | 'delivered' | 'discarded';
  revision: number; configGeneration: number | null; createdAt: number; updatedAt: number;
}
type SqlRow = { id: string; owner_thread_id: string; project_id: string; sender: string; recipient: string;
  body: string; transport: string; status: PeerReview['status']; revision: number; config_generation: number | null; created_at: number; updated_at: number };
const decode = (r: SqlRow): PeerReview => ({ id: r.id, ownerThreadId: r.owner_thread_id, projectId: r.project_id,
  sender: JSON.parse(r.sender), recipient: JSON.parse(r.recipient), body: r.body, transport: r.transport,
  status: r.status, revision: r.revision, configGeneration: r.config_generation, createdAt: r.created_at, updatedAt: r.updated_at });
const failure = (message: string) => new ThreadCreateError(409, 'peer_review_required', message);
function deferredReviewId(payload: string): string | undefined {
  try { return JSON.parse(payload)?.peerReviewId; } catch { return undefined; }
}
export function peerCommunicationEnabled(ctx: ProductHttpContext): boolean {
  return ctx.config.getConfig().threadCommunicationEnabled !== false;
}
export function requirePeerCommunication(ctx: ProductHttpContext): void {
  if (!peerCommunicationEnabled(ctx)) throw failure('Thread communication is disabled in Experimental settings.');
}
export function getPeerReview(ctx: ProductHttpContext, id: string): PeerReview | null {
  const row = ctx.db.sqlite.prepare('SELECT * FROM peer_review_messages WHERE id = ?').get(id) as SqlRow | undefined;
  return row ? decode(row) : null;
}
function publish(ctx: ProductHttpContext, threadId: string): void {
  const thread = getConversationThread(ctx.db, threadId);
  if (thread) {
    try { ctx.hub.emit('threads:updated', conversationThreadView(ctx, thread)); }
    catch { /* A committed decision must survive a disconnected UI. */ }
  }
}
export function createPeerReview(ctx: ProductHttpContext, sender: PeerCaller, recipient: ThreadPeer, body: string, transport: string, id = `peer_${randomUUID()}`): PeerReview {
  const owner = recipient.kind === 'thread' ? recipient.sessionId : sender.sessionId;
  return ctx.db.transaction(() => {
    const existing = getPeerReview(ctx, id);
    if (existing) return existing;
    const count = ctx.db.sqlite.prepare("SELECT COUNT(*) AS n FROM peer_review_messages WHERE owner_thread_id = ? AND status IN ('pending','approved')").get(owner) as { n: number };
    if (count.n >= 50) throw failure('Too many peer messages are awaiting review.');
    // Terminal history is bounded independently of unresolved messages.
    ctx.db.sqlite.prepare(`DELETE FROM peer_review_messages WHERE id IN (SELECT id FROM peer_review_messages
      WHERE owner_thread_id = ? AND status IN ('delivered','discarded') ORDER BY created_at DESC LIMIT 32 OFFSET 150)`).run(owner);
    const now = Date.now();
    ctx.db.sqlite.prepare(`INSERT INTO peer_review_messages (id, owner_thread_id, project_id, sender, recipient, body, transport, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(id, owner, sender.projectId, JSON.stringify(sender), JSON.stringify(recipient), body, transport, now, now);
    return getPeerReview(ctx, id)!;
  });
}
export function notifyPeerReview(ctx: ProductHttpContext, item: PeerReview): void { publish(ctx, item.ownerThreadId); }

/** Old bridge queues carry no user consent. Move them out of the normal queue before any drain. */
export function quarantineLegacyPeerMessages(ctx: ProductHttpContext, threadId: string): void {
  ctx.db.transaction(() => {
    let available: number | undefined;
    for (const row of listDeferredThreadMessages(ctx.db, threadId)) {
      let p: { senderThreadId?: string; peerReviewId?: string; input?: unknown };
      try { p = JSON.parse(row.payload); } catch { continue; }
      if (!p.senderThreadId || p.peerReviewId) continue;
      available ??= 50 - (ctx.db.sqlite.prepare("SELECT COUNT(*) AS n FROM peer_review_messages WHERE owner_thread_id = ? AND status IN ('pending','approved')").get(threadId) as { n: number }).n;
      const id = `peer_legacy_${row.id}`;
      const existing = getPeerReview(ctx, id);
      // Keep the current reviews accessible so the user can free capacity.
      // Unmigrated legacy rows still fail the dispatch approval check.
      if (!existing && available <= 0) continue;
      const thread = getConversationThread(ctx.db, threadId)!;
      const source = getConversationThread(ctx.db, p.senderThreadId);
      const transport = typeof p.input === 'string' ? p.input : JSON.stringify(p.input ?? '');
      createPeerReview(ctx, { sessionId: p.senderThreadId, projectId: source?.projectId ?? thread.projectId,
        displayName: source?.title ?? p.senderThreadId, kind: source ? 'thread' : 'cli-agent' },
      { sessionId: thread.id, projectId: thread.projectId, displayName: thread.title ?? thread.id, kind: 'thread', status: thread.status },
      transport.replace(/^\[zcc message[^\n]*\]\nPeer: [^\n]*\n/u, '').slice(0, 12_000), transport, id);
      if (!existing) available--;
      deleteDeferredThreadMessage(ctx.db, { id: row.id, threadId });
    }
  });
}
export function listPeerReviews(ctx: ProductHttpContext, threadId: string): PeerReview[] {
  quarantineLegacyPeerMessages(ctx, threadId);
  const generation = ctx.config.getConfig().threadCommunicationGeneration ?? 0;
  // Toggling off/on invalidates approvals even if no drain happened while off.
  ctx.db.sqlite.prepare(`UPDATE peer_review_messages SET status = 'pending', revision = revision + 1, updated_at = ?
    WHERE owner_thread_id = ? AND status = 'approved' AND (config_generation <> ? OR ? = 0)`).run(Date.now(), threadId, generation, peerCommunicationEnabled(ctx) ? 1 : 0);
  return (ctx.db.sqlite.prepare("SELECT * FROM peer_review_messages WHERE owner_thread_id = ? AND status IN ('pending','approved') ORDER BY created_at, rowid LIMIT 50").all(threadId) as SqlRow[]).map(decode);
}
export function assertPeerDispatch(ctx: ProductHttpContext, threadId: string, senderId: string, reviewId: string | undefined, input?: unknown): PeerReview {
  const item = reviewId ? getPeerReview(ctx, reviewId) : null;
  const thread = getConversationThread(ctx.db, threadId);
  const source = item?.sender.kind === 'thread' ? getConversationThread(ctx.db, item.sender.sessionId) : null;
  if (!item || item.status !== 'approved' || item.recipient.sessionId !== threadId || item.recipient.kind !== 'thread'
    || item.sender.sessionId !== senderId || !thread || thread.projectId !== item.projectId
    || thread.archivedAt !== null || thread.visibility !== 'visible'
    || item.recipient.projectId !== item.projectId || (source && source.projectId !== item.projectId)
    || (item.sender.kind === 'thread' && (!source || source.archivedAt !== null || source.visibility !== 'visible'))
    || (input !== undefined && input !== item.transport)) {
    if (item?.status === 'approved') ctx.db.sqlite.prepare("UPDATE peer_review_messages SET status = 'pending', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'approved'").run(Date.now(), item.id);
    throw failure('This peer message requires review before delivery.');
  }
  if (!peerCommunicationEnabled(ctx) || item.configGeneration !== (ctx.config.getConfig().threadCommunicationGeneration ?? 0)
    || isThreadQueueAutoSendPaused(ctx.db, threadId)) {
    ctx.db.sqlite.prepare("UPDATE peer_review_messages SET status = 'pending', revision = revision + 1 WHERE id = ? AND status = 'approved'").run(item.id);
    throw failure('Peer delivery was paused. Review this message again.');
  }
  return item;
}
export function markPeerDelivered(ctx: ProductHttpContext, item: PeerReview): void {
  ctx.db.transaction(() => {
    const changed = ctx.db.sqlite.prepare("UPDATE peer_review_messages SET status = 'delivered', updated_at = ? WHERE id = ? AND status IN ('approved','pending')").run(Date.now(), item.id);
    if (changed.changes && item.recipient.kind === 'thread') writePeerEvent(ctx.db, item.recipient.sessionId, PEER_RECEIVED_EVENT,
      { id: item.id, from: item.sender.displayName, fromSessionId: item.sender.sessionId, kind: item.sender.kind, body: item.body, ts: Date.now() });
  });
  publish(ctx, item.ownerThreadId);
}
export async function reviewPeerMessage(ctx: ProductHttpContext, threadId: string, id: string, revision: number, decision: 'deliver' | 'discard'): Promise<void> {
  const item = getPeerReview(ctx, id);
  if (!item || item.ownerThreadId !== threadId) throw new ThreadCreateError(404, 'unknown_peer_message', 'Peer message is unavailable.');
  if (item.status === 'delivered' && decision === 'deliver' || item.status === 'discarded' && decision === 'discard') return;
  if (item.status !== 'pending' || item.revision !== revision) throw failure('Peer message changed. Reopen it before reviewing.');
  if (decision === 'discard') {
    ctx.db.sqlite.prepare("UPDATE peer_review_messages SET status = 'discarded', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'pending'").run(Date.now(), id);
    publish(ctx, threadId); return;
  }
  requirePeerCommunication(ctx);
  const owner = getConversationThread(ctx.db, threadId);
  if (!owner || owner.archivedAt !== null || owner.visibility !== 'visible' || owner.projectId !== item.projectId
    || item.recipient.projectId !== item.projectId || item.sender.projectId !== item.projectId) throw failure('Only available peers in the same project can communicate.');
  if (item.sender.kind === 'thread') {
    const source = getConversationThread(ctx.db, item.sender.sessionId);
    if (!source || source.archivedAt !== null || source.visibility !== 'visible' || source.projectId !== item.projectId) throw failure('Sender is no longer available.');
  }
  if (item.recipient.kind === 'thread' && (owner.status === 'stopping' || isThreadQueueAutoSendPaused(ctx.db, threadId))) {
    throw failure('Recipient stopped. Resume it explicitly, then review this message again.');
  }
  const generation = ctx.config.getConfig().threadCommunicationGeneration ?? 0;
  ctx.db.transaction(() => {
    for (const row of listDeferredThreadMessages(ctx.db, threadId)) {
      if (deferredReviewId(row.payload) === id && row.status === 'dispatching') throw failure('This peer message is already being delivered.');
    }
    const result = ctx.db.sqlite.prepare("UPDATE peer_review_messages SET status = 'approved', config_generation = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND revision = ?").run(generation, Date.now(), id, revision);
    if (!result.changes) throw failure('Peer message is already being reviewed.');
    if (item.recipient.kind === 'thread') {
      // A previous approval may still have a held queue row. Replace it atomically.
      for (const row of listDeferredThreadMessages(ctx.db, threadId)) {
        if (deferredReviewId(row.payload) === id) deleteDeferredThreadMessage(ctx.db, { id: row.id, threadId });
      }
      deferConversationSend(ctx, { threadId, input: item.transport, senderThreadId: item.sender.sessionId,
        peerReviewId: id, mode: 'queue-if-active' });
    }
  });
  if (item.recipient.kind === 'cli-agent') {
    try {
      const result = await ctx.cliAgentOps?.sendPeer?.({ to: item.recipient.sessionId, projectId: item.projectId,
        fromSessionId: item.sender.sessionId, fromHandle: item.sender.displayName, message: item.transport, generation });
      if (!result?.ok) throw failure(result?.error ?? 'CLI recipient unavailable.');
      markPeerDelivered(ctx, { ...item, status: 'approved' });
    } catch (error) {
      ctx.db.sqlite.prepare("UPDATE peer_review_messages SET status = 'pending', revision = revision + 1 WHERE id = ? AND status = 'approved'").run(id);
      throw error;
    }
  } else {
    void import('./conversation-lifecycle.js').then(m => m.flushHeldConversationSends(ctx, threadId)).catch(() => undefined);
  }
  publish(ctx, threadId);
}
