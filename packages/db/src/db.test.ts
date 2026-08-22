import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendThreadEvent,
  createEnvironment,
  createThread,
  getThread,
  listLiveThreads,
  listThreadEvents,
  openDatabase,
  threadOutputTail,
  upsertHost,
  type ZccDatabase
} from './index.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('packages/db', () => {
  it('migrates an empty file and reopens a durable thread', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-'));
    const file = join(dir, 'zcc.sqlite');
    db = openDatabase(file);
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const created = db.transaction(() => {
      const environment = createEnvironment(db!, {
        projectId: 'proj-1',
        hostId: host.id,
        path: '/tmp/proj',
        workspaceProvisionType: 'unmanaged'
      });
      return createThread(db!, {
        projectId: 'proj-1',
        hostId: host.id,
        environmentId: environment.id,
        providerId: 'claude'
      });
    });
    expect(created.status).toBe('starting');
    db.close();

    db = openDatabase(file);
    const restored = getThread(db, created.id);
    expect(restored).toMatchObject({
      id: created.id,
      projectId: 'proj-1',
      hostId: host.id,
      providerId: 'claude'
    });
  });

  it('assigns a monotonic server-side event sequence', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude'
    });
    const first = appendThreadEvent(db, { threadId: thread.id, kind: 'thread.started' });
    const second = appendThreadEvent(db, { threadId: thread.id, kind: 'turn.completed' });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(listThreadEvents(db, thread.id).map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('lists only starting and running threads as live', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const live = createThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude',
      status: 'running'
    });
    const done = createThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude',
      status: 'completed'
    });
    const listed = listLiveThreads(db).map((row) => row.id);
    expect(listed).toContain(live.id);
    expect(listed).not.toContain(done.id);
  });

  it('reconstructs a bounded terminal output tail in order', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude'
    });
    appendThreadEvent(db, { threadId: thread.id, kind: 'thread.started' });
    appendThreadEvent(db, { threadId: thread.id, kind: 'terminal.output', payload: { data: 'hello ' } });
    appendThreadEvent(db, { threadId: thread.id, kind: 'terminal.output', payload: { data: 'world' } });
    expect(threadOutputTail(db, thread.id)).toBe('hello world');
  });

  it('claims a project/host/path uniquely and stores git discovery fields', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj',
      workspaceProvisionType: 'managed-worktree',
      branchName: 'zcc/feat',
      baseBranch: 'main'
    });
    expect(environment.managed).toBe(true);
    expect(environment.branchName).toBe('zcc/feat');
    expect(() => createEnvironment(db!, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj',
      workspaceProvisionType: 'unmanaged'
    })).toThrow();
    const other = createEnvironment(db, {
      projectId: 'proj-2',
      hostId: host.id,
      path: '/tmp/proj',
      workspaceProvisionType: 'unmanaged'
    });
    expect(other.projectId).toBe('proj-2');
  });
});
