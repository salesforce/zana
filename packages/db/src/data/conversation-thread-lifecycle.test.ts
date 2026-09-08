import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyConversationThreadLifecycleEvent,
  applyConversationThreadLifecycleEventOnRow,
  archiveConversationThread,
  createConversationThread,
  createEnvironment,
  getConversationThread,
  openDatabase,
  updateConversationThreadStatus,
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

function seed(status: 'idle' | 'starting' | 'active' | 'stopping' | 'error' = 'idle') {
  dir = mkdtempSync(join(tmpdir(), 'zcc-lifecycle-'));
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
    status,
    title: 'Lifecycle'
  });
  return thread;
}

describe('applyConversationThreadLifecycleEvent', () => {
  it('does not apply run.started while stopping', () => {
    const thread = seed('stopping');
    const outcome = applyConversationThreadLifecycleEvent(db!, {
      threadId: thread.id,
      event: { type: 'run.started' }
    });
    expect(outcome).toMatchObject({
      applied: false,
      reason: 'illegal-transition'
    });
    expect(getConversationThread(db!, thread.id)?.status).toBe('stopping');
  });

  it('maps stopping + run.succeeded to idle', () => {
    const thread = seed('stopping');
    const outcome = applyConversationThreadLifecycleEvent(db!, {
      threadId: thread.id,
      event: { type: 'run.succeeded' }
    });
    expect(outcome.applied).toBe(true);
    if (outcome.applied) expect(outcome.thread.status).toBe('idle');
  });

  it('maps stopping + run.failed to error', () => {
    const thread = seed('stopping');
    const outcome = applyConversationThreadLifecycleEvent(db!, {
      threadId: thread.id,
      event: { type: 'run.failed' }
    });
    expect(outcome.applied).toBe(true);
    if (outcome.applied) expect(outcome.thread.status).toBe('error');
  });

  it('maps stopping + stop.settled to idle', () => {
    const thread = seed('stopping');
    const outcome = applyConversationThreadLifecycleEvent(db!, {
      threadId: thread.id,
      event: { type: 'stop.settled' }
    });
    expect(outcome.applied).toBe(true);
    if (outcome.applied) expect(outcome.thread.status).toBe('idle');
  });

  it('maps error + run.started to active for recovery', () => {
    const thread = seed('error');
    const outcome = applyConversationThreadLifecycleEvent(db!, {
      threadId: thread.id,
      event: { type: 'run.started' }
    });
    expect(outcome.applied).toBe(true);
    if (outcome.applied) expect(outcome.thread.status).toBe('active');
  });

  it('supersedes run.started on an archived thread', () => {
    const thread = seed('idle');
    archiveConversationThread(db!, thread.id);
    const outcome = applyConversationThreadLifecycleEvent(db!, {
      threadId: thread.id,
      event: { type: 'run.started' }
    });
    expect(outcome).toMatchObject({
      applied: false,
      reason: 'superseded'
    });
  });

  it('returns not-found for an unknown id', () => {
    seed('idle');
    expect(applyConversationThreadLifecycleEvent(db!, {
      threadId: 'missing',
      event: { type: 'run.started' }
    })).toMatchObject({ applied: false, reason: 'not-found' });
  });

  it('returns cas-conflict when the snapshot status no longer matches', () => {
    const thread = seed('starting');
    updateConversationThreadStatus(db!, thread.id, 'idle');
    const stale = { ...thread, status: 'starting' as const };
    const outcome = applyConversationThreadLifecycleEventOnRow(db!, stale, { type: 'run.started' });
    expect(outcome).toEqual({
      applied: false,
      reason: 'cas-conflict',
      detail: 'status changed from starting while applying run.started'
    });
    expect(getConversationThread(db!, thread.id)?.status).toBe('idle');
  });
});
