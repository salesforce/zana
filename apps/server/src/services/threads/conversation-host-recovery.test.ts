import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendConversationThreadEvent,
  archiveConversationThread,
  createConversationThread,
  createEnvironment,
  getConversationThread,
  listConversationThreadEvents,
  listLiveConversationThreadsForHost,
  openDatabase,
  updateConversationThreadStatus,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { threadScope, turnScope } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHub } from '../../http/product-hub.js';
import {
  findOpenConversationTurn,
  HOST_RECOVERY_TURN_SCAN_CAP,
  interruptLiveConversationThreadsForHost,
  shouldInterruptLiveThreadsOnNewHostInstance
} from './conversation-host-recovery.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function openTestDb(): ZccDatabase {
  dir = mkdtempSync(join(tmpdir(), 'zcc-host-recovery-'));
  db = openDatabase(join(dir, 'zcc.sqlite'));
  return db;
}

function seedHost(database: ZccDatabase, name = 'laptop') {
  return upsertHost(database, { name, hostKeyHash: `${name[0] ?? 'h'}`.repeat(64) });
}

function seedThread(
  database: ZccDatabase,
  hostId: string,
  over: { status?: 'starting' | 'active' | 'stopping' | 'idle' | 'error'; title?: string } = {}
) {
  const environment = createEnvironment(database, {
    projectId: 'proj-1',
    hostId,
    path: `/tmp/${over.title ?? 'thread'}`
  });
  const thread = createConversationThread(database, {
    projectId: 'proj-1',
    hostId,
    environmentId: environment.id,
    providerId: 'claude-code',
    status: over.status ?? 'active',
    title: over.title ?? 'Live'
  });
  if (over.status && over.status !== 'starting') {
    updateConversationThreadStatus(database, thread.id, over.status);
  }
  return getConversationThread(database, thread.id)!;
}

function hub(): ProductHub {
  return { emit: vi.fn() } as unknown as ProductHub;
}

function turnStarted(threadId: string, turnId: string, providerThreadId = 'prov-1') {
  return {
    type: 'turn/started' as const,
    threadId,
    scope: turnScope(turnId),
    providerThreadId
  };
}

