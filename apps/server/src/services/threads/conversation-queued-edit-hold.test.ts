import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationThread, createDeferredThreadMessage, createEnvironment, getDeferredThreadMessage,
  holdDeferredThreadMessageForEdit, listDeferredThreadMessages, openDatabase, upsertHost, type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { ThreadCreateError } from '../../http/thread-create.js';
import {
  DEFERRED_EDIT_HOLD_LEASE_MS, MAX_QUEUED_EDIT_TEXT_CHARS, flushDeferredConversationMessages,
  holdDeferredConversationMessageForEdit, releaseDeferredConversationMessageEditHold,
  saveDeferredConversationMessageEdit, sendDeferredConversationMessage, wakeLapsedEditHolds,
  type DeferredSendPayload
} from './conversation-deferred-messages.js';

let db: ZccDatabase;
let dir: string;
let threadId: string;
let otherThreadId: string;
let context: ProductHttpContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-edit-hold-svc-'));
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
  vi.useRealTimers();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function queue(input: unknown = 'original', extra: Partial<Parameters<typeof createDeferredThreadMessage>[1]> = {}) {
  return createDeferredThreadMessage(db, {
    threadId, kind: 'send', payload: JSON.stringify({ kind: 'send', mode: 'queue-if-active', input }), ...extra
  });
}
const key = (row: { id: string }) => ({ id: row.id, threadId });
const inputs = (deliver: ReturnType<typeof vi.fn>) => deliver.mock.calls.map(([payload]) => (payload as DeferredSendPayload).input);

describe('hold, renew and release', () => {
  it('leases the row for a bounded time and renews by replacing the deadline', () => {
    const row = queue();
    const first = holdDeferredConversationMessageForEdit(context, threadId, row.id, 1_000);
    expect(first).toEqual({ leaseMs: DEFERRED_EDIT_HOLD_LEASE_MS, heldUntil: 1_000 + DEFERRED_EDIT_HOLD_LEASE_MS });
    expect(DEFERRED_EDIT_HOLD_LEASE_MS).toBe(120_000);
    const renewed = holdDeferredConversationMessageForEdit(context, threadId, row.id, 31_000);
    expect(renewed.heldUntil).toBe(31_000 + DEFERRED_EDIT_HOLD_LEASE_MS);
    expect(getDeferredThreadMessage(db, key(row))).toMatchObject({ editHeldUntil: renewed.heldUntil, updatedAt: row.updatedAt });
  });

  it('answers 404 for an unknown thread, an unknown row and a row of another thread, and 409 once the row is in flight', async () => {
    const row = queue('mine');
    expect(() => holdDeferredConversationMessageForEdit(context, 'missing', row.id)).toThrowError(expect.objectContaining({ status: 404, code: 'unknown-thread' }));
    expect(() => holdDeferredConversationMessageForEdit(context, otherThreadId, row.id)).toThrowError(expect.objectContaining({ status: 404, code: 'unknown-queued-send' }));
    expect(() => holdDeferredConversationMessageForEdit(context, threadId, 'missing')).toThrowError(expect.objectContaining({ status: 404, code: 'unknown-queued-send' }));
    expect(getDeferredThreadMessage(db, key(row))?.editHeldUntil).toBeNull();

    const deliver = vi.fn(() => new Promise<void>(() => undefined));
    void flushDeferredConversationMessages(context, threadId, deliver);
    expect(getDeferredThreadMessage(db, key(row))?.status).toBe('dispatching');
    expect(() => holdDeferredConversationMessageForEdit(context, threadId, row.id)).toThrowError(expect.objectContaining({ status: 409, code: 'queued-send-dispatching' }));
    expect(() => saveDeferredConversationMessageEdit(context, threadId, row.id, { text: 'late' })).toThrowError(expect.objectContaining({ status: 409, code: 'queued-send-dispatching' }));
  });

  it('releases idempotently and never throws for a row that is already gone', () => {
    const row = queue();
    expect(releaseDeferredConversationMessageEditHold(context, threadId, row.id)).toBe(false);
    holdDeferredConversationMessageForEdit(context, threadId, row.id);
    expect(releaseDeferredConversationMessageEditHold(context, otherThreadId, row.id)).toBe(false);
    expect(getDeferredThreadMessage(db, key(row))?.editHeldUntil).not.toBeNull();
    expect(releaseDeferredConversationMessageEditHold(context, threadId, row.id)).toBe(true);
    expect(releaseDeferredConversationMessageEditHold(context, threadId, row.id)).toBe(false);
    expect(releaseDeferredConversationMessageEditHold(context, threadId, 'missing')).toBe(false);
    expect(() => releaseDeferredConversationMessageEditHold(context, 'missing', row.id)).toThrowError(expect.objectContaining({ status: 404, code: 'unknown-thread' }));
  });
});

