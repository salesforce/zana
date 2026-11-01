import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createConversationThread, createPendingInteraction, openDatabase, updateConversationThreadStatus, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { hasLocalThreadWork } from './local-thread-work.js';

let db: ZccDatabase;
let dir: string;
let hostId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'local-thread-work-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  hostId = upsertHost(db, { name: 'local', hostKeyHash: 'a'.repeat(64) }).id;
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

function thread(host = hostId, visibility: 'visible' | 'hidden' = 'visible') {
  return createConversationThread(db, { projectId: 'p', hostId: host, providerId: 'codex', visibility });
}

it('counts local live threads through stop cleanup, including hidden workers', () => {
  expect(hasLocalThreadWork(db, hostId)).toBe(false);
  const row = thread(hostId, 'hidden');
  for (const status of ['starting', 'active', 'stopping'] as const) {
    updateConversationThreadStatus(db, row.id, status);
    expect(hasLocalThreadWork(db, hostId)).toBe(true);
  }
  for (const status of ['idle', 'error'] as const) {
    updateConversationThreadStatus(db, row.id, status);
    expect(hasLocalThreadWork(db, hostId)).toBe(false);
  }
});

it('ignores remote work and threads waiting for user input, then resumes after resolution', () => {
  const remote = upsertHost(db, { name: 'remote', hostKeyHash: 'b'.repeat(64) }).id;
  updateConversationThreadStatus(db, thread(remote).id, 'active');
  expect(hasLocalThreadWork(db, hostId)).toBe(false);
  const row = thread();
  updateConversationThreadStatus(db, row.id, 'active');
  const interaction = createPendingInteraction(db, {
    originKind: 'plugin', threadId: row.id, pluginId: 'test', rendererId: 'test', payload: '{}'
  });
  expect(hasLocalThreadWork(db, hostId)).toBe(false);
  db.sqlite.prepare("UPDATE pending_interactions SET status = 'resolving' WHERE id = ?").run(interaction.id);
  expect(hasLocalThreadWork(db, hostId)).toBe(false);
  db.sqlite.prepare("UPDATE pending_interactions SET status = 'resolved' WHERE id = ?").run(interaction.id);
  expect(hasLocalThreadWork(db, hostId)).toBe(true);
  const other = thread();
  updateConversationThreadStatus(db, other.id, 'active');
  db.sqlite.prepare("UPDATE pending_interactions SET status = 'pending' WHERE id = ?").run(interaction.id);
  expect(hasLocalThreadWork(db, hostId)).toBe(true);
});
