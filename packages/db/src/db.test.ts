import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendConversationThreadEvent,
  appendThreadEvent,
  copyConversationThreadEvents,
  archiveConversationThread,
  countDeferredThreadMessages,
  createConversationThread,
  createDeferredThreadMessage,
  createEnvironment,
  createThread,
  deleteConversationThreadEventsAfter,
  getConversationThread,
  getThread,
  listConversationThreadEvents,
  listDeferredThreadMessages,
  listLiveConversationThreads,
  listLiveThreads,
  listThreadEvents,
  listVisibleConversationThreads,
  maxConversationEventSequenceByThreadIds,
  openDatabase,
  completeThread,
  threadOutputTail,
  unarchiveConversationThread,
  updateConversationThreadParent,
  updateConversationThreadStatus,
  updateConversationThreadTitle,
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

  it('updates a conversation thread parent pointer', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-parent-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const parent = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      title: 'Parent'
    });
    const child = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      title: 'Child'
    });
    const updated = updateConversationThreadParent(db, child.id, parent.id);
    expect(updated?.parentThreadId).toBe(parent.id);
    expect(getConversationThread(db, child.id)?.parentThreadId).toBe(parent.id);
    expect(updateConversationThreadParent(db, child.id, null)?.parentThreadId).toBeNull();
  });

  it('archives and unarchives a conversation thread', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-archive-'));
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
      providerId: 'codex',
      status: 'active',
      title: 'Work'
    });
    const archived = archiveConversationThread(db, thread.id);
    expect(archived?.archivedAt).toEqual(expect.any(Number));
    expect(archived?.status).toBe('idle');
    expect(listVisibleConversationThreads(db).map((row) => row.id)).not.toContain(thread.id);
    expect(unarchiveConversationThread(db, thread.id)?.archivedAt).toBeNull();
    expect(listVisibleConversationThreads(db).map((row) => row.id)).toContain(thread.id);
    expect(unarchiveConversationThread(db, thread.id)?.archivedAt).toBeNull();
  });

  it('copies conversation events onto a fork with remapped thread ids', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-copy-events-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const source = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code'
    });
    const target = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      originKind: 'fork',
      parentThreadId: source.id
    });
    const first = appendConversationThreadEvent(db, {
      threadId: source.id,
      type: 'turn/started',
      payload: { type: 'turn/started', threadId: source.id, scope: { kind: 'turn', turnId: 't1' } }
    });
    appendConversationThreadEvent(db, {
      threadId: source.id,
      type: 'turn/completed',
      payload: { type: 'turn/completed', threadId: source.id, scope: { kind: 'turn', turnId: 't1' } }
    });
    const copied = copyConversationThreadEvents(db, {
      targetThreadId: target.id,
      rows: listConversationThreadEvents(db, source.id)
    });
    expect(copied).toHaveLength(2);
    expect(copied[0]?.id).not.toBe(first.id);
    expect(copied.map((event) => event.threadId)).toEqual([target.id, target.id]);
    expect(copied[0]?.payload).toMatchObject({ threadId: target.id });
    expect(listConversationThreadEvents(db, source.id)).toHaveLength(2);
    expect(listConversationThreadEvents(db, target.id).map((event) => event.type)).toEqual([
      'turn/started',
      'turn/completed'
    ]);
  });

  it('batches max conversation event sequences by thread id', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-max-seq-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const withEvents = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code'
    });
    const empty = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code'
    });
    appendConversationThreadEvent(db, { threadId: withEvents.id, type: 'turn/started' });
    appendConversationThreadEvent(db, { threadId: withEvents.id, type: 'turn/completed' });
    expect(maxConversationEventSequenceByThreadIds(db, [])).toEqual({});
    expect(maxConversationEventSequenceByThreadIds(db, [withEvents.id, empty.id])).toEqual({
      [withEvents.id]: 2
    });
  });

  it('stores deferred thread messages oldest first', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-deferred-'));
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
      providerId: 'claude-code'
    });
    createDeferredThreadMessage(db, { threadId: thread.id, kind: 'send', payload: '{"n":1}' });
    createDeferredThreadMessage(db, { threadId: thread.id, kind: 'send', payload: '{"n":2}' });
    expect(countDeferredThreadMessages(db, thread.id)).toBe(2);
    expect(listDeferredThreadMessages(db, thread.id).map((row) => row.payload)).toEqual([
      '{"n":1}',
      '{"n":2}'
    ]);
  });

  it('deletes conversation events after a sequence', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-truncate-events-'));
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
      providerId: 'claude-code'
    });
    const first = appendConversationThreadEvent(db, { threadId: thread.id, type: 'turn/started' });
    appendConversationThreadEvent(db, { threadId: thread.id, type: 'turn/completed' });
    appendConversationThreadEvent(db, { threadId: thread.id, type: 'turn/started' });
    expect(deleteConversationThreadEventsAfter(db, thread.id, first.sequence)).toBe(2);
    expect(listConversationThreadEvents(db, thread.id).map((event) => event.type)).toEqual(['turn/started']);
  });

  it('renames a conversation thread title', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-rename-'));
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
      title: 'Hello'
    });
    const updated = updateConversationThreadTitle(db, thread.id, 'Hello 2');
    expect(updated?.title).toBe('Hello 2');
    expect(getConversationThread(db, thread.id)?.title).toBe('Hello 2');
    expect(updateConversationThreadTitle(db, 'missing', 'Nope')).toBeNull();
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
