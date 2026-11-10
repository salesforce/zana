import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openDatabase, upsertHost, createEnvironment, createConversationThread, appendConversationThreadEvent,
  listDeferredThreadMessages, pauseDeferredThreadMessagesForThread, resumeDeferredThreadMessagesForThread, createDeferredThreadMessage, type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { invokeThreadPeerTool, threadPeerCaller } from './thread-peer-communication.js';
import { assertPeerDispatch, createPeerReview, getPeerReview, listPeerReviews, reviewPeerMessage, markPeerDelivered } from './thread-peer-review.js';
import { invokeHostPeerTool, HOST_PEER_TOOLS } from './host-peer-tools.js';
import { listThreadPeers, peerEvent, writePeerEvent, PEER_REGISTERED_EVENT, PEER_SENT_EVENT } from './thread-peer-directory.js';
import { peerMessageText, peerMessageHops, peerToolSchemas, type PeerCaller } from '../agents/peer-tool-contract.js';

const flush = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./conversation-lifecycle.js', () => ({ flushHeldConversationSends: flush }));
vi.mock('./conversation-thread-view.js', () => ({ conversationThreadView: (_ctx: unknown, thread: unknown) => thread }));

let dir: string, db: ZccDatabase, ctx: ProductHttpContext, sender: string, target: string, remote: string;
function add(projectId: string, title: string, visibility: 'visible' | 'hidden' = 'visible', status: 'idle' | 'active' = 'idle') {
  const host = upsertHost(db, { name: 'host', hostKeyHash: 'a'.repeat(64) });
  const env = createEnvironment(db, { projectId, hostId: host.id, path: dir });
  return createConversationThread(db, { projectId, hostId: host.id, environmentId: env.id, providerId: 'fake', title, visibility, status }).id;
}
function call(name: Parameters<typeof invokeThreadPeerTool>[2], input: unknown = {}, id = sender) {
  return invokeThreadPeerTool(ctx, threadPeerCaller(ctx, id), name, input);
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-thread-peers-')); db = openDatabase(join(dir, 'db.sqlite'));
  sender = add('p1', 'Builder'); target = add('p1', 'Reviewer', 'visible', 'active'); remote = add('p2', 'Other project');
  ctx = { db, dataDir: dir, config: { getConfig: () => ({}) }, hub: { emit: vi.fn() }, cliAgentOps: { peers: vi.fn(async () => []), sendPeer: vi.fn() } } as unknown as ProductHttpContext;
  flush.mockReset().mockResolvedValue(undefined);
});

