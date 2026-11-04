import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { registerThreadProvider } from './thread-provider-catalog.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';

vi.mock('./remote-tool-proxy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remote-tool-proxy.js')>()),
  isRemoteToolProxyActive: () => true
}));

import { createConversationFromRequest } from './conversation-create.js';

let db: ZccDatabase;
let dir: string;
let unregister: () => void;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-create-remote-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  unregister = registerThreadProvider('test', {
    id: 'test-provider', displayName: 'Test',
    capabilities: { supportsServiceTier: true, fork: 'tip', supportsManualCompaction: false,
      supportsThreadArchive: false, supportsThreadRename: false, permissionModes: ['full'] }, composerActions: []
  }).unregister;
});
afterEach(() => { unregister(); db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('createConversationFromRequest with an active remote tool proxy', () => {
  it('stamps the remote descriptor and remoteToolProxy flag on thread.start', async () => {
    const hostId = upsertHost(db, { name: 'exec', hostKeyHash: 'h'.repeat(64) }).id;
    const project = { id: 'p', name: 'Test', path: dir, hostId, remote: { host: 'box.example', user: 'dev' } };
    const artifacts = new PluginHostArtifactRegistry();
    artifacts.set('test', { path: '/tmp/host.js', digest: 'a'.repeat(64), byteLength: 12, generation: 'g1' });
    const started: Array<Record<string, unknown>> = [];
    const ctx = {
      db, dataDir: dir, toProjects: () => [project], projects: { list: () => [project] },
      config: { getConfig: () => ({ remoteDefaultPath: '~/work' }) }, hub: { emit: vi.fn() },
      pluginHostArtifacts: artifacts,
      plugins: { admitDispatch: vi.fn(async () => ({ action: 'proceed' })), sessionTools: () => ({}), emitThreadEvent: vi.fn(async () => {}) },
      pendingInteractions: { interruptPendingInteractionsForThreadIds: vi.fn(), hasPendingThreadInteraction: () => false },
      hostHub: {
        resolveHostId: () => hostId, ensureHostSessionReady: () => {}, connectedHostIds: () => [hostId],
        callHostOnlineRpc: async ({ command }: { command: { type: string } }) => {
          if (command.type === 'environment.provision') return { path: dir, isGitRepo: false, isWorktree: false };
          if (command.type === 'thread.start') { started.push(command as never); return { providerThreadId: 'pt' }; }
          return {};
        }
      }
    } as unknown as ProductHttpContext;

    await createConversationFromRequest(ctx, { projectId: 'p', providerId: 'test-provider', input: ['hello'] });
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ remoteToolProxy: true, remote: { host: 'box.example', user: 'dev' } });
  });
});
