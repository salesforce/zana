import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { openDatabase, upsertHost, createEnvironment, createConversationThread,
  createDeferredThreadMessage, deleteDeferredThreadMessagesForThread, isThreadQueueAutoSendPaused,
  pauseDeferredThreadMessagesForThread, resumeDeferredThreadMessagesForThread } from '../index.js';

it('persists an empty queue pause through new messages, deletion and restart until explicitly resumed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-queue-pause-'));
  let db = openDatabase(join(dir, 'db.sqlite'));
  try {
    const host = upsertHost(db, { name: 'host', hostKeyHash: 'b'.repeat(64) });
    const env = createEnvironment(db, { hostId: host.id, projectId: 'p1', path: dir });
    const thread = createConversationThread(db, { projectId: 'p1', hostId: host.id, environmentId: env.id, providerId: 'fake' });
    expect(isThreadQueueAutoSendPaused(db, thread.id)).toBe(false);
    expect(pauseDeferredThreadMessagesForThread(db, thread.id)).toBe(0);
    expect(isThreadQueueAutoSendPaused(db, thread.id)).toBe(true);
    createDeferredThreadMessage(db, { threadId: thread.id, kind: 'send', payload: '{}', paused: true });
    deleteDeferredThreadMessagesForThread(db, thread.id);
    db.close(); db = openDatabase(join(dir, 'db.sqlite'));
    expect(isThreadQueueAutoSendPaused(db, thread.id)).toBe(true);
    expect(resumeDeferredThreadMessagesForThread(db, thread.id)).toBe(0);
    expect(isThreadQueueAutoSendPaused(db, thread.id)).toBe(false);
    for (let i = 0; i < 5; i++) { pauseDeferredThreadMessagesForThread(db, thread.id); resumeDeferredThreadMessagesForThread(db, thread.id); }
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM thread_events WHERE type = 'client/queue/state'").get()).toEqual({ count: 1 });
    expect(pauseDeferredThreadMessagesForThread(db, 'unknown')).toBe(0);
    expect(resumeDeferredThreadMessagesForThread(db, 'unknown')).toBe(0);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
