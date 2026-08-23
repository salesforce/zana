import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendThreadEvent,
  createConversationThread,
  createEnvironment,
  createThread,
  getConversationThread,
  getThread,
  listLiveConversationThreads,
  listLiveThreads,
  listThreadEvents,
  listVisibleConversationThreads,
  openDatabase,
  completeThread,
  threadOutputTail,
  updateConversationThreadStatus,
  upsertHost,
  type ZccDatabase
} from './index.js';
import { migrate, SCHEMA_STATEMENTS_V1 } from './migrate.js';

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

  it('creates BB conversation threads beside legacy PTY session rows', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-v4-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const legacy = createThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude'
    });
    const conversation = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      title: 'Hello'
    });
    expect(legacy.id).not.toBe(conversation.id);
    expect(getThread(db, conversation.id)).toBeNull();
    expect(getConversationThread(db, conversation.id)?.providerId).toBe('claude-code');
    expect(getConversationThread(db, legacy.id)).toBeNull();
  });

  it('lists idle and error conversation threads in the visible roster', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-visible-threads-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const live = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'active',
      title: 'Live'
    });
    const idle = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'idle',
      title: 'Idle'
    });
    const failed = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'error',
      title: 'Failed'
    });
    updateConversationThreadStatus(db, live.id, 'active');
    const liveIds = listLiveConversationThreads(db).map((row) => row.id);
    const visibleIds = listVisibleConversationThreads(db).map((row) => row.id);
    expect(liveIds).toContain(live.id);
    expect(liveIds).not.toContain(idle.id);
    expect(visibleIds).toEqual(expect.arrayContaining([live.id, idle.id, failed.id]));
    expect(listVisibleConversationThreads(db, { limit: 1 })).toHaveLength(1);
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

  it('completeThread drops a running row out of the live list', () => {
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
    expect(completeThread(db, live.id)).toBe(true);
    expect(getThread(db, live.id)?.status).toBe('completed');
    expect(listLiveThreads(db).map((row) => row.id)).not.toContain(live.id);
    expect(completeThread(db, 'missing')).toBe(false);
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

  it('collapses duplicate environment paths before adding the unique index', () => {
    const sqlite = new Database(':memory:');
    sqlite.prepare(
      'CREATE TABLE IF NOT EXISTS runtime_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)'
    ).run();
    sqlite.transaction(() => {
      for (const statement of SCHEMA_STATEMENTS_V1) sqlite.prepare(statement).run();
      sqlite.prepare('INSERT INTO runtime_schema_migrations (version, applied_at) VALUES (?, ?)').run(1, Date.now());
    })();
    sqlite.prepare(
      `INSERT INTO hosts (id, name, type, host_key_hash, created_at, updated_at)
       VALUES ('host-1', 'laptop', 'persistent', ?, 1, 1)`
    ).run('h'.repeat(64));
    sqlite.prepare(
      `INSERT INTO environments (id, project_id, host_id, path, workspace_provision_type, status, created_at, updated_at)
       VALUES (?, 'proj-1', 'host-1', '/tmp/proj', 'unmanaged', 'ready', 1, 1)`
    ).run('env-old');
    sqlite.prepare(
      `INSERT INTO environments (id, project_id, host_id, path, workspace_provision_type, status, created_at, updated_at)
       VALUES (?, 'proj-1', 'host-1', '/tmp/proj', 'unmanaged', 'ready', 2, 2)`
    ).run('env-new');
    sqlite.prepare(
      `INSERT INTO threads (id, project_id, host_id, environment_id, provider_id, status, created_at, updated_at)
       VALUES ('thr-1', 'proj-1', 'host-1', 'env-old', 'claude', 'idle', 1, 1)`
    ).run();

    expect(() => migrate(sqlite)).not.toThrow();
    expect(
      sqlite.prepare(
        'SELECT id FROM environments WHERE project_id = ? AND host_id = ? AND path = ?'
      ).all('proj-1', 'host-1', '/tmp/proj')
    ).toEqual([{ id: 'env-new' }]);
    expect(sqlite.prepare('SELECT environment_id FROM legacy_agent_sessions WHERE id = ?').get('thr-1')).toEqual({
      environment_id: 'env-new'
    });
    sqlite.close();
  });
});
