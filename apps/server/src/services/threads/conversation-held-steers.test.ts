import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveConversationThread, createConversationThread, createDeferredThreadMessage, createEnvironment,
  getConversationThread, getDeferredThreadMessage, listDeferredThreadMessages, openDatabase, setConversationProviderThreadId, upsertHost,
  updateConversationThreadStatus,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  awaitsSteerTarget, DeferredAdmissionWait, flushHeldConversationSteers, isSteerSendMode, parseDeferredSendPayload
} from './conversation-deferred-messages.js';

let db: ZccDatabase;
let dir: string;
let threadId: string;
let context: ProductHttpContext;

const send = (mode: string, text: string) => JSON.stringify({ kind: 'send', mode, input: [{ type: 'text', text, mentions: [] }] });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-held-steers-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  const host = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(db, { projectId: 'p', hostId: host.id, path: dir });
  threadId = createConversationThread(db, {
    projectId: 'p', hostId: host.id, environmentId: environment.id, providerId: 'codex', status: 'active'
  }).id;
  setConversationProviderThreadId(db, threadId, 'provider-session');
  context = {
    db,
    pendingInteractions: { hasPendingThreadInteraction: () => false },
    hostHub: { connectedHostIds: () => [host.id] }
  } as unknown as ProductHttpContext;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function queue(mode: string, text: string, extra: Partial<Parameters<typeof createDeferredThreadMessage>[1]> = {}) {
  return createDeferredThreadMessage(db, { threadId, kind: 'send', payload: send(mode, text), ...extra });
}

const texts = (calls: unknown[][]) => calls.map(([payload]) => (payload as { input: Array<{ text: string }> }).input[0]!.text);

describe('held steers', () => {
  it('recognises steer modes only', () => {
    expect(['steer', 'steer-if-active'].every((mode) => isSteerSendMode(mode as never))).toBe(true);
    expect(['auto', 'queue-if-active', 'start', undefined].some((mode) => isSteerSendMode(mode as never))).toBe(false);
  });

  it('steers held rows into the live turn and leaves ordinary follow-ups queued', async () => {
    const followUp = queue('queue-if-active', 'after');
    queue('steer-if-active', 'nudge');
    queue('steer', 'again');
    const deliver = vi.fn(async () => undefined);
    await expect(flushHeldConversationSteers(context, threadId, deliver)).resolves.toBe(2);
    expect(texts(deliver.mock.calls)).toEqual(['nudge', 'again']);
    expect(listDeferredThreadMessages(db, threadId)).toEqual([followUp]);
  });

  it('waits for the session of a thread whose first turn is still starting', () => {
    const thread = () => getConversationThread(db, threadId)!;
    expect(awaitsSteerTarget(db, thread())).toBe(false);
    updateConversationThreadStatus(db, threadId, 'starting');
    expect(awaitsSteerTarget(db, thread())).toBe(true);
    updateConversationThreadStatus(db, threadId, 'idle');
    expect(awaitsSteerTarget(db, thread())).toBe(false);
    const fresh = createConversationThread(db, {
      projectId: 'p', hostId: thread().hostId, environmentId: thread().environmentId!, providerId: 'codex', status: 'active'
    });
    expect(awaitsSteerTarget(db, fresh)).toBe(true);
    const fork = createConversationThread(db, {
      projectId: 'p', hostId: thread().hostId, environmentId: thread().environmentId!, providerId: 'codex', status: 'active', originKind: 'fork'
    });
    expect(awaitsSteerTarget(db, fork)).toBe(false);
  });

  it.each([
    ['no provider session', () => { db.sqlite.prepare('UPDATE threads SET provider_thread_id = NULL WHERE id = ?').run(threadId); }],
    ['not active', () => updateConversationThreadStatus(db, threadId, 'starting')],
    ['archived', () => archiveConversationThread(db, threadId)],
    ['host offline', () => { context.hostHub.connectedHostIds = () => []; }],
    ['queue paused', () => queue('queue-if-active', 'paused', { paused: true })],
    ['pending interaction', () => { context.pendingInteractions.hasPendingThreadInteraction = () => true; }]
  ])('waits while %s', async (_label, block) => {
    const row = queue('steer', 'nudge');
    block();
    const deliver = vi.fn();
    await expect(flushHeldConversationSteers(context, threadId, deliver)).resolves.toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(getDeferredThreadMessage(db, { threadId, id: row.id })?.status).toBe('queued');
  });

  it('returns nothing for an unknown thread', async () => {
    await expect(flushHeldConversationSteers(context, 'missing', vi.fn())).resolves.toBe(0);
  });

  it('skips grouped, edit-held, scheduled and admission-held rows', async () => {
    const now = Date.now();
    queue('steer', 'grouped', { groupBoundaryId: 'g' });
    queue('steer', 'later', { sendAfter: now + 60_000 });
    const held = queue('steer', 'editing');
    db.sqlite.prepare('UPDATE deferred_thread_messages SET edit_held_until = ? WHERE id = ?').run(now + 60_000, held.id);
    createDeferredThreadMessage(db, {
      threadId, kind: 'send',
      payload: JSON.stringify({ kind: 'send', mode: 'steer', input: [], admission: { generation: 1, overrideable: true, reason: 'wait' } })
    });
    const deliver = vi.fn();
    await expect(flushHeldConversationSteers(context, threadId, deliver, now)).resolves.toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('demotes a steer that cannot land to an ordinary follow-up and stops', async () => {
    const first = queue('steer', 'nudge');
    const second = queue('steer', 'again');
    const deliver = vi.fn(async () => { throw new Error('stale_turn'); });
    await expect(flushHeldConversationSteers(context, threadId, deliver)).resolves.toBe(0);
    expect(deliver).toHaveBeenCalledTimes(1);
    const demoted = getDeferredThreadMessage(db, { threadId, id: first.id })!;
    expect(demoted.status).toBe('queued');
    expect(parseDeferredSendPayload(demoted).mode).toBe('queue-if-active');
    expect(parseDeferredSendPayload(getDeferredThreadMessage(db, { threadId, id: second.id })!).mode).toBe('steer');
  });

  it('keeps a plugin-held steer queued with its admission and continues', async () => {
    const first = queue('steer', 'nudge');
    queue('steer', 'again');
    const admission = { generation: 3, overrideable: true, reason: 'hold', pluginId: 'p' };
    const deliver = vi.fn()
      .mockRejectedValueOnce(new DeferredAdmissionWait(admission))
      .mockResolvedValueOnce(undefined);
    await expect(flushHeldConversationSteers(context, threadId, deliver)).resolves.toBe(1);
    const held = getDeferredThreadMessage(db, { threadId, id: first.id })!;
    expect(parseDeferredSendPayload(held)).toMatchObject({ mode: 'steer', admission });
    expect(listDeferredThreadMessages(db, threadId)).toHaveLength(1);
  });
});
