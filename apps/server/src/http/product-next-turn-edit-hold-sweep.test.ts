import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createConversationThread, createDeferredThreadMessage, createEnvironment, getDeferredThreadMessage,
  holdDeferredThreadMessageForEdit, setConversationProviderThreadId, upsertHost
} from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';

let server: ProductServer | undefined;
let dir: string;
let provider: { unregister(): void };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-edit-hold-sweep-'));
  provider = registerThreadProvider('test', {
    id: 'codex', displayName: 'Codex',
    capabilities: { supportsServiceTier: false, fork: 'checkpoint', supportsThreadArchive: false, supportsThreadRename: false, permissionModes: ['full'] }
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await server?.close();
  server = undefined;
  provider.unregister();
  rmSync(dir, { recursive: true, force: true });
});

async function boot() {
  const booted = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 } });
  booted.ctx.pluginHostArtifacts.set('test', { path: '/tmp/host.js', digest: 'a'.repeat(64), byteLength: 12, generation: 'g1' });
  return booted;
}

it('sends a row whose editor lease lapsed across a restart, and leaves a live lease alone', async () => {
  server = await boot();
  const host = upsertHost(server.ctx.db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(server.ctx.db, { projectId: 'p', hostId: host.id, path: dir });
  const create = () => createConversationThread(server.ctx.db, {
    projectId: 'p', hostId: host.id, environmentId: environment.id, providerId: 'codex', status: 'idle'
  });
  const abandoned = create();
  const editing = create();
  for (const thread of [abandoned, editing]) setConversationProviderThreadId(server.ctx.db, thread.id, `provider-${thread.id}`);
  const queue = (threadId: string, input: string) => createDeferredThreadMessage(server!.ctx.db, {
    threadId, kind: 'send', payload: JSON.stringify({ kind: 'send', mode: 'queue-if-active', input })
  });
  const lapsed = queue(abandoned.id, 'abandoned edit');
  const live = queue(editing.id, 'still editing');
  holdDeferredThreadMessageForEdit(server.ctx.db, { id: lapsed.id, threadId: abandoned.id, heldUntil: Date.now() - 1 });
  holdDeferredThreadMessageForEdit(server.ctx.db, { id: live.id, threadId: editing.id, heldUntil: Date.now() + 600_000 });
  await server.close();

  // The lease is a stored deadline, so a fresh process sees it exactly as the old one left it.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  server = await boot();
  server.ctx.hostHub.connectedHostIds = () => [host.id];
  server.ctx.hostHub.callHostOnlineRpc = vi.fn(async () => ({ accepted: true }));
  expect(getDeferredThreadMessage(server.ctx.db, { id: lapsed.id, threadId: abandoned.id })).toMatchObject({ status: 'queued' });

  await vi.advanceTimersByTimeAsync(5_000);
  vi.useRealTimers();
  await vi.waitFor(() => expect(server!.ctx.hostHub.callHostOnlineRpc).toHaveBeenCalled());
  const sent = JSON.stringify((server.ctx.hostHub.callHostOnlineRpc as ReturnType<typeof vi.fn>).mock.calls);
  expect(sent).toContain('abandoned edit');
  expect(sent).not.toContain('still editing');
  await vi.waitFor(() => expect(getDeferredThreadMessage(server!.ctx.db, { id: lapsed.id, threadId: abandoned.id })).toBeNull());
  expect(getDeferredThreadMessage(server.ctx.db, { id: live.id, threadId: editing.id })).toMatchObject({ status: 'queued' });
  expect(getDeferredThreadMessage(server.ctx.db, { id: live.id, threadId: editing.id })?.editHeldUntil).toBeGreaterThan(Date.now());
});
