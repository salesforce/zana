import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeHostSession,
  createConversationThread,
  createEnvironment,
  getLatestSessionForHost,
  listLiveConversationThreadsForHost,
  openDatabase,
  openHostSession,
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

describe('host session recovery helpers', () => {
  it('returns the latest host session even after it was closed', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-host-session-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    expect(getLatestSessionForHost(db, host.id)).toBeNull();
    const first = openHostSession(db, {
      hostId: host.id,
      instanceId: randomUUID(),
      hostName: 'laptop'
    });
    closeHostSession(db, host.id, 'socket-closed');
    expect(getLatestSessionForHost(db, host.id)).toMatchObject({
      id: first.id,
      instanceId: first.instanceId,
      status: 'closed',
      closeReason: 'socket-closed'
    });
    const second = openHostSession(db, {
      hostId: host.id,
      instanceId: randomUUID(),
      hostName: 'laptop'
    });
    expect(getLatestSessionForHost(db, host.id)?.id).toBe(second.id);
  });

  it('lists live conversation threads for one host only', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-live-threads-host-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'alpha', hostKeyHash: 'a'.repeat(64) });
    const other = upsertHost(db, { name: 'beta', hostKeyHash: 'b'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/alpha'
    });
    const live = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'active'
    });
    createConversationThread(db, {
      projectId: 'proj-1',
      hostId: other.id,
      environmentId: createEnvironment(db, {
        projectId: 'proj-1',
        hostId: other.id,
        path: '/tmp/beta'
      }).id,
      providerId: 'claude-code',
      status: 'active'
    });
    createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'idle',
      title: 'Idle'
    });
    expect(listLiveConversationThreadsForHost(db, host.id).map((row) => row.id)).toEqual([live.id]);
  });
});
