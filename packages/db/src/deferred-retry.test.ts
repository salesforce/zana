import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, upsertHost, createConversationThread, createDeferredThreadMessage,
  markDeferredThreadMessageDispatching, markDeferredThreadMessageFailed, listDeferredThreadMessages,
  listRetryableDeferredThreadMessages, retryDeferredThreadMessage, requeueDeferredThreadMessagesForThread,
  pauseDeferredThreadMessagesForThread, resumeDeferredThreadMessagesForThread,
  recoverInterruptedDeferredThreadMessages, countDeferredThreadMessages, DEFERRED_RETRY_DELAYS_MS } from './index.js';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-queue-retry-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const host = upsertHost(db, { name: 'test', hostKeyHash: 'a'.repeat(64) });
  const thread = createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'codex' });
  const row = createDeferredThreadMessage(db, { threadId: thread.id, kind: 'send', payload: '{}' });
  return { db, row };
}
describe('durable queued-send recovery', () => {
  it('backs off three times, atomically claims retries, then leaves manual recovery', () => {
    const { db, row } = setup();
    let now = 1000;
    for (const delay of DEFERRED_RETRY_DELAYS_MS) {
      expect(markDeferredThreadMessageDispatching(db, row)).toBe(true);
      markDeferredThreadMessageFailed(db, { ...row, reason: 'busy', retryable: true, now });
      expect(listRetryableDeferredThreadMessages(db, now + delay - 1)).toEqual([]);
      now += delay;
      expect(listRetryableDeferredThreadMessages(db, now)).toHaveLength(1);
      expect(retryDeferredThreadMessage(db, row, now)).toBe(true);
      expect(retryDeferredThreadMessage(db, row, now)).toBe(false);
    }
    markDeferredThreadMessageFailed(db, { ...row, reason: 'busy', retryable: true, now });
    expect(listRetryableDeferredThreadMessages(db, now + 999999)).toEqual([]);
    expect(listDeferredThreadMessages(db, row.threadId)[0]).toMatchObject({ failureCount: 4, retryAt: null });
    expect(countDeferredThreadMessages(db, row.threadId)).toBe(1);
    expect(requeueDeferredThreadMessagesForThread(db, row.threadId)).toBe(1);
    expect(listDeferredThreadMessages(db, row.threadId)[0]).toMatchObject({ failureCount: 0, status: 'queued' });
  });
  it('preserves manual pause through failure and never steals an in-flight claim', () => {
    const { db, row } = setup();
    markDeferredThreadMessageDispatching(db, row);
    expect(requeueDeferredThreadMessagesForThread(db, row.threadId)).toBe(0);
    pauseDeferredThreadMessagesForThread(db, row.threadId);
    markDeferredThreadMessageFailed(db, { ...row, reason: 'busy', retryable: true, now: 1 });
    expect(listRetryableDeferredThreadMessages(db, 20000)).toEqual([]);
    expect(retryDeferredThreadMessage(db, row, 20000)).toBe(false);
    resumeDeferredThreadMessagesForThread(db, row.threadId);
    expect(listRetryableDeferredThreadMessages(db, 20000)).toHaveLength(1);
  });
  it('does not automatically resend ambiguous or interrupted deliveries', () => {
    const { db, row } = setup();
    markDeferredThreadMessageFailed(db, { ...row, reason: 'timed out', now: 1 });
    expect(listRetryableDeferredThreadMessages(db, 999999)).toEqual([]);
    markDeferredThreadMessageDispatching(db, { ...row, retryFailed: true });
    expect(recoverInterruptedDeferredThreadMessages(db)).toBe(1);
    expect(recoverInterruptedDeferredThreadMessages(db)).toBe(0);
    expect(listDeferredThreadMessages(db, row.threadId)[0]).toMatchObject({ status: 'failed', retryAt: null });
  });
});
