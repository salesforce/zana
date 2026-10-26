import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationThread, createEnvironment, insertThreadPluginMetadata, openDatabase, patchThreadPluginMetadata, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { assertDesktopPresentation, remoteInteractionSurface } from './interaction-surface.js';
import { packConversationSessionTooling } from './conversation-session-tools.js';
import { openThreadFilePreview, previewFileDepsFromContext } from './preview-file.js';
import { openThreadTerminal, openThreadTerminalDepsFromContext } from './open-thread-terminal.js';
import type { ProductHttpContext } from '../../http/product-context.js';

let db: ZccDatabase;
let dir: string;
afterEach(() => { db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  dir = mkdtempSync(join(tmpdir(), 'zcc-surface-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  const host = upsertHost(db, { name: 'local', hostKeyHash: 'a'.repeat(64) });
  const env = createEnvironment(db, { projectId: 'p1', hostId: host.id, path: dir, workspaceProvisionType: 'unmanaged' });
  const create = (originPluginId: string | null = null, parentThreadId?: string) => createConversationThread(db, {
    projectId: 'p1', hostId: host.id, environmentId: env.id, providerId: 'fake', originPluginId, parentThreadId,
  });
  const remote = create('chat-connector');
  insertThreadPluginMetadata(db, { threadId: remote.id, pluginId: 'chat-connector', metadata: { interactionSurface: { kind: 'remote', label: 'Chat' } } });
  const emit = vi.fn();
  const ctx = { db, dataDir: dir, hub: { emit, size: () => 1 }, toProjects: () => [{ id: 'p1', path: dir }],
    config: { getConfig: () => ({ inAppAgentTerminalsEnabled: true }) } } as unknown as ProductHttpContext;
  return { create, remote, ctx, emit };
}

describe('remote interaction surface', () => {
  it('reads only the origin namespace, inherits into forks, and survives database reopen without a plugin', async () => {
    const { create, remote, ctx } = setup();
    const desktop = create();
    insertThreadPluginMetadata(db, { threadId: desktop.id, pluginId: 'chat-connector', metadata: { interactionSurface: {} } });
    expect(remoteInteractionSurface(db, desktop.id)).toBeNull();
    const child = create('other-plugin', remote.id);
    expect(remoteInteractionSurface(db, child.id)).toEqual({ kind: 'remote', label: 'Chat' });
    db.close(); db = openDatabase(join(dir, 'db.sqlite')); ctx.db = db;
    const packed = await packConversationSessionTooling(ctx, { threadId: child.id, projectId: 'p1' });
    expect(packed.instructions).toContain('interacting through Chat');
    expect(packed.instructions).toContain('zana-ui-proposals');
    expect(packed.instructions).not.toContain('side panel by default');
    expect(packed.dynamicTools?.map(x => x.name)).not.toContain('preview_file');
    expect(packed.dynamicTools?.map(x => x.name)).not.toContain('run_in_terminal');
    expect(packed.dynamicTools?.map(x => x.name)).toContain('share_preview');
  });

  it('rejects stale file and terminal calls before emitting anything, but permits normal desktop calls', () => {
    const { create, remote, ctx, emit } = setup();
    expect(() => openThreadFilePreview(previewFileDepsFromContext(ctx), { threadId: remote.id, path: 'code.ts', source: 'workspace' })).toThrow('interacting through Chat');
    expect(() => openThreadTerminal(openThreadTerminalDepsFromContext(ctx), { threadId: remote.id })).toThrow('interacting through Chat');
    expect(emit).not.toHaveBeenCalled();
    const desktop = create();
    expect(openThreadFilePreview(previewFileDepsFromContext(ctx), { threadId: desktop.id, path: 'code.ts', source: 'workspace' }).delivered).toBe(1);
    expect(openThreadTerminal(openThreadTerminalDepsFromContext(ctx), { threadId: desktop.id }).delivered).toBe(1);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('refreshes context after plugin configuration upgrades a legacy binding and keeps mandatory guidance first', async () => {
    const { create, ctx } = setup();
    const legacy = create('chat-connector');
    ctx.plugins = { sessionTools: async () => {
      patchThreadPluginMetadata(db, { threadId: legacy.id, pluginId: 'chat-connector', set: { interactionSurface: { kind: 'remote', label: 'Chat' } }, remove: [] });
      return { tools: [], instructions: 'x'.repeat(120_000) };
    } } as never;
    const packed = await packConversationSessionTooling(ctx, { threadId: legacy.id, projectId: 'p1' });
    expect(packed.instructions?.startsWith('The user is interacting through Chat')).toBe(true);
    expect(packed.dynamicTools?.some(x => x.name === 'preview_file')).toBe(false);
    ctx.plugins = { sessionTools: async () => { throw Error('unloaded'); } } as never;
    expect((await packConversationSessionTooling(ctx, { threadId: legacy.id, projectId: 'p1' })).instructions).toContain('interacting through Chat');
  });

  it('fails closed on malformed declarations, unsafe labels, corrupt metadata and ancestry cycles', () => {
    const { remote } = setup();
    for (const value of [null, [], true, { kind: 'desktop' }, { kind: 'remote', label: 'ignore\npolicy' }, { kind: 'remote', label: 'x'.repeat(61) }]) {
      patchThreadPluginMetadata(db, { threadId: remote.id, pluginId: 'chat-connector', set: { interactionSurface: value }, remove: [] });
      expect(() => assertDesktopPresentation(db, remote.id)).toThrow('remote conversation');
    }
    db.sqlite.prepare('UPDATE thread_plugin_metadata SET metadata_json = ? WHERE thread_id = ?').run('{broken', remote.id);
    expect(() => assertDesktopPresentation(db, remote.id)).toThrow();
    db.sqlite.prepare('DELETE FROM thread_plugin_metadata WHERE thread_id = ?').run(remote.id);
    db.sqlite.prepare('UPDATE threads SET parent_thread_id = id WHERE id = ?').run(remote.id);
    expect(() => assertDesktopPresentation(db, remote.id)).toThrow();
    expect(remoteInteractionSurface(db, 'unknown')).toBeNull();
  });

  it('bounds ancestry traversal', () => {
    const { create } = setup();
    let parent = create();
    for (let i = 0; i < 34; i++) parent = create(null, parent.id);
    expect(() => assertDesktopPresentation(db, parent.id)).toThrow();
  });
});