describe('the drain honours the hold', () => {
  it('does not send a held row, then sends the unchanged text once the editor cancels', async () => {
    const row = queue('original');
    holdDeferredConversationMessageForEdit(context, threadId, row.id);
    const deliver = vi.fn(async () => undefined);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 0, delayed: 'edit-held' });
    expect(deliver).not.toHaveBeenCalled();
    expect(getDeferredThreadMessage(db, key(row))).toMatchObject({ status: 'queued' });

    releaseDeferredConversationMessageEditHold(context, threadId, row.id);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 1 });
    expect(inputs(deliver)).toEqual(['original']);
  });

  it('sends the edited text, not the pre-edit text, after a save', async () => {
    const row = queue('original');
    holdDeferredConversationMessageForEdit(context, threadId, row.id);
    const saved = saveDeferredConversationMessageEdit(context, threadId, row.id, { text: 'edited', expectedUpdatedAt: row.updatedAt });
    expect(saved).toMatchObject({ releasedEditHold: true, item: { id: row.id, text: 'edited' } });
    const deliver = vi.fn(async () => undefined);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 1 });
    expect(inputs(deliver)).toEqual(['edited']);
  });

  it('stops at the first held group so the rows behind it still go after it', async () => {
    const first = queue('first', { groupBoundaryId: 'g1' });
    const held = queue('held', { groupBoundaryId: 'g2' });
    const behind = queue('behind', { groupBoundaryId: 'g3' });
    holdDeferredConversationMessageForEdit(context, threadId, held.id);
    const deliver = vi.fn(async () => undefined);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 1, delayed: 'edit-held' });
    expect(inputs(deliver)).toEqual(['first']);
    expect(listDeferredThreadMessages(db, threadId).map(row => row.id)).toEqual([held.id, behind.id]);
    expect(getDeferredThreadMessage(db, key(first))).toBeNull();

    releaseDeferredConversationMessageEditHold(context, threadId, held.id);
    await flushDeferredConversationMessages(context, threadId, deliver);
    expect(inputs(deliver)).toEqual(['first', 'held', 'behind']);
  });

  it('treats a group as held when any member is held, and never splits the batch', async () => {
    queue('a', { groupBoundaryId: 'same' });
    const second = queue('b', { groupBoundaryId: 'same' });
    holdDeferredConversationMessageForEdit(context, threadId, second.id);
    const deliver = vi.fn(async () => undefined);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 0, delayed: 'edit-held' });
    expect(deliver).not.toHaveBeenCalled();
    expect(listDeferredThreadMessages(db, threadId).every(row => row.status === 'queued')).toBe(true);
  });

  it('ignores a held row that is not yet due so it cannot stall the rest of the queue', async () => {
    const later = queue('later', { sendAfter: Date.now() + 3_600_000 });
    holdDeferredConversationMessageForEdit(context, threadId, later.id);
    queue('now');
    const deliver = vi.fn(async () => undefined);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 1 });
    expect(inputs(deliver)).toEqual(['now']);
  });

  it('lets an abandoned lease lapse by itself, with no cleanup, and sends the row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const row = queue('abandoned');
    holdDeferredConversationMessageForEdit(context, threadId, row.id);
    const deliver = vi.fn(async () => undefined);
    vi.setSystemTime(1_000_000 + DEFERRED_EDIT_HOLD_LEASE_MS - 1);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 0, delayed: 'edit-held' });
    vi.setSystemTime(1_000_000 + DEFERRED_EDIT_HOLD_LEASE_MS);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 1 });
    expect(inputs(deliver)).toEqual(['abandoned']);
  });

  it('lets an explicit force flush and an explicit send claim a held row, then reports the editor as claimed', async () => {
    const forced = queue('forced');
    holdDeferredConversationMessageForEdit(context, threadId, forced.id);
    const deliver = vi.fn(async () => undefined);
    await expect(flushDeferredConversationMessages(context, threadId, deliver, { force: true })).resolves.toEqual({ flushed: 1 });
    expect(inputs(deliver)).toEqual(['forced']);
    expect(() => holdDeferredConversationMessageForEdit(context, threadId, forced.id)).toThrowError(expect.objectContaining({ status: 404 }));

    const explicit = queue('explicit');
    holdDeferredConversationMessageForEdit(context, threadId, explicit.id);
    const send = vi.fn(async () => undefined);
    await sendDeferredConversationMessage(context, threadId, explicit.id, send);
    expect(inputs(send)).toEqual(['explicit']);
    expect(getDeferredThreadMessage(db, key(explicit))).toBeNull();
  });
});

