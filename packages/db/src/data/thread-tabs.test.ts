import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConversationThread,
  createEnvironment,
  getThreadTabs,
  openDatabase,
  replaceThreadTabs,
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

describe('thread_tabs', () => {
  it('stores tabs with optimistic concurrency', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-tabs-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj',
      workspaceProvisionType: 'unmanaged'
    });
    const thread = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code'
    });
    expect(getThreadTabs(db, thread.id)).toBeNull();
    const first = replaceThreadTabs(db, {
      threadId: thread.id,
      expectedRevision: 0,
      tabsJson: '[]'
    });
    expect(first).toMatchObject({ revision: 1, tabsJson: '[]' });
    expect(replaceThreadTabs(db, {
      threadId: thread.id,
      expectedRevision: 0,
      tabsJson: '[]'
    })).toBe('conflict');
    expect(replaceThreadTabs(db, {
      threadId: thread.id,
      expectedRevision: 1,
      tabsJson: '[{"kind":"new-tab"}]'
    })).toMatchObject({ revision: 2 });
  });
});
