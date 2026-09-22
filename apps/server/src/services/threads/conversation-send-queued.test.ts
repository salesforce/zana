import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveConversationThread, createConversationThread, createDeferredThreadMessage, createEnvironment,
  getDeferredThreadMessage, listDeferredThreadMessages, markDeferredThreadMessageDispatching,
  markDeferredThreadMessageFailed, openDatabase, upsertHost, type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { sendDeferredConversationMessage } from './conversation-deferred-messages.js';

let db: ZccDatabase;
let dir: string;
let threadId: string;
let otherThreadId: string;
let context: ProductHttpContext;
const payload = {
  kind: 'send', mode: 'queue-if-active',
  input: [{ type: 'text', text: 'selected', mentions: [] }, { type: 'image', url: 'attachment.png' }],
  execution: { model: 'test-model', reasoningLevel: 'high', permissionMode: 'full' }
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-send-queued-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  const host = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(db, { projectId: 'p', hostId: host.id, path: dir });
  const create = () => createConversationThread(db, {
    projectId: 'p', hostId: host.id, environmentId: environment.id, providerId: 'codex', status: 'idle'
  });
  threadId = create().id;
  otherThreadId = create().id;
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

function queue(extra: Partial<Parameters<typeof createDeferredThreadMessage>[1]> = {}) {
  return createDeferredThreadMessage(db, { threadId, kind: 'send', payload: JSON.stringify(payload), ...extra });
}

describe('send one queued message', () => {
  it.each([false, true])('sends only the selected row (paused=%s), preserving its input and execution', async (paused) => {
    const first = queue({ paused, groupBoundaryId: 'same-group' });
    const selected = queue({ paused, groupBoundaryId: 'same-group', sendAfter: Date.now() + 60_000 });
    const last = queue({ paused, groupBoundaryId: 'same-group' });
    const deliver = vi.fn(async () => undefined);
    await sendDeferredConversationMessage(context, threadId, selected.id, deliver);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(payload);
    expect(listDeferredThreadMessages(db, threadId)).toEqual([first, last]);
  });

  it.each(['unknown-thread', 'thread-archived', 'pending-interaction', 'host-offline'])('retains the message when blocked by %s', async (reason) => {
    const row = queue({ paused: true });
    let target = threadId;
    if (reason === 'unknown-thread') target = 'missing';
    if (reason === 'thread-archived') archiveConversationThread(db, threadId);
    if (reason === 'pending-interaction') context.pendingInteractions.hasPendingThreadInteraction = () => true;
    if (reason === 'host-offline') context.hostHub.connectedHostIds = () => [];
    const deliver = vi.fn();
    await expect(sendDeferredConversationMessage(context, target, row.id, deliver)).rejects.toBeInstanceOf(ThreadCreateError);
    expect(deliver).not.toHaveBeenCalled();
    expect(getDeferredThreadMessage(db, { threadId, id: row.id })).toEqual(row);
  });

  it('rejects missing and cross-thread message ids without claiming a foreign row', async () => {
    const row = queue({ threadId: otherThreadId });
    const deliver = vi.fn();
    for (const id of [row.id, 'missing']) {
      await expect(sendDeferredConversationMessage(context, threadId, id, deliver))
        .rejects.toMatchObject({ status: 404, code: 'unknown-queued-send' });
      expect(markDeferredThreadMessageDispatching(db, { threadId, id, retryFailed: true })).toBe(false);
    }
    expect(deliver).not.toHaveBeenCalled();
    expect(listDeferredThreadMessages(db, otherThreadId)).toEqual([row]);
  });

  it('claims once across simultaneous clicks and auto-drain', async () => {
    const row = queue();
    let finish!: () => void;
    const deliver = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = sendDeferredConversationMessage(context, threadId, row.id, deliver);
    await expect(sendDeferredConversationMessage(context, threadId, row.id, deliver))
      .rejects.toMatchObject({ status: 409, code: 'queued-send-dispatching' });
    expect(markDeferredThreadMessageDispatching(db, { threadId, id: row.id })).toBe(false);
    expect(deliver).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(getDeferredThreadMessage(db, { threadId, id: row.id })).toBeNull();
  });

  it.each([new Error('offline'), new ThreadCreateError(409, 'stopping', 'Thread is stopping'), 'failure'])('preserves a failed send for explicit retry (%s)', async (error) => {
    const neighbor = queue();
    const row = queue();
    await expect(sendDeferredConversationMessage(context, threadId, row.id, async () => { throw error; }))
      .rejects.toBeInstanceOf(ThreadCreateError);
    expect(getDeferredThreadMessage(db, { threadId, id: row.id })).toMatchObject({
      status: 'failed', failureReason: error instanceof Error ? error.message : 'dispatch-failed'
    });
    expect(markDeferredThreadMessageDispatching(db, { threadId, id: row.id })).toBe(false);
    const deliver = vi.fn(async () => undefined);
    await sendDeferredConversationMessage(context, threadId, row.id, deliver);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(payload);
    expect(listDeferredThreadMessages(db, threadId)).toEqual([neighbor]);
  });

  it('leaves malformed payloads visible as failed', async () => {
    const row = queue({ payload: '{' });
    const deliver = vi.fn();
    await expect(sendDeferredConversationMessage(context, threadId, row.id, deliver))
      .rejects.toMatchObject({ code: 'dispatch-failed' });
    expect(deliver).not.toHaveBeenCalled();
    expect(getDeferredThreadMessage(db, { threadId, id: row.id })?.status).toBe('failed');
  });

  it('keeps the ordinary queued-row claim working', () => {
    const row = queue();
    expect(markDeferredThreadMessageDispatching(db, { threadId, id: row.id })).toBe(true);
    markDeferredThreadMessageFailed(db, { threadId, id: row.id, reason: 'failed' });
    expect(markDeferredThreadMessageDispatching(db, { threadId, id: row.id })).toBe(false);
  });
});
