import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../connection.js';
import { createConversationThread } from './conversation-threads.js';
import { createEnvironment } from './environments.js';
import { upsertHost } from './hosts.js';
import {
  clearLapsedDeferredEditHolds, createDeferredThreadMessage, getDeferredThreadMessage,
  holdDeferredThreadMessageForEdit, listDeferredThreadMessages, markDeferredThreadMessageDispatching,
  markDeferredThreadMessageFailed, releaseDeferredThreadMessageEditHold, updateDeferredThreadMessagePayload
} from './deferred-thread-messages.js';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-edit-hold-'));
  const db = openDatabase(join(dir, 'runtime.sqlite'));
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const host = upsertHost(db, { name: 'host', hostKeyHash: 'hash' });
  const environment = createEnvironment(db, { projectId: 'project', hostId: host.id });
  const make = () => createConversationThread(db, { projectId: 'project', hostId: host.id, environmentId: environment.id, providerId: 'fake' });
  const thread = make();
  const queue = (threadId = thread.id, input = 'original') => createDeferredThreadMessage(db, {
    threadId, kind: 'send', payload: JSON.stringify({ kind: 'send', input, mode: 'auto' })
  });
  return { db, thread, otherThread: make(), queue };
}

describe('queued-message edit hold', () => {
  it('holds a queued row without touching its revision and lets the lease lapse by itself', () => {
    const { db, thread, queue } = fixture();
    const row = queue();
    const key = { id: row.id, threadId: thread.id };
    expect(row.editHeldUntil).toBeNull();
    expect(holdDeferredThreadMessageForEdit(db, { ...key, heldUntil: 10_000 })).toBe('held');
    expect(getDeferredThreadMessage(db, key)).toEqual({ ...row, editHeldUntil: 10_000 });
    // The editor's later save still carries the revision the user opened.
    expect(getDeferredThreadMessage(db, key)?.updatedAt).toBe(row.updatedAt);
    // Renewing replaces the deadline.
    expect(holdDeferredThreadMessageForEdit(db, { ...key, heldUntil: 20_000 })).toBe('held');
    expect(getDeferredThreadMessage(db, key)?.editHeldUntil).toBe(20_000);

    expect(markDeferredThreadMessageDispatching(db, { ...key, now: 19_999 })).toBe(false);
    expect(getDeferredThreadMessage(db, key)).toMatchObject({ status: 'queued', editHeldUntil: 20_000 });
    // A lease is a deadline, not a flag: nothing needs to run for it to lapse.
    expect(markDeferredThreadMessageDispatching(db, { ...key, now: 20_000 })).toBe(true);
    expect(getDeferredThreadMessage(db, key)).toMatchObject({ status: 'dispatching', editHeldUntil: null });
  });

  it('answers not_found for an unknown or foreign row and claimed for a row already in flight or failed', () => {
    const { db, thread, otherThread, queue } = fixture();
    const row = queue();
    expect(holdDeferredThreadMessageForEdit(db, { id: 'missing', threadId: thread.id, heldUntil: 1 })).toBe('not_found');
    expect(holdDeferredThreadMessageForEdit(db, { id: row.id, threadId: otherThread.id, heldUntil: 1 })).toBe('not_found');
    expect(getDeferredThreadMessage(db, { id: row.id, threadId: thread.id })?.editHeldUntil).toBeNull();

    expect(markDeferredThreadMessageDispatching(db, { id: row.id, threadId: thread.id })).toBe(true);
    expect(holdDeferredThreadMessageForEdit(db, { id: row.id, threadId: thread.id, heldUntil: 1 })).toBe('claimed');
    markDeferredThreadMessageFailed(db, { id: row.id, threadId: thread.id, reason: 'boom' });
    expect(holdDeferredThreadMessageForEdit(db, { id: row.id, threadId: thread.id, heldUntil: 1 })).toBe('claimed');
    expect(getDeferredThreadMessage(db, { id: row.id, threadId: thread.id })?.editHeldUntil).toBeNull();
  });

  it('lets an explicit send claim a held row and clears the stale hold so the editor learns it was sent', () => {
    const { db, thread, queue } = fixture();
    const row = queue();
    const key = { id: row.id, threadId: thread.id };
    holdDeferredThreadMessageForEdit(db, { ...key, heldUntil: Date.now() + 60_000 });
    expect(markDeferredThreadMessageDispatching(db, key)).toBe(false);
    expect(markDeferredThreadMessageDispatching(db, { ...key, overrideEditHold: true })).toBe(true);
    expect(getDeferredThreadMessage(db, key)).toMatchObject({ status: 'dispatching', editHeldUntil: null });
    expect(holdDeferredThreadMessageForEdit(db, { ...key, heldUntil: Date.now() + 60_000 })).toBe('claimed');
  });

  it('releases idempotently and only for the owning thread', () => {
    const { db, thread, otherThread, queue } = fixture();
    const row = queue();
    const key = { id: row.id, threadId: thread.id };
    expect(releaseDeferredThreadMessageEditHold(db, key)).toBe(false);
    holdDeferredThreadMessageForEdit(db, { ...key, heldUntil: 99_999 });
    expect(releaseDeferredThreadMessageEditHold(db, { ...key, threadId: otherThread.id })).toBe(false);
    expect(getDeferredThreadMessage(db, key)?.editHeldUntil).toBe(99_999);
    expect(releaseDeferredThreadMessageEditHold(db, key)).toBe(true);
    expect(releaseDeferredThreadMessageEditHold(db, key)).toBe(false);
    expect(getDeferredThreadMessage(db, key)).toEqual(row);
    expect(releaseDeferredThreadMessageEditHold(db, { id: 'missing', threadId: thread.id })).toBe(false);
  });

  it('saves the edit in one write that clears the hold and always moves the revision forward', () => {
    const { db, thread, queue } = fixture();
    const row = queue();
    const key = { id: row.id, threadId: thread.id };
    holdDeferredThreadMessageForEdit(db, { ...key, heldUntil: Date.now() + 60_000 });
    const payload = JSON.stringify({ kind: 'send', input: 'edited', mode: 'auto' });
    const result = updateDeferredThreadMessagePayload(db, { ...key, payload, expectedUpdatedAt: row.updatedAt, now: row.updatedAt });
    expect(result).toMatchObject({ kind: 'updated', releasedEditHold: true });
    // A same-millisecond save must still change the revision other tabs confirm against.
    expect(getDeferredThreadMessage(db, key)).toMatchObject({ payload, editHeldUntil: null, updatedAt: row.updatedAt + 1 });
    expect(result.kind === 'updated' && result.row).toEqual(getDeferredThreadMessage(db, key));
    expect(markDeferredThreadMessageDispatching(db, key)).toBe(true);
  });

  it('reports releasedEditHold=false when the row was not held', () => {
    const { db, thread, queue } = fixture();
    const row = queue();
    expect(updateDeferredThreadMessagePayload(db, { id: row.id, threadId: thread.id, payload: '{"kind":"send","input":"x","mode":"auto"}' }))
      .toMatchObject({ kind: 'updated', releasedEditHold: false });
  });

  it('refuses a stale, foreign, missing or already-claimed save without writing', () => {
    const { db, thread, otherThread, queue } = fixture();
    const row = queue();
    const key = { id: row.id, threadId: thread.id };
    const payload = JSON.stringify({ kind: 'send', input: 'edited', mode: 'auto' });
    holdDeferredThreadMessageForEdit(db, { ...key, heldUntil: 5_000 });
    expect(updateDeferredThreadMessagePayload(db, { ...key, payload, expectedUpdatedAt: row.updatedAt - 1 })).toEqual({ kind: 'stale' });
    expect(updateDeferredThreadMessagePayload(db, { ...key, threadId: otherThread.id, payload })).toEqual({ kind: 'not_found' });
    expect(updateDeferredThreadMessagePayload(db, { id: 'missing', threadId: thread.id, payload })).toEqual({ kind: 'not_found' });
    expect(getDeferredThreadMessage(db, key)).toEqual({ ...row, editHeldUntil: 5_000 });

    expect(markDeferredThreadMessageDispatching(db, { ...key, overrideEditHold: true })).toBe(true);
    expect(updateDeferredThreadMessagePayload(db, { ...key, payload })).toEqual({ kind: 'claimed' });
    expect(getDeferredThreadMessage(db, key)?.payload).toBe(row.payload);
  });

  it('sweeps only lapsed holds on queued rows, once, in bounded batches, returning each thread once', () => {
    const { db, thread, otherThread, queue } = fixture();
    const a = queue(thread.id, 'a');
    const b = queue(thread.id, 'b');
    const c = queue(otherThread.id, 'c');
    const live = queue(otherThread.id, 'live');
    holdDeferredThreadMessageForEdit(db, { id: a.id, threadId: thread.id, heldUntil: 1_000 });
    holdDeferredThreadMessageForEdit(db, { id: b.id, threadId: thread.id, heldUntil: 1_500 });
    holdDeferredThreadMessageForEdit(db, { id: c.id, threadId: otherThread.id, heldUntil: 2_000 });
    holdDeferredThreadMessageForEdit(db, { id: live.id, threadId: otherThread.id, heldUntil: 9_000 });

    expect(clearLapsedDeferredEditHolds(db, 999)).toEqual([]);
    expect(clearLapsedDeferredEditHolds(db, 1_500, 1)).toEqual([thread.id]);
    expect(getDeferredThreadMessage(db, { id: a.id, threadId: thread.id })?.editHeldUntil).toBeNull();
    expect(getDeferredThreadMessage(db, { id: b.id, threadId: thread.id })?.editHeldUntil).toBe(1_500);
    expect(clearLapsedDeferredEditHolds(db, 5_000).sort()).toEqual([thread.id, otherThread.id].sort());
    expect(clearLapsedDeferredEditHolds(db, 5_000)).toEqual([]);
    expect(listDeferredThreadMessages(db, otherThread.id).map(row => row.editHeldUntil)).toEqual([null, 9_000]);
  });

  it('creates the partial index that keeps the sweep off a full-table scan', () => {
    const { db } = fixture();
    const indexes = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'deferred_thread_messages'").all() as Array<{ name: string }>;
    expect(indexes.map(index => index.name)).toContain('deferred_thread_messages_edit_hold_idx');
  });
});
