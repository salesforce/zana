import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../connection.js';
import { createConversationThread } from './conversation-threads.js';
import { createEnvironment } from './environments.js';
import { upsertHost } from './hosts.js';
import { createDeferredThreadMessage, deleteDeferredThreadMessage, getDeferredThreadMessage, holdDeferredThreadMessage, markDeferredThreadMessageDispatching, pauseDeferredThreadMessagesForThread } from './deferred-thread-messages.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-queue-approval-'));
  const db = openDatabase(join(dir, 'runtime.sqlite'));
  const host = upsertHost(db, { name: 'host', hostKeyHash: 'hash' });
  const environment = createEnvironment(db, { projectId: 'project', hostId: host.id });
  const thread = createConversationThread(db, { projectId: 'project', hostId: host.id, environmentId: environment.id, providerId: 'fake' });
  const row = createDeferredThreadMessage(db, { threadId: thread.id, kind: 'send', payload: JSON.stringify({ kind: 'send', input: 'original', mode: 'auto' }) });
  return { db, row, key: { id: row.id, threadId: thread.id }, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

it('atomically refuses an approval for a changed or foreign row and claims a matching row only once', () => {
  const { db, row, key, cleanup } = fixture();
  try {
    expect(markDeferredThreadMessageDispatching(db, { ...key, expectedUpdatedAt: row.updatedAt - 1 })).toBe(false);
    expect(markDeferredThreadMessageDispatching(db, { ...key, threadId: 'foreign' })).toBe(false);
    expect(getDeferredThreadMessage(db, key)).toEqual(row);
    expect(markDeferredThreadMessageDispatching(db, { ...key, expectedUpdatedAt: row.updatedAt })).toBe(true);
    expect(markDeferredThreadMessageDispatching(db, key)).toBe(false);
  } finally { cleanup(); }
});

it('requires explicit failed-row retry and retains a stopped row on plugin wait without recreating removed work', () => {
  const { db, key, cleanup } = fixture();
  try {
    db.sqlite.prepare("UPDATE deferred_thread_messages SET status = 'failed' WHERE id = ?").run(key.id);
    expect(markDeferredThreadMessageDispatching(db, key)).toBe(false);
    expect(markDeferredThreadMessageDispatching(db, { ...key, retryFailed: true })).toBe(true);
    pauseDeferredThreadMessagesForThread(db, key.threadId);
    const payload = JSON.stringify({ kind: 'send', input: 'original', admission: { generation: 3 } });
    expect(holdDeferredThreadMessage(db, { ...key, payload })).toBe(true);
    expect(getDeferredThreadMessage(db, key)).toMatchObject({ id: key.id, status: 'queued', paused: true, payload });
    expect(holdDeferredThreadMessage(db, { ...key, payload })).toBe(false);
    expect(markDeferredThreadMessageDispatching(db, key)).toBe(true);
    deleteDeferredThreadMessage(db, key);
    expect(holdDeferredThreadMessage(db, { ...key, payload })).toBe(false);
    expect(getDeferredThreadMessage(db, key)).toBeNull();
  } finally { cleanup(); }
});
