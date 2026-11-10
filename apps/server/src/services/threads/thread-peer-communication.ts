import { createPeerReview, getPeerReview, notifyPeerReview, requirePeerCommunication } from './thread-peer-review.js';
import {
  getConversationThread,
  listConversationThreadEventsWindow
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  PEER_LIMIT, PEER_MESSAGE_MAX_HOPS, PEER_MESSAGE_RATE_LIMIT,
  peerMessageHops, peerMessageText, peerToolSchemas,
  type PeerCaller, type PeerToolName, type ThreadPeer
} from '../agents/peer-tool-contract.js';
import {
  listThreadPeers, peerEvent, writePeerEvent,
  PEER_READ_EVENT, PEER_RECEIVED_EVENT, PEER_REGISTERED_EVENT, PEER_SENT_EVENT
} from './thread-peer-directory.js';

interface PeerMessage {
  id: string;
  from: string;
  fromSessionId: string;
  kind: PeerCaller['kind'];
  body: string;
  ts: number;
}

export function threadPeerCaller(ctx: ProductHttpContext, threadId: string): PeerCaller {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread || thread.archivedAt !== null || thread.visibility !== 'visible' || thread.status === 'stopping') {
    throw new Error('Peer communication requires an available, visible thread.');
  }
  const profile = peerEvent<{ handle: string }>(ctx.db, threadId, PEER_REGISTERED_EVENT);
  const event = peerEvent<{ input?: Array<{ type: string; text?: string }> }>(ctx.db, threadId, 'client/turn/requested');
  const text = event?.input?.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n') ?? '';
  return { sessionId: threadId, projectId: thread.projectId, kind: 'thread',
    displayName: profile?.handle || thread.title?.trim() || threadId, hops: peerMessageHops(text) };
}

/** One facade for thread DynamicTools and main-authenticated CLI Agent calls. */
export async function invokeThreadPeerTool(
  ctx: ProductHttpContext,
  caller: PeerCaller,
  name: PeerToolName,
  input: unknown,
  options: { threadsOnly?: boolean } = {}
): Promise<unknown> {
  requirePeerCommunication(ctx);
  // Runtime validation is authoritative; provider JSON Schema is only advisory.
  const fields = peerToolSchemas[name].parse(input) as {
    allProjects?: boolean; handle?: string; role?: string; capability?: string;
    capabilities?: string[]; to?: string; message?: string; since?: string;
  };
  if (caller.kind === 'thread') caller = threadPeerCaller(ctx, caller.sessionId);
  if (fields.allProjects === true) throw new Error('Thread communication is limited to the same project.');
  const scope = caller.projectId;
  const ownThread = caller.kind === 'thread';

  if (name === 'agent_inbox') {
    if (!ownThread) throw new Error('CLI Agents read their session mailbox with agent_inbox.');
    const cursor = fields.since ?? peerEvent<{ sequence: number }>(ctx.db, caller.sessionId, PEER_READ_EVENT)?.sequence;
    const events = listConversationThreadEventsWindow(ctx.db, caller.sessionId, {
      type: PEER_RECEIVED_EVENT, limit: 50, maxBytes: 900_000
    }).filter(event => getPeerReview(ctx, (event.payload as PeerMessage).id)?.status === 'delivered');
    const index = typeof cursor === 'string' ? events.findIndex(event => (event.payload as PeerMessage).id === cursor) : -1;
    const pending = typeof cursor === 'number' ? events.filter(event => event.sequence > cursor)
      : index >= 0 ? events.slice(index + 1) : events;
    if (pending.length) writePeerEvent(ctx.db, caller.sessionId, PEER_READ_EVENT, { sequence: pending.at(-1)!.sequence });
    return pending.map(event => event.payload);
  }

  const threads = listThreadPeers(ctx.db, scope);
  const cli = options.threadsOnly ? [] : await ctx.cliAgentOps?.peers?.(scope) ?? [];
  const peers = [...threads, ...cli].filter(peer => peer.sessionId !== caller.sessionId && peer.projectId === caller.projectId);

  if (name === 'register_agent') {
    if (!ownThread) throw new Error('CLI Agents register with their session registry.');
    return ctx.db.transaction(() => {
      const taken = new Set([...listThreadPeers(ctx.db, caller.projectId), ...cli]
        .filter(peer => peer.sessionId !== caller.sessionId).map(peer => peer.handle));
      let handle = fields.handle!;
      for (let suffix = 2; taken.has(handle); suffix++) handle = `${fields.handle}-${suffix}`;
      const previous = peerEvent<{ role?: string; capabilities?: string[] }>(ctx.db, caller.sessionId, PEER_REGISTERED_EVENT);
      const profile = { handle, role: fields.role ?? previous?.role, capabilities: fields.capabilities ?? previous?.capabilities };
      writePeerEvent(ctx.db, caller.sessionId, PEER_REGISTERED_EVENT, profile);
      return { ...profile, sessionId: caller.sessionId, projectId: caller.projectId, kind: 'thread' };
    });
  }

  if (name === 'list_agents') return peers.slice(0, PEER_LIMIT);
  if (name === 'find_agent') {
    if (!fields.handle && !fields.role && !fields.capability) throw new Error('Supply a handle, role, or capability.');
    return peers.filter(peer => (!fields.handle || peer.handle === fields.handle || peer.displayName === fields.handle || peer.sessionId === fields.handle)
      && (!fields.role || peer.role === fields.role)
      && (!fields.capability || peer.capabilities?.includes(fields.capability)));
  }

  const to = fields.to!;
  if (to === caller.sessionId || to === caller.displayName) throw new Error('Cannot message yourself.');
  // Exact ids and authoritative handles outrank titles. Never select an arbitrary ambiguous title.
  let matches = peers.filter(peer => peer.sessionId === to);
  if (!matches.length) matches = listThreadPeers(ctx.db, scope, to);
  if (!matches.length) matches = peers.filter(peer => peer.handle === to);
  if (!matches.length) matches = peers.filter(peer => peer.displayName === to);
  if (!matches.length) throw new Error('No available peer found in this project scope.');
  if (matches.length !== 1) throw new Error('Peer name is ambiguous. Address its sessionId instead.');
  const target: ThreadPeer = matches[0]!;
  const hops = (caller.hops ?? 0) + 1;
  if (hops > PEER_MESSAGE_MAX_HOPS) throw new Error('Peer conversation reached its automatic reply limit. Wait for user guidance.');
  const message = fields.message!;
  if (ownThread) {
    const recent = listConversationThreadEventsWindow(ctx.db, caller.sessionId, { type: PEER_SENT_EVENT, limit: PEER_MESSAGE_RATE_LIMIT, maxBytes: 900_000 });
    if (recent.length >= PEER_MESSAGE_RATE_LIMIT && recent[0]!.createdAt > Date.now() - 60_000) {
      throw new Error('Peer message rate limit reached. Wait before sending more.');
    }
  }
  const text = peerMessageText(caller, hops, message);
  // No recipient mailbox, context or runnable queue sees a pending body.
  const review = ctx.db.transaction(() => {
    const item = createPeerReview(ctx, caller, target, message, text);
    if (ownThread) writePeerEvent(ctx.db, caller.sessionId, PEER_SENT_EVENT, { id: item.id, to: target.sessionId });
    return item;
  });
  try { notifyPeerReview(ctx, review); } catch { /* durable acceptance survives UI publication failure */ }
  return { ok: true, id: review.id, to: target.sessionId, handle: target.handle ?? target.displayName,
    delivery: 'awaiting-review', reviewThreadId: review.ownerThreadId };
}