describe('lapsed-hold sweep', () => {
  it('wakes each thread with a lapsed lease once and leaves live leases alone', async () => {
    const lapsed = queue('lapsed');
    const stillLive = createDeferredThreadMessage(db, { threadId: otherThreadId, kind: 'send', payload: JSON.stringify({ kind: 'send', input: 'live', mode: 'auto' }) });
    holdDeferredThreadMessageForEdit(db, { ...key(lapsed), heldUntil: 5_000 });
    holdDeferredThreadMessageForEdit(db, { id: stillLive.id, threadId: otherThreadId, heldUntil: 50_000 });
    const flush = vi.fn(async () => undefined);
    await wakeLapsedEditHolds(context, flush, 10_000);
    expect(flush.mock.calls).toEqual([[threadId]]);
    expect(getDeferredThreadMessage(db, key(lapsed))?.editHeldUntil).toBeNull();
    expect(getDeferredThreadMessage(db, { id: stillLive.id, threadId: otherThreadId })?.editHeldUntil).toBe(50_000);
    await wakeLapsedEditHolds(context, flush, 10_000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('keeps waking the other threads when one wake fails', async () => {
    const a = queue('a');
    const b = createDeferredThreadMessage(db, { threadId: otherThreadId, kind: 'send', payload: JSON.stringify({ kind: 'send', input: 'b', mode: 'auto' }) });
    holdDeferredThreadMessageForEdit(db, { ...key(a), heldUntil: 1 });
    holdDeferredThreadMessageForEdit(db, { id: b.id, threadId: otherThreadId, heldUntil: 1 });
    const flush = vi.fn(async (id: string) => { if (id === threadId) throw new Error('host down'); });
    await expect(wakeLapsedEditHolds(context, flush, 10)).resolves.toBeUndefined();
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

describe('saving an edit', () => {
  it('replaces plain text and moves the revision so other tabs must reconfirm', () => {
    const row = queue('original');
    const saved = saveDeferredConversationMessageEdit(context, threadId, row.id, { text: '  edited  ' });
    expect(saved.item).toMatchObject({ text: 'edited', status: 'queued' });
    expect(saved.item.updatedAt).toBeGreaterThan(row.updatedAt);
    expect(saved.releasedEditHold).toBe(false);
    expect(JSON.parse(getDeferredThreadMessage(db, key(row))!.payload)).toEqual({ kind: 'send', mode: 'queue-if-active', input: '  edited  ' });
  });

  it('keeps attachments, execution settings and the sender, replacing only the text part and its stale mentions', () => {
    const row = createDeferredThreadMessage(db, {
      threadId, kind: 'send',
      payload: JSON.stringify({
        kind: 'send', mode: 'auto', senderThreadId: 'thr_sender', execution: { model: 'm' },
        input: [{ type: 'image', url: 'a.png' }, { type: 'text', text: 'one', mentions: [{ start: 0 }] }, { type: 'text', text: 'two', mentions: [] }]
      })
    });
    saveDeferredConversationMessageEdit(context, threadId, row.id, { text: 'rewritten' });
    expect(JSON.parse(getDeferredThreadMessage(db, key(row))!.payload)).toEqual({
      kind: 'send', mode: 'auto', senderThreadId: 'thr_sender', execution: { model: 'm' },
      input: [{ type: 'image', url: 'a.png' }, { type: 'text', text: 'rewritten', mentions: [] }]
    });
  });

  it('adds a text part to an attachment-only message and refuses to empty a message with nothing else', () => {
    const attachmentOnly = queue([{ type: 'image', url: 'a.png' }]);
    saveDeferredConversationMessageEdit(context, threadId, attachmentOnly.id, { text: 'caption' });
    expect(JSON.parse(getDeferredThreadMessage(db, key(attachmentOnly))!.payload).input).toEqual([{ type: 'text', text: 'caption', mentions: [] }, { type: 'image', url: 'a.png' }]);
    saveDeferredConversationMessageEdit(context, threadId, attachmentOnly.id, { text: '   ' });
    expect(JSON.parse(getDeferredThreadMessage(db, key(attachmentOnly))!.payload).input).toEqual([{ type: 'image', url: 'a.png' }]);

    const plain = queue('keep me');
    expect(() => saveDeferredConversationMessageEdit(context, threadId, plain.id, { text: '  ' })).toThrowError(expect.objectContaining({ status: 400, code: 'empty_queued_message' }));
    expect(getDeferredThreadMessage(db, key(plain))).toEqual(plain);
  });

  it('bounds the edited text', () => {
    const row = queue('keep me');
    expect(() => saveDeferredConversationMessageEdit(context, threadId, row.id, { text: 'x'.repeat(MAX_QUEUED_EDIT_TEXT_CHARS + 1) })).toThrowError(expect.objectContaining({ status: 413, code: 'queued_message_too_long' }));
    expect(() => saveDeferredConversationMessageEdit(context, threadId, row.id, { text: 'x'.repeat(MAX_QUEUED_EDIT_TEXT_CHARS) })).not.toThrow();
  });

  it('rejects an unknown thread, a missing or foreign row, a stale revision and a malformed stored payload without writing', () => {
    const row = queue('original');
    const foreign = createDeferredThreadMessage(db, { threadId: otherThreadId, kind: 'send', payload: JSON.stringify({ kind: 'send', input: 'foreign', mode: 'auto' }) });
    const malformed = createDeferredThreadMessage(db, { threadId, kind: 'send', payload: 'not json' });
    expect(() => saveDeferredConversationMessageEdit(context, 'missing', row.id, { text: 'x' })).toThrowError(expect.objectContaining({ status: 404, code: 'unknown-thread' }));
    expect(() => saveDeferredConversationMessageEdit(context, threadId, 'missing', { text: 'x' })).toThrowError(expect.objectContaining({ status: 404, code: 'unknown-queued-send' }));
    expect(() => saveDeferredConversationMessageEdit(context, threadId, foreign.id, { text: 'x' })).toThrowError(expect.objectContaining({ status: 404, code: 'unknown-queued-send' }));
    expect(() => saveDeferredConversationMessageEdit(context, threadId, row.id, { text: 'x', expectedUpdatedAt: row.updatedAt - 1 })).toThrowError(expect.objectContaining({ status: 409, code: 'queued-send-changed' }));
    expect(() => saveDeferredConversationMessageEdit(context, threadId, malformed.id, { text: 'x' })).toThrowError(expect.objectContaining({ status: 422, code: 'malformed-queued-send' }));
    expect(getDeferredThreadMessage(db, key(row))).toEqual(row);
    expect(getDeferredThreadMessage(db, { id: foreign.id, threadId: otherThreadId })).toEqual(foreign);
    expect(getDeferredThreadMessage(db, key(malformed))).toEqual(malformed);
  });
});

describe('concurrent writers stay serialized', () => {
  it('lets exactly one of several saves against the same revision win', () => {
    const row = queue('original');
    const outcomes = ['a', 'b', 'c'].map(text => {
      try { return saveDeferredConversationMessageEdit(context, threadId, row.id, { text, expectedUpdatedAt: row.updatedAt }).item.text; } catch (error) { return (error as ThreadCreateError).code; }
    });
    expect(outcomes).toEqual(['a', 'queued-send-changed', 'queued-send-changed']);
    expect(JSON.parse(getDeferredThreadMessage(db, key(row))!.payload).input).toBe('a');
  });

  it('sends exactly one version when the drain and a save race, and tells the loser', async () => {
    const claimedFirst = queue('claimed first');
    const deliver = vi.fn(async () => undefined);
    const draining = flushDeferredConversationMessages(context, threadId, deliver);
    expect(() => saveDeferredConversationMessageEdit(context, threadId, claimedFirst.id, { text: 'too late' })).toThrowError(expect.objectContaining({ status: 409, code: 'queued-send-dispatching' }));
    await draining;
    expect(inputs(deliver)).toEqual(['claimed first']);

    const savedFirst = queue('before');
    saveDeferredConversationMessageEdit(context, threadId, savedFirst.id, { text: 'after' });
    await flushDeferredConversationMessages(context, threadId, deliver);
    expect(inputs(deliver)).toEqual(['claimed first', 'after']);
  });

  it('treats a renewal that lands after the save as a fresh lease on the saved revision', () => {
    const row = queue('original');
    holdDeferredConversationMessageForEdit(context, threadId, row.id);
    holdDeferredConversationMessageForEdit(context, threadId, row.id);
    const saved = saveDeferredConversationMessageEdit(context, threadId, row.id, { text: 'edited', expectedUpdatedAt: row.updatedAt });
    expect(saved.releasedEditHold).toBe(true);
    expect(getDeferredThreadMessage(db, key(row))?.editHeldUntil).toBeNull();
    holdDeferredConversationMessageForEdit(context, threadId, row.id);
    expect(getDeferredThreadMessage(db, key(row))).toMatchObject({ updatedAt: saved.item.updatedAt });
    expect(getDeferredThreadMessage(db, key(row))?.editHeldUntil).not.toBeNull();
    expect(releaseDeferredConversationMessageEditHold(context, threadId, row.id)).toBe(true);
  });
});

describe('preparing dispatches serialize automatic drains', () => {
  it.each([false, true])('waits for a preparing group, including force=%s, while other threads can drain', async force => {
    queue('first', { groupBoundaryId: 'group' });
    queue('also first', { groupBoundaryId: 'group' });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const firstDeliver = vi.fn(async () => { await gate; });
    const first = flushDeferredConversationMessages(context, threadId, firstDeliver);
    const second = queue('second');
    const secondDeliver = vi.fn(async () => undefined);
    try {
      expect(firstDeliver).toHaveBeenCalledWith(expect.objectContaining({ input: ['first', 'also first'] }));
      await expect(flushDeferredConversationMessages(context, threadId, secondDeliver, { force })).resolves.toEqual({ flushed: 0, delayed: 'dispatch-in-progress' });
      expect(secondDeliver).not.toHaveBeenCalled();
      expect(getDeferredThreadMessage(db, key(second))?.status).toBe('queued');
      queue('other thread', { threadId: otherThreadId });
      await expect(flushDeferredConversationMessages(context, otherThreadId, secondDeliver)).resolves.toEqual({ flushed: 1 });
      expect(inputs(secondDeliver)).toEqual(['other thread']);
    } finally { release(); await first; }
    // The original drain picks up the waiting message after its preparation completes.
    expect(inputs(firstDeliver)).toEqual([['first', 'also first'], 'second']);
    expect(listDeferredThreadMessages(db, threadId)).toEqual([]);
  });

  it('lets an explicit single-row send proceed and holds automatic neighbors until it settles', async () => {
    const explicit = queue('explicit');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const send = sendDeferredConversationMessage(context, threadId, explicit.id, async () => { await gate; });
    queue('next');
    const deliver = vi.fn(async () => undefined);
    try {
      await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toMatchObject({ flushed: 0, delayed: 'dispatch-in-progress' });
      expect(deliver).not.toHaveBeenCalled();
    } finally { release(); await send; }
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 1 });
    expect(inputs(deliver)).toEqual(['next']);
  });

  it('releases the preparation claim after failure so the next drain can send', async () => {
    queue('fails');
    const result = await flushDeferredConversationMessages(context, threadId, async () => { throw new Error('rejected'); });
    expect(result).toEqual({ flushed: 0, delayed: 'dispatch-failed' });
    queue('next');
    const deliver = vi.fn(async () => undefined);
    await expect(flushDeferredConversationMessages(context, threadId, deliver)).resolves.toEqual({ flushed: 1 });
    expect(inputs(deliver)).toEqual(['next']);
  });
});