describe('conversation host recovery', () => {
  it('interrupts only when the host instance id changed', () => {
    expect(shouldInterruptLiveThreadsOnNewHostInstance(null, 'next')).toBe(true);
    expect(shouldInterruptLiveThreadsOnNewHostInstance('prev', 'next')).toBe(true);
    expect(shouldInterruptLiveThreadsOnNewHostInstance('same', 'same')).toBe(false);
  });

  it('is a no-op when the host has no live conversation threads', () => {
    const database = openTestDb();
    const host = seedHost(database);
    seedThread(database, host.id, { status: 'idle', title: 'Idle' });
    const events = hub();
    expect(interruptLiveConversationThreadsForHost(database, events, { hostId: host.id })).toEqual([]);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('marks a live thread error and records a host-daemon restart interruption', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id, { status: 'active' });
    const events = hub();
    const interrupted = interruptLiveConversationThreadsForHost(database, events, { hostId: host.id });
    expect(interrupted).toHaveLength(1);
    expect(getConversationThread(database, thread.id)?.status).toBe('error');
    expect(listLiveConversationThreadsForHost(database, host.id)).toEqual([]);
    const types = listConversationThreadEvents(database, thread.id).map((row) => row.type);
    expect(types).toEqual(['system/error', 'system/thread/interrupted']);
    expect(listConversationThreadEvents(database, thread.id)[1]?.payload).toMatchObject({
      type: 'system/thread/interrupted',
      reason: 'host-daemon-restarted'
    });
    expect(events.emit).toHaveBeenCalledWith('threads:updated', expect.objectContaining({
      id: thread.id,
      status: 'error'
    }));
  });

  it('closes an open turn as interrupted before settling the thread', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id, { status: 'active' });
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'turn/started',
      payload: turnStarted(thread.id, 'turn-1', 'prov-open')
    });
    expect(findOpenConversationTurn(database, thread.id)).toEqual({
      turnId: 'turn-1',
      providerThreadId: 'prov-open'
    });
    interruptLiveConversationThreadsForHost(database, hub(), { hostId: host.id });
    expect(findOpenConversationTurn(database, thread.id)).toBeNull();
    expect(listConversationThreadEvents(database, thread.id).map((row) => row.type)).toEqual([
      'turn/started',
      'turn/completed',
      'system/error',
      'system/thread/interrupted'
    ]);
    expect(listConversationThreadEvents(database, thread.id)[1]?.payload).toMatchObject({
      type: 'turn/completed',
      status: 'interrupted',
      providerThreadId: 'prov-open',
      scope: { kind: 'turn', turnId: 'turn-1' }
    });
  });

  it('does not reopen a turn that already completed', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id, { status: 'active' });
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'turn/started',
      payload: turnStarted(thread.id, 'turn-1')
    });
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'turn/completed',
      payload: {
        type: 'turn/completed',
        threadId: thread.id,
        scope: turnScope('turn-1'),
        providerThreadId: 'prov-1',
        status: 'completed'
      }
    });
    expect(findOpenConversationTurn(database, thread.id)).toBeNull();
    interruptLiveConversationThreadsForHost(database, hub(), { hostId: host.id });
    expect(listConversationThreadEvents(database, thread.id).map((row) => row.type)).toEqual([
      'turn/started',
      'turn/completed',
      'system/error',
      'system/thread/interrupted'
    ]);
  });

  it('reads nested event payloads and ignores other hosts and archived threads', () => {
    const database = openTestDb();
    const host = seedHost(database, 'alpha');
    const other = seedHost(database, 'beta');
    const live = seedThread(database, host.id, { status: 'stopping', title: 'Stopping' });
    const archived = seedThread(database, host.id, { status: 'active', title: 'Archived' });
    archiveConversationThread(database, archived.id);
    const foreign = seedThread(database, other.id, { status: 'active', title: 'Foreign' });
    appendConversationThreadEvent(database, {
      threadId: live.id,
      type: 'turn/started',
      payload: { event: { ...turnStarted(live.id, 'turn-nested'), scope: turnScope('turn-nested') } }
    });
    interruptLiveConversationThreadsForHost(database, hub(), { hostId: host.id });
    expect(getConversationThread(database, live.id)?.status).toBe('error');
    expect(getConversationThread(database, archived.id)?.status).toBe('idle');
    expect(getConversationThread(database, foreign.id)?.status).toBe('active');
    expect(findOpenConversationTurn(database, live.id)).toBeNull();
  });

  it('skips a system/error row for a manual stop and keeps the scan cap bounded', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id, { status: 'starting' });
    interruptLiveConversationThreadsForHost(database, hub(), {
      hostId: host.id,
      reason: 'manual-stop'
    });
    expect(getConversationThread(database, thread.id)?.status).toBe('error');
    expect(listConversationThreadEvents(database, thread.id).map((row) => row.type)).toEqual([
      'system/thread/interrupted'
    ]);
    expect(HOST_RECOVERY_TURN_SCAN_CAP).toBe(80);
    expect(findOpenConversationTurn(database, thread.id)).toBeNull();
    expect(findOpenConversationTurn(database, 'missing')).toBeNull();
  });

  it('ignores malformed payloads when locating an open turn', () => {
    const database = openTestDb();
    const host = seedHost(database);
    const thread = seedThread(database, host.id, { status: 'active' });
    database.sqlite.prepare('UPDATE threads SET environment_id = NULL WHERE id = ?').run(thread.id);
    appendConversationThreadEvent(database, { threadId: thread.id, type: 'noise', payload: 'raw' });
    appendConversationThreadEvent(database, { threadId: thread.id, type: 'noise', payload: [] });
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'turn/started',
      payload: { type: 'turn/started', scope: { kind: 'thread' } }
    });
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'turn/started',
      payload: {
        type: 'turn/started',
        threadId: thread.id,
        scope: { kind: 'turn', turnId: '  ' },
        providerThreadId: ''
      }
    });
    appendConversationThreadEvent(database, {
      threadId: thread.id,
      type: 'turn/started',
      payload: {
        event: [],
        type: 'turn/started',
        threadId: thread.id,
        scope: { kind: 'turn', turnId: 'turn-fallback' },
        providerThreadId: 9
      }
    });
    expect(findOpenConversationTurn(database, thread.id)).toEqual({
      turnId: 'turn-fallback',
      providerThreadId: null
    });
    const events = hub();
    interruptLiveConversationThreadsForHost(database, events, { hostId: host.id });
    expect(events.emit).toHaveBeenCalledWith('threads:updated', expect.objectContaining({
      id: thread.id,
      environmentId: null,
      cwd: null
    }));
  });
});