describe('peer review authorization', () => {
  it('blocks every cached native tool and authenticated CLI bridge when switched off', async () => {
    ctx.config.getConfig = () => ({ threadCommunicationEnabled: false }) as never;
    for (const [name, input] of [['list_agents', {}], ['find_agent', { handle: 'Reviewer' }], ['agent_inbox', {}],
      ['register_agent', { handle: 'builder' }], ['agent_send', { to: target, message: 'hidden' }]] as const) {
      await expect(call(name, input)).rejects.toThrow('disabled');
    }
    await expect(invokeThreadPeerTool(ctx, { sessionId: 'cli', projectId: 'p1', displayName: 'CLI', kind: 'cli-agent' }, 'list_agents', {})).rejects.toThrow('disabled');
  });
  it('requires exact ownership and revision; discard never wakes or exposes a message', async () => {
    const { id } = await call('agent_send', { to: target, message: 'review me' }) as { id: string };
    await expect(reviewPeerMessage(ctx, sender, id, 1, 'deliver')).rejects.toThrow('unavailable');
    await expect(reviewPeerMessage(ctx, target, id, 2, 'deliver')).rejects.toThrow('changed');
    await expect(reviewPeerMessage(ctx, target, 'missing', 1, 'discard')).rejects.toThrow('unavailable');
    await reviewPeerMessage(ctx, target, id, 1, 'discard');
    await reviewPeerMessage(ctx, target, id, 1, 'discard');
    expect(listPeerReviews(ctx, target)).toEqual([]);
    await expect(reviewPeerMessage(ctx, target, id, 2, 'deliver')).rejects.toThrow('changed');
    expect(flush).not.toHaveBeenCalled();
    expect(await call('agent_inbox', {}, target)).toEqual([]);
  });
  it('checks immutable transport, native sender identity, and project at dispatch', async () => {
    const { id } = await call('agent_send', { to: target, message: 'exact body' }) as { id: string };
    expect(() => assertPeerDispatch(ctx, target, sender, id)).toThrow('review');
    await reviewPeerMessage(ctx, target, id, 1, 'deliver');
    const item = getPeerReview(ctx, id)!;
    expect(assertPeerDispatch(ctx, target, sender, id, item.transport).id).toBe(id);
    for (const [thread, from, review, input] of [[target, sender, id, 'edited'], [target, remote, id, item.transport], [sender, sender, id, item.transport], [target, sender, undefined, item.transport]] as const) {
      expect(() => assertPeerDispatch(ctx, thread, from, review, input)).toThrow();
    }
    db.sqlite.prepare('UPDATE threads SET project_id = ? WHERE id = ?').run('p2', sender);
    expect(() => assertPeerDispatch(ctx, target, sender, id)).toThrow();
  });
  it('invalidates approved queue entries on off/on without needing a drain while off', async () => {
    let config = { threadCommunicationEnabled: true, threadCommunicationGeneration: 0 };
    ctx.config.getConfig = () => config as never;
    const { id } = await call('agent_send', { to: target, message: 'hold' }) as { id: string };
    await reviewPeerMessage(ctx, target, id, 1, 'deliver');
    config = { threadCommunicationEnabled: true, threadCommunicationGeneration: 2 };
    expect(() => assertPeerDispatch(ctx, target, sender, id)).toThrow('paused');
    expect(listPeerReviews(ctx, target)[0]).toMatchObject({ status: 'pending', revision: 2 });
    await reviewPeerMessage(ctx, target, id, 2, 'deliver');
    expect(listDeferredThreadMessages(db, target)).toHaveLength(1);
    config = { threadCommunicationEnabled: false, threadCommunicationGeneration: 3 };
    expect(listPeerReviews(ctx, target)[0].status).toBe('pending');
    await expect(reviewPeerMessage(ctx, target, id, 3, 'deliver')).rejects.toThrow('disabled');
  });
  it('revokes approval on Stop and does not restore it when an ordinary send resumes the queue', async () => {
    const { id } = await call('agent_send', { to: target, message: 'held' }) as { id: string };
    await reviewPeerMessage(ctx, target, id, 1, 'deliver');
    pauseDeferredThreadMessagesForThread(db, target);
    resumeDeferredThreadMessagesForThread(db, target);
    expect(() => assertPeerDispatch(ctx, target, sender, id)).toThrow('review');
    expect(listPeerReviews(ctx, target)[0]).toMatchObject({ status: 'pending', revision: 2 });
    await reviewPeerMessage(ctx, target, id, 2, 'deliver');
    expect(listDeferredThreadMessages(db, target)).toHaveLength(1);
  });
  it('rejects an approval for a paused queue, archive or changed project', async () => {
    const { id } = await call('agent_send', { to: target, message: 'hold' }) as { id: string };
    db.sqlite.prepare('UPDATE threads SET archived_at = 1 WHERE id = ?').run(sender);
    await expect(reviewPeerMessage(ctx, target, id, 1, 'deliver')).rejects.toThrow('Sender');
    db.sqlite.prepare('UPDATE threads SET archived_at = NULL WHERE id = ?').run(sender);
    db.sqlite.prepare('UPDATE threads SET project_id = ? WHERE id = ?').run('p2', target);
    await expect(reviewPeerMessage(ctx, target, id, 1, 'deliver')).rejects.toThrow('same project');
  });
  it('rolls back approval when the normal queue is full', async () => {
    const { id } = await call('agent_send', { to: target, message: 'hold' }) as { id: string };
    for (let i = 0; i < 50; i++) createDeferredThreadMessage(db, { threadId: target, kind: 'send', payload: JSON.stringify({ kind: 'send', input: 'user' }) });
    await expect(reviewPeerMessage(ctx, target, id, 1, 'deliver')).rejects.toThrow('Too many');
    expect(getPeerReview(ctx, id)?.status).toBe('pending');
  });
  it('quarantines legacy queued traffic before exposing it as reviewable content', async () => {
    const transport = peerMessageText(threadPeerCaller(ctx, sender), 1, 'Old pending body');
    const old = createDeferredThreadMessage(db, { threadId: target, kind: 'send', payload: JSON.stringify({ kind: 'send', input: transport, senderThreadId: sender }) });
    createDeferredThreadMessage(db, { threadId: target, kind: 'send', payload: '{malformed' });
    appendConversationThreadEvent(db, { threadId: target, type: 'peer/message/received', payload: { id: 'old', body: 'Old pending body' } });
    expect(await call('agent_inbox', {}, target)).toEqual([]);
    expect(listPeerReviews(ctx, target)).toEqual([expect.objectContaining({ id: `peer_legacy_${old.id}`, body: 'Old pending body', status: 'pending' })]);
    expect(listDeferredThreadMessages(db, target)).toHaveLength(1);
    expect(listPeerReviews(ctx, target)).toHaveLength(1);
    expect(flush).not.toHaveBeenCalled();
    await reviewPeerMessage(ctx, target, `peer_legacy_${old.id}`, 1, 'deliver');
    expect(getPeerReview(ctx, `peer_legacy_${old.id}`)?.status).toBe('approved');
  });
  it('revokes approval when a recipient becomes hidden before dispatch', async () => {
    const { id } = await call('agent_send', { to: target, message: 'hold' }) as { id: string };
    await reviewPeerMessage(ctx, target, id, 1, 'deliver');
    db.sqlite.prepare("UPDATE threads SET visibility = 'hidden' WHERE id = ?").run(target);
    expect(() => assertPeerDispatch(ctx, target, sender, id)).toThrow('review');
    expect(getPeerReview(ctx, id)).toMatchObject({ status: 'pending', revision: 2 });
  });
  it('does not reapprove a revoked message while its old dispatch is still in flight', async () => {
    const { id } = await call('agent_send', { to: target, message: 'hold' }) as { id: string };
    await reviewPeerMessage(ctx, target, id, 1, 'deliver');
    pauseDeferredThreadMessagesForThread(db, target);
    resumeDeferredThreadMessagesForThread(db, target);
    const row = listDeferredThreadMessages(db, target)[0];
    db.sqlite.prepare("UPDATE deferred_thread_messages SET status = 'dispatching' WHERE id = ?").run(row.id);
    await expect(reviewPeerMessage(ctx, target, id, 2, 'deliver')).rejects.toThrow('already being delivered');
    expect(getPeerReview(ctx, id)?.status).toBe('pending');
  });
  it('keeps CLI failures reviewable, refuses concurrent approval and makes delivered approval idempotent', async () => {
    const cli = { sessionId: 'cli', projectId: 'p1', kind: 'cli-agent', displayName: 'CLI', status: 'working' } as const;
    vi.mocked(ctx.cliAgentOps!.peers!).mockResolvedValue([cli]);
    vi.mocked(ctx.cliAgentOps!.sendPeer!).mockResolvedValue({ ok: false, error: 'busy' });
    const { id } = await call('agent_send', { to: 'cli', message: 'Review' }) as { id: string };
    await expect(reviewPeerMessage(ctx, sender, id, 1, 'deliver')).rejects.toThrow('busy');
    expect(getPeerReview(ctx, id)).toMatchObject({ status: 'pending', revision: 2 });
    vi.mocked(ctx.cliAgentOps!.sendPeer!).mockResolvedValue({ ok: true });
    await reviewPeerMessage(ctx, sender, id, 2, 'deliver');
    await reviewPeerMessage(ctx, sender, id, 2, 'deliver');
    expect(ctx.cliAgentOps!.sendPeer).toHaveBeenCalledTimes(2);
    const native = await call('agent_send', { to: target, message: 'Native' }) as { id: string };
    await reviewPeerMessage(ctx, target, native.id, 1, 'deliver');
    await expect(reviewPeerMessage(ctx, target, native.id, 1, 'deliver')).rejects.toThrow('changed');
  });
  it('bounds retained review history and keeps accepted submissions when UI publication fails', async () => {
    const recipient = listThreadPeers(db, 'p1').find(p => p.sessionId === target)!;
    for (let i = 0; i < 160; i++) {
      const item = createPeerReview(ctx, threadPeerCaller(ctx, sender), recipient, 'done', 'done');
      db.sqlite.prepare("UPDATE peer_review_messages SET status = 'discarded' WHERE id = ?").run(item.id);
    }
    vi.mocked(ctx.hub.emit).mockImplementation(() => { throw new Error('UI gone'); });
    await expect(call('agent_send', { to: target, message: 'durable' })).resolves.toMatchObject({ delivery: 'awaiting-review' });
    expect((db.sqlite.prepare('SELECT COUNT(*) AS n FROM peer_review_messages').get() as { n: number }).n).toBeLessThanOrEqual(151);
  });
});
afterEach(async () => {
  await import('./conversation-lifecycle.js');
  await Promise.resolve();
  db.close(); rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks();
});

