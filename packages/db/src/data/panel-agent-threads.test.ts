import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archiveConversationThread,
  createConversationThread,
  createEnvironment,
  insertThreadPluginMetadata,
  listPanelAgentThreads,
  openDatabase,
  revealConversationThread,
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

function seed() {
  dir = mkdtempSync(join(tmpdir(), 'zcc-panel-agents-'));
  db = openDatabase(join(dir, 'zcc.sqlite'));
  const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(db, {
    projectId: 'proj-1',
    hostId: host.id,
    path: '/tmp/proj',
    workspaceProvisionType: 'unmanaged'
  });
  const opened = db;
  let tick = 0;
  const make = (originPluginId: string | null, metadata?: Record<string, unknown>, visibility: 'visible' | 'hidden' = 'hidden') => {
    const thread = createConversationThread(opened, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      originPluginId,
      visibility
    });
    opened.sqlite.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(1000 + ++tick, thread.id);
    if (originPluginId && metadata) {
      insertThreadPluginMetadata(opened, { threadId: thread.id, pluginId: originPluginId, metadata: metadata as never });
    }
    return thread.id;
  };
  return { db: opened, make };
}

describe('listPanelAgentThreads', () => {
  it('lists only the plugin\'s live panel-bound threads, newest first, hidden or not', () => {
    const { db: opened, make } = seed();
    const older = make('tasks', { panelAgent: { panel: 'board' } });
    make('tasks', { other: true });
    make('tasks');
    make('notes', { panelAgent: { panel: 'main' } });
    const archived = make('tasks', { panelAgent: { panel: 'board' } });
    archiveConversationThread(opened, archived);
    make('tasks', { panelAgent: 'board' });
    const opened2 = make('tasks', { panelAgent: { panel: 'list', view: 'ABC-1' } }, 'visible');
    expect(listPanelAgentThreads(opened, 'tasks').map((row) => row.id)).toEqual([opened2, older]);
    expect(listPanelAgentThreads(opened, 'tasks', 20, 'board').map((row) => row.id)).toEqual([older]);
    expect(listPanelAgentThreads(opened, 'tasks', 20, 'missing')).toEqual([]);
  });

  it('skips corrupt metadata instead of failing the query and caps the limit', () => {
    const { db: opened, make } = seed();
    const corrupt = make('tasks', { panelAgent: { panel: 'board' } });
    opened.sqlite.prepare('UPDATE thread_plugin_metadata SET metadata_json = ? WHERE thread_id = ?').run('{nope', corrupt);
    const ids = Array.from({ length: 3 }, () => make('tasks', { panelAgent: { panel: 'board' } }));
    expect(listPanelAgentThreads(opened, 'tasks').map((row) => row.id)).toEqual([...ids].reverse());
    expect(listPanelAgentThreads(opened, 'tasks', 2)).toHaveLength(2);
    expect(listPanelAgentThreads(opened, 'tasks', 0)).toHaveLength(3);
    expect(listPanelAgentThreads(opened, 'tasks', 20, 'board').map((row) => row.id)).toEqual([...ids].reverse());
  });

  it('reveals a hidden thread once and leaves visible or unknown ids alone', () => {
    const { db: opened, make } = seed();
    const hidden = make('tasks', { panelAgent: { panel: 'board' } });
    const revealed = revealConversationThread(opened, hidden);
    expect(revealed?.visibility).toBe('visible');
    const stamp = revealed!.updatedAt;
    expect(revealConversationThread(opened, hidden)?.updatedAt).toBe(stamp);
    expect(revealConversationThread(opened, 'missing')).toBeNull();
  });
});
