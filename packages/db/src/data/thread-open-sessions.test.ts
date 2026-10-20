import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyConversationThreadLifecycleEvent,
  archiveConversationThread,
  clearConversationSessionOpen,
  createConversationThread,
  createEnvironment,
  listOpenSessionConversationThreadsForHost,
  markConversationSessionOpen,
  openDatabase,
  upsertHost,
  type ZccDatabase
} from '../index.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function fixture() {
  dir = mkdtempSync(join(tmpdir(), 'zcc-open-sessions-'));
  db = openDatabase(join(dir, 'zcc.sqlite'));
  const database = db;
  const host = upsertHost(database, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
  const other = upsertHost(database, { name: 'server', hostKeyHash: 's'.repeat(64) });
  let count = 0;
  const thread = (hostId: string) => {
    count += 1;
    const environment = createEnvironment(database, { projectId: 'proj-1', hostId, path: `/tmp/proj-${count}` });
    return createConversationThread(database, {
      projectId: 'proj-1',
      hostId,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'idle'
    });
  };
  return { database, host, other, thread };
}

const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id);

describe('thread open sessions', () => {
  it('marks a session open when a run starts and keeps it after the run settles', () => {
    const { database, host, thread } = fixture();
    const idle = thread(host.id);
    expect(listOpenSessionConversationThreadsForHost(database, host.id, 10)).toEqual([]);
    applyConversationThreadLifecycleEvent(database, { threadId: idle.id, event: { type: 'run.started' } });
    applyConversationThreadLifecycleEvent(database, { threadId: idle.id, event: { type: 'run.succeeded' } });
    const open = listOpenSessionConversationThreadsForHost(database, host.id, 10);
    expect(ids(open)).toEqual([idle.id]);
    expect(open[0]?.status).toBe('idle');
  });

  it('does not mark a session for an event that never reaches active', () => {
    const { database, host, thread } = fixture();
    const idle = thread(host.id);
    applyConversationThreadLifecycleEvent(database, { threadId: idle.id, event: { type: 'run.preparing' } });
    expect(listOpenSessionConversationThreadsForHost(database, host.id, 10)).toEqual([]);
  });

  it('lists the host\'s unarchived open sessions, newest first, up to the limit', () => {
    const { database, host, other, thread } = fixture();
    const older = thread(host.id);
    const newer = thread(host.id);
    const archived = thread(host.id);
    const elsewhere = thread(other.id);
    markConversationSessionOpen(database, older.id, 1);
    markConversationSessionOpen(database, newer.id, 3);
    markConversationSessionOpen(database, archived.id, 4);
    markConversationSessionOpen(database, elsewhere.id, 5);
    archiveConversationThread(database, archived.id);
    expect(ids(listOpenSessionConversationThreadsForHost(database, host.id, 10))).toEqual([newer.id, older.id]);
    expect(ids(listOpenSessionConversationThreadsForHost(database, host.id, 1))).toEqual([newer.id]);
    expect(ids(listOpenSessionConversationThreadsForHost(database, host.id, 0))).toEqual([newer.id]);
    markConversationSessionOpen(database, older.id, 6);
    expect(ids(listOpenSessionConversationThreadsForHost(database, host.id, 10))).toEqual([older.id, newer.id]);
  });

  it('forgets a released session', () => {
    const { database, host, thread } = fixture();
    const released = thread(host.id);
    markConversationSessionOpen(database, released.id);
    clearConversationSessionOpen(database, released.id);
    clearConversationSessionOpen(database, released.id);
    expect(listOpenSessionConversationThreadsForHost(database, host.id, 10)).toEqual([]);
  });
});
