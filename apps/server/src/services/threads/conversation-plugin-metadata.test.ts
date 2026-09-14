import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConversationThread,
  createEnvironment,
  getThreadPluginMetadata,
  openDatabase,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { ThreadCreateError } from '../../http/thread-create.js';
import { persistConversationPluginMetadataSeed } from './conversation-plugin-metadata.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function seedThread(): { db: ZccDatabase; threadId: string } {
  dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-meta-seed-'));
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
  return { db, threadId: thread.id };
}

describe('persistConversationPluginMetadataSeed', () => {
  it('requires originPluginId when pluginMetadata is present', () => {
    expect(() => persistConversationPluginMetadataSeed({} as never, 'thr-1', {
      pluginMetadata: { ticket: 'W-1' }
    })).toThrow(ThreadCreateError);
    try {
      persistConversationPluginMetadataSeed({} as never, 'thr-1', {
        pluginMetadata: { ticket: 'W-1' }
      });
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: 'invalid-input' });
    }
  });

  it('no-ops when pluginMetadata is omitted', () => {
    expect(() => persistConversationPluginMetadataSeed({} as never, 'thr-1', {})).not.toThrow();
  });

  it('writes a seeded namespace onto a real thread row', () => {
    const seeded = seedThread();
    persistConversationPluginMetadataSeed(seeded.db, seeded.threadId, {
      originPluginId: 'notes',
      pluginMetadata: { ticket: 'W-1' }
    });
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes')).toEqual({
      metadata: { ticket: 'W-1' },
      corrupt: false
    });
  });

  it('skips empty object seeds', () => {
    const seeded = seedThread();
    persistConversationPluginMetadataSeed(seeded.db, seeded.threadId, {
      originPluginId: 'notes',
      pluginMetadata: {}
    });
    expect(getThreadPluginMetadata(seeded.db, seeded.threadId, 'notes')).toEqual({
      metadata: {},
      corrupt: false
    });
  });
});
