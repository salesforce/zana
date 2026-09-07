import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConversationThread,
  createEnvironment,
  openDatabase,
  pinConversationThread,
  unpinConversationThread,
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

describe('thread pin columns', () => {
  it('pins, orders, and unpins a thread', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-pin-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'idle'
    });
    const pinned = pinConversationThread(db, thread.id);
    expect(pinned?.pinnedAt).toBeGreaterThan(0);
    expect(pinned?.pinOrder).toBe(1);
    const unpinned = unpinConversationThread(db, thread.id);
    expect(unpinned?.pinnedAt).toBeNull();
    expect(unpinned?.pinOrder).toBeNull();
  });
});
