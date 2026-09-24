import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEnvironment, getConversationThread, getEnvironment, listConversationThreadEvents,
  openDatabase, upsertHost, type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { createConversationFromRequest } from './conversation-create.js';
import { stopConversation } from './conversation-lifecycle.js';
import { registerThreadProvider } from './thread-provider-catalog.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';

let db: ZccDatabase;
let dir: string;
let ctx: ProductHttpContext;
let unregister: () => void;
const threadId = '11111111-1111-4111-8111-111111111111';
let hostId: string;
let provision: () => Promise<unknown>;
let start: () => Promise<unknown>;
let sessionTools: () => Promise<unknown>;
let commands: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-create-cancel-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
  unregister = registerThreadProvider('test', {
    id: 'test-provider', displayName: 'Test',
    capabilities: { supportsServiceTier: true, fork: 'tip', supportsManualCompaction: false,
      supportsThreadArchive: false, supportsThreadRename: false, permissionModes: ['full'] }, composerActions: []
  }).unregister;
  const artifacts = new PluginHostArtifactRegistry();
  artifacts.set('test', { path: '/tmp/host.js', digest: 'a'.repeat(64), byteLength: 12, generation: 'g1' });
  const project = { id: 'p', name: 'Test', path: dir, hostId };
  commands = [];
  provision = async () => ({ path: dir, isGitRepo: false, isWorktree: false });
  sessionTools = async () => ({});
  start = async () => ({ providerThreadId: 'provider-created' });
  ctx = {
    db, dataDir: dir, toProjects: () => [project], projects: { list: () => [project] },
    config: { getConfig: () => ({}) }, hub: { emit: vi.fn() },
    pluginHostArtifacts: artifacts,
    plugins: { sessionTools: () => sessionTools(), emitThreadEvent: vi.fn(async () => {}) },
    pendingInteractions: { interruptPendingInteractionsForThreadIds: vi.fn(), hasPendingThreadInteraction: () => false },
    hostHub: {
      resolveHostId: () => hostId, ensureHostSessionReady: () => {}, connectedHostIds: () => [hostId],
      callHostOnlineRpc: async ({ command }: { command: { type: string } }) => {
        commands.push(command.type);
        if (command.type === 'environment.provision') return provision();
        if (command.type === 'thread.start') return start();
        return {};
      }
    }
  } as unknown as ProductHttpContext;
});
afterEach(() => { unregister(); db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('initial thread cancellation', () => {
  it.each([false, true])('does not start after Stop during environment provisioning (reuse=%s)', async reuse => {
    const environment = reuse ? createEnvironment(db, { projectId: 'p', hostId, path: dir, status: 'ready', workspaceProvisionType: 'unmanaged' }) : null;
    let release!: () => void;
    provision = () => new Promise(resolve => { release = () => resolve({ path: dir, isGitRepo: false, isWorktree: false }); });
    const creating = createConversationFromRequest(ctx, { id: threadId, projectId: 'p', providerId: 'test-provider', input: ['do work'], promptInput: [{ type: 'text', text: 'do work', mentions: [] }],
      ...(environment ? { environment: { kind: 'reuse', environmentId: environment.id } as const } : {}) });
    const cancelled = creating.catch(error => error);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await stopConversation(ctx, threadId);
    release();
    expect(await cancelled).toMatchObject({ code: 'send_cancelled' });
    expect(commands).not.toContain('thread.start');
    const thread = getConversationThread(db, threadId)!;
    expect(thread.status).toBe('idle');
    expect(getEnvironment(db, thread.environmentId!)?.status).toBe('ready');
    expect(listConversationThreadEvents(db, threadId).some(event => event.type === 'client/turn/requested')).toBe(false);
  });

  it('does not start or record a new turn after Stop during session tool preparation', async () => {
    let release!: () => void;
    sessionTools = () => new Promise(resolve => { release = () => resolve({}); });
    const creating = createConversationFromRequest(ctx, { id: threadId, projectId: 'p', providerId: 'test-provider', input: ['do work'], promptInput: [{ type: 'text', text: 'do work', mentions: [] }] });
    const cancelled = creating.catch(error => error);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await stopConversation(ctx, threadId);
    release();
    expect(await cancelled).toMatchObject({ code: 'send_cancelled' });
    expect(commands).not.toContain('thread.start');
    expect(getConversationThread(db, threadId)?.status).toBe('idle');
    expect(listConversationThreadEvents(db, threadId).some(event => event.type === 'client/turn/requested')).toBe(false);
  });

  it.each(['success', 'error'])('keeps Stop settled after a late start response (%s)', async outcome => {
    let settle!: () => void;
    start = () => new Promise((resolve, reject) => {
      settle = () => outcome === 'success' ? resolve({ providerThreadId: 'too-late' }) : reject(new Error('late failure'));
    });
    const created = await createConversationFromRequest(ctx, { id: threadId, projectId: 'p', providerId: 'test-provider', input: ['do work'], promptInput: [{ type: 'text', text: 'do work', mentions: [] }] });
    expect(created.status).toBe('active');
    await stopConversation(ctx, threadId);
    settle();
    if (outcome === 'error') {
      await vi.waitFor(() => expect(listConversationThreadEvents(db, threadId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'client/turn/rejected', payload: expect.objectContaining({ reason: 'send_cancelled' }) })
      ])));
    } else {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(getConversationThread(db, threadId)).toMatchObject({ status: 'idle', providerThreadId: null });
  });

});
