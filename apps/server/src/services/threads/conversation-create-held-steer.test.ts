import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversationThread, listDeferredThreadMessages, openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { createConversationFromRequest } from './conversation-create.js';
import { sendConversationTurn } from './conversation-lifecycle.js';
import { registerThreadProvider } from './thread-provider-catalog.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';

let db: ZccDatabase;
let dir: string;
let ctx: ProductHttpContext;
let unregister: () => void;
let releaseStart: (result: unknown) => void;
let commands: Array<{ type: string; mode?: string; input?: unknown }>;
const threadId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-create-held-steer-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  const hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
  unregister = registerThreadProvider('test', {
    id: 'test-provider', displayName: 'Test',
    capabilities: { supportsServiceTier: true, fork: 'tip', supportsManualCompaction: false,
      supportsThreadArchive: false, supportsThreadRename: false, permissionModes: ['full'] }, composerActions: []
  }).unregister;
  const artifacts = new PluginHostArtifactRegistry();
  artifacts.set('test', { path: '/tmp/host.js', digest: 'a'.repeat(64), byteLength: 12, generation: 'g1' });
  const project = { id: 'p', name: 'Test', path: dir, hostId };
  commands = [];
  ctx = {
    db, dataDir: dir, toProjects: () => [project], projects: { list: () => [project] },
    config: { getConfig: () => ({}) }, hub: { emit: vi.fn() },
    pluginHostArtifacts: artifacts,
    plugins: { admitDispatch: vi.fn(async () => ({ action: 'proceed' })), sessionTools: async () => ({}), emitThreadEvent: vi.fn(async () => {}) },
    pendingInteractions: { interruptPendingInteractionsForThreadIds: vi.fn(), hasPendingThreadInteraction: () => false },
    hostHub: {
      resolveHostId: () => hostId, ensureHostSessionReady: () => {}, connectedHostIds: () => [hostId],
      callHostOnlineRpc: async ({ command }: { command: { type: string; mode?: string; input?: unknown } }) => {
        commands.push(command);
        if (command.type === 'environment.provision') return { path: dir, isGitRepo: false, isWorktree: false };
        if (command.type === 'thread.start') return new Promise(resolve => { releaseStart = resolve; });
        return { threadId, accepted: true };
      }
    }
  } as unknown as ProductHttpContext;
});
afterEach(() => { unregister(); db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('steering a thread that is still starting', () => {
  it('holds the steer until thread.start reports the session, then steers it in', async () => {
    const input = [{ type: 'text' as const, text: 'count to eight', mentions: [] }];
    await createConversationFromRequest(ctx, { id: threadId, projectId: 'p', providerId: 'test-provider', input: ['count to eight'], promptInput: input });
    await vi.waitFor(() => expect(releaseStart).toBeTypeOf('function'));
    expect(getConversationThread(db, threadId)).toMatchObject({ status: 'active', providerThreadId: null });

    await sendConversationTurn(ctx, threadId, [{ type: 'text', text: 'end with BANANA', mentions: [] }], 'steer-if-active');
    expect(commands.map(command => command.type)).not.toContain('turn.submit');
    expect(listDeferredThreadMessages(db, threadId)).toHaveLength(1);

    releaseStart({ providerThreadId: 'provider-created' });
    await vi.waitFor(() => expect(commands.find(command => command.type === 'turn.submit')).toMatchObject({
      mode: 'steer', input: [{ type: 'text', text: 'end with BANANA', mentions: [] }]
    }));
    await vi.waitFor(() => expect(listDeferredThreadMessages(db, threadId)).toEqual([]));
  });
});
