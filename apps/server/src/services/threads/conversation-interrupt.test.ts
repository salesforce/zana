import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendConversationThreadEvent,
  createConversationThread,
  createEnvironment,
  listConversationThreadEvents,
  openDatabase,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { appendStopRequestedEvent, finalizeInterruptedConversation } from './conversation-interrupt.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('conversation interrupt', () => {
  it('finalizes an open turn once and is idempotent', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-stop-'));
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
      status: 'active'
    });
    appendConversationThreadEvent(db, {
      threadId: thread.id,
      type: 'turn/started',
      payload: {
        type: 'turn/started',
        threadId: thread.id,
        scope: { kind: 'turn', turnId: 'turn-1' },
        providerThreadId: 'prov-1'
      }
    });
    const hub = { emit: vi.fn() };
    appendStopRequestedEvent(db, hub as never, thread.id);
    const first = finalizeInterruptedConversation(db, hub as never, {
      threadId: thread.id,
      reason: 'manual-stop'
    });
    expect(first?.status).toBe('idle');
    const types = listConversationThreadEvents(db, thread.id).map((row) => {
      const payload = row.payload as { type?: string };
      return payload.type ?? row.type;
    });
    expect(types.filter((type) => type === 'turn/completed')).toHaveLength(1);
    expect(types.filter((type) => type === 'system/thread/interrupted')).toHaveLength(1);
    finalizeInterruptedConversation(db, hub as never, {
      threadId: thread.id,
      reason: 'manual-stop'
    });
    const again = listConversationThreadEvents(db, thread.id).map((row) => {
      const payload = row.payload as { type?: string };
      return payload.type ?? row.type;
    });
    expect(again.filter((type) => type === 'system/thread/interrupted')).toHaveLength(1);
  });
});