describe('thread peer communication with durable queue', () => {
  it('bounds retained coordination metadata without deleting the sequence tip', async () => {
    for (let i = 0; i < 5; i++) writePeerEvent(db, sender, PEER_REGISTERED_EVENT, { handle: `builder-${i}` });
    for (let i = 0; i < 35; i++) writePeerEvent(db, sender, PEER_SENT_EVENT, { id: String(i) });
    const counts = db.sqlite.prepare('SELECT type, COUNT(*) AS count FROM thread_events WHERE thread_id = ? GROUP BY type').all(sender);
    expect(counts).toEqual(expect.arrayContaining([{ type: PEER_REGISTERED_EVENT, count: 1 }, { type: PEER_SENT_EVENT, count: 30 }]));
    expect(peerEvent(db, sender, PEER_REGISTERED_EVENT)).toEqual({ handle: 'builder-4' });
    expect(peerEvent(db, sender, PEER_SENT_EVENT)).toEqual({ id: '34' });
  });

  it('discovers same-project visible peers and rejects cross-project requests', async () => {
    const hidden = add('p1', 'Secret worker', 'hidden');
    db.sqlite.prepare('UPDATE threads SET archived_at = 1 WHERE id = ?').run(add('p1', 'Archived'));
    db.sqlite.prepare("UPDATE threads SET status = 'stopping' WHERE id = ?").run(add('p1', 'Stopping'));
    expect(await call('list_agents')).toEqual([expect.objectContaining({ sessionId: target, kind: 'thread', status: 'active' })]);
    await expect(call('list_agents', { allProjects: true })).rejects.toThrow('same project');
    await expect(call('agent_send', { to: remote, message: 'wrong scope' })).rejects.toThrow('scope');
    await expect(call('agent_send', { to: hidden, message: 'hidden' })).rejects.toThrow();
    await expect(call('agent_send', { to: remote, message: 'cross-project', allProjects: true })).rejects.toThrow('same project');
    expect(listDeferredThreadMessages(db, remote)).toHaveLength(0);
  });

  it('keeps a stable handle through title changes and preserves role and capabilities', async () => {
    expect(await call('register_agent', { handle: 'builder', role: 'implementation', capabilities: ['typescript'] })).toMatchObject({ handle: 'builder' });
    expect(await call('register_agent', { handle: 'builder' }, target)).toMatchObject({ handle: 'builder-2' });
    await call('register_agent', { handle: 'builder' });
    db.sqlite.prepare('UPDATE threads SET title = ? WHERE id = ?').run('Drifting title', sender);
    expect(listThreadPeers(db, 'p1').find(peer => peer.sessionId === sender)).toMatchObject({ handle: 'builder', displayName: 'Drifting title', role: 'implementation', capabilities: ['typescript'] });
    expect(await call('find_agent', { handle: 'builder', role: 'implementation', capability: 'typescript' }, target)).toHaveLength(1);
    expect(await call('find_agent', { role: 'other' })).toEqual([]);
    await expect(call('find_agent')).rejects.toThrow('Supply');
  });

  it('persists pending reviews across reopen without a model inbox or runnable queue', async () => {
    await call('register_agent', { handle: 'builder' });
    const result = await call('agent_send', { to: target, message: 'Check the idle transition' }) as { id: string; delivery: string };
    expect(result.delivery).toBe('awaiting-review');
    expect(listDeferredThreadMessages(db, target)).toEqual([]);
    expect(await call('agent_inbox', {}, target)).toEqual([]);
    expect(flush).not.toHaveBeenCalled();
    db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
    expect(listThreadPeers(db).find(peer => peer.sessionId === sender)?.handle).toBe('builder');
    expect(listPeerReviews(ctx, target)[0]).toMatchObject({ id: result.id, body: 'Check the idle transition', status: 'pending' });
    await reviewPeerMessage(ctx, target, result.id, 1, 'deliver');
    const item = getPeerReview(ctx, result.id)!;
    expect(JSON.parse(listDeferredThreadMessages(db, target)[0].payload)).toMatchObject({ peerReviewId: item.id, senderThreadId: sender });
    expect(await call('agent_inbox', {}, target)).toEqual([]);
    markPeerDelivered(ctx, item);
    expect(await call('agent_inbox', {}, target)).toEqual([expect.objectContaining({ id: result.id, from: 'builder', fromSessionId: sender })]);
    expect(await call('agent_inbox', {}, target)).toEqual([]);
  });

  it('reads delivered inbox cursors only, including after old unreviewed audit entries', async () => {
    const one = await call('agent_send', { to: target, message: 'one' }) as { id: string };
    const two = await call('agent_send', { to: target, message: 'two' }) as { id: string };
    for (const result of [one, two]) { await reviewPeerMessage(ctx, target, result.id, 1, 'deliver'); markPeerDelivered(ctx, getPeerReview(ctx, result.id)!); }
    const after = await call('agent_inbox', { since: one.id }, target) as Array<{ body: string }>;
    expect(after.map(message => message.body)).toEqual(['two']);
    expect(await call('agent_inbox', { since: 'trimmed-cursor' }, target)).toHaveLength(2);
  });

  it('accepts stopped-recipient messages for review without waking them', async () => {
    pauseDeferredThreadMessagesForThread(db, target);
    const result = await call('agent_send', { to: target, message: 'wait' }) as { id: string };
    await expect(reviewPeerMessage(ctx, target, result.id, 1, 'deliver')).rejects.toThrow('stopped');
    expect(getPeerReview(ctx, result.id)?.status).toBe('pending');
    expect(flush).not.toHaveBeenCalled();
  });

  it('caps unresolved reviews without falsely accepting another send', async () => {
    for (let i = 0; i < 50; i++) {
      await call('agent_send', { to: target, message: String(i) });
      db.sqlite.prepare("DELETE FROM thread_events WHERE thread_id = ? AND type = ?").run(sender, PEER_SENT_EVENT);
    }
    await expect(call('agent_send', { to: target, message: 'overflow' })).rejects.toThrow('Too many');
    expect(listPeerReviews(ctx, target)).toHaveLength(50);
    expect(listDeferredThreadMessages(db, target)).toEqual([]);
    const old = createDeferredThreadMessage(db, { threadId: target, kind: 'send', payload: JSON.stringify({ kind: 'send', input: 'old held message', senderThreadId: sender }) });
    const reviews = listPeerReviews(ctx, target);
    expect(reviews).toHaveLength(50);
    expect(listDeferredThreadMessages(db, target)).toHaveLength(1);
    await reviewPeerMessage(ctx, target, reviews[0].id, reviews[0].revision, 'discard');
    expect(listPeerReviews(ctx, target)).toEqual(expect.arrayContaining([expect.objectContaining({ id: `peer_legacy_${old.id}`, status: 'pending' })]));
    expect(listDeferredThreadMessages(db, target)).toEqual([]);
  });

  it('refuses self, hidden, missing and ambiguous recipients; exact handles win over titles', async () => {
    await expect(call('agent_send', { to: sender, message: 'self' })).rejects.toThrow('yourself');
    await expect(call('agent_send', { to: 'Builder', message: 'self' })).rejects.toThrow('yourself');
    const hidden = add('p1', 'Hidden', 'hidden');
    await expect(call('agent_send', { to: hidden, message: 'no' })).rejects.toThrow('No available');
    await expect(call('agent_send', { to: 'unknown', message: 'no' })).rejects.toThrow('No available');
    add('p1', 'Reviewer');
    await expect(call('agent_send', { to: 'Reviewer', message: 'ambiguous' })).rejects.toThrow('ambiguous');
    await call('register_agent', { handle: 'Reviewer' }, target);
    expect(await call('agent_send', { to: 'Reviewer', message: 'chosen' })).toMatchObject({ to: target });
  });

  it('excludes unavailable callers and refuses caller identity supplied in tool input', async () => {
    for (const id of [add('p1', 'Hidden', 'hidden'), 'missing']) expect(() => threadPeerCaller(ctx, id)).toThrow('available');
    await expect(call('list_agents', { projectId: 'p2' })).rejects.toThrow();
    await expect(call('agent_send', { to: target, message: 'hello', fromSessionId: remote })).rejects.toThrow();
    db.sqlite.prepare('UPDATE threads SET archived_at = 1 WHERE id = ?').run(sender);
    expect(() => threadPeerCaller(ctx, sender)).toThrow('available');
  });

  it('bounds automatic reply chains and lets a real user turn reset the chain', async () => {
    const input = [{ type: 'text', text: peerMessageText({ sessionId: remote, projectId: 'p2', displayName: 'Peer', kind: 'thread' }, 8, 'continue') }];
    appendConversationThreadEvent(db, { threadId: sender, type: 'client/turn/requested', payload: { input } });
    await expect(call('agent_send', { to: target, message: 'loop' })).rejects.toThrow('automatic reply limit');
    appendConversationThreadEvent(db, { threadId: sender, type: 'client/turn/requested', payload: { input: [{ type: 'text', text: 'User asks for another check' }] } });
    await expect(call('agent_send', { to: target, message: 'new work' })).resolves.toMatchObject({ ok: true });
  });

  it('limits sends per minute', async () => {
    for (let i = 0; i < 30; i++) writePeerEvent(db, sender, PEER_SENT_EVENT, { to: target });
    await expect(call('agent_send', { to: target, message: 'too many' })).rejects.toThrow('rate limit');
    db.sqlite.prepare('UPDATE thread_events SET created_at = 0 WHERE thread_id = ?').run(sender);
    await expect(call('agent_send', { to: target, message: 'later' })).resolves.toMatchObject({ ok: true });
  });

  it('keeps native-to-CLI messages out of the mailbox until reviewed', async () => {
    const cli = { sessionId: 'cli-1', projectId: 'p1', kind: 'cli-agent', displayName: 'CLI reviewer', status: 'working', handle: 'cli-review' } as const;
    vi.mocked(ctx.cliAgentOps!.peers!).mockResolvedValue([cli]);
    vi.mocked(ctx.cliAgentOps!.sendPeer!).mockResolvedValue({ ok: true, id: 'mail-1', delivered: true });
    expect(await call('find_agent', { handle: 'cli-review' })).toEqual([cli]);
    const result = await call('agent_send', { to: 'cli-1', message: 'Please review' }) as { id: string };
    expect(ctx.cliAgentOps!.sendPeer).not.toHaveBeenCalled();
    await reviewPeerMessage(ctx, sender, result.id, 1, 'deliver');
    expect(ctx.cliAgentOps!.sendPeer).toHaveBeenCalledWith(expect.objectContaining({ fromSessionId: sender, fromHandle: 'Builder', generation: 0 }));
    expect(getPeerReview(ctx, result.id)?.status).toBe('delivered');
  });

  it('accepts a main-authenticated CLI sender for review without recursively exposing CLI peers', async () => {
    const caller: PeerCaller = { sessionId: 'cli-1', projectId: 'p1', kind: 'cli-agent', displayName: 'CLI reviewer' };
    expect(await invokeThreadPeerTool(ctx, caller, 'agent_send', { to: target, message: 'CLI result' }, { threadsOnly: true })).toMatchObject({ ok: true, delivery: 'awaiting-review' });
    expect(ctx.cliAgentOps!.peers).not.toHaveBeenCalled();
    expect(await call('agent_inbox', {}, target)).toEqual([]);
    await expect(invokeThreadPeerTool(ctx, caller, 'agent_inbox', {})).rejects.toThrow('session mailbox');
    await expect(invokeThreadPeerTool(ctx, caller, 'register_agent', { handle: 'cli' })).rejects.toThrow('session registry');
  });

  it('adapts the host tools and returns validation failures as tool errors', async () => {
    expect(HOST_PEER_TOOLS).toHaveLength(5);
    expect(await invokeHostPeerTool(ctx, { threadId: sender, name: 'list_agents', input: {} })).toMatchObject({ success: true });
    const result = await invokeHostPeerTool(ctx, { threadId: sender, name: 'agent_send', input: { to: target, message: '' } });
    expect(result.success).toBe(false);
    expect(peerToolSchemas.agent_send.safeParse({ to: target, message: 'x'.repeat(16_001) }).success).toBe(false);
    expect(peerMessageHops('ordinary user input')).toBe(0);
    expect(peerMessageHops(peerMessageText(threadPeerCaller(ctx, sender), 3, 'hello'))).toBe(3);
    expect(peerEvent(db, sender, PEER_REGISTERED_EVENT)).toBeUndefined();
  });
});
