import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createConversationThread, upsertHost } from '@zana-ai/zcc-db';
import { startProductServer } from './product-server.js';
import { signInteractionProof, INTERACTION_PROOF_HEADER } from './interaction-proof.js';

it('enforces opt-in human proof at HTTP boundary and persists every response actor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interaction-proof-'));
  const secret = 's'.repeat(32);
  const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 }, uiSendSecret: secret });
  try {
    const host = upsertHost(server.ctx.db, { id: 'h', name: 'host', hostKeyHash: 'hash' });
    const thread = createConversationThread(server.ctx.db, { projectId: 'p', hostId: host.id, providerId: 'codex' });
    const ask = (requireHuman: boolean) => {
      const pending = server.ctx.pendingInteractions.requestPluginInteraction({ pluginId: 'fixture', threadId: thread.id, rendererId: 'form', title: 'Confirm', payload: {}, requireHuman, timeoutMs: 1000 });
      const id = server.ctx.pendingInteractions.listPendingThreadInteractions(thread.id)[0]!.id;
      return { pending, id };
    };
    const post = (id: string, headers: Record<string, string> = {}) => fetch(new URL(`api/v1/threads/${thread.id}/interactions/${id}/respond`, server.url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"value":true}' });
    const required = ask(true);
    expect((await post(required.id)).status).toBe(403);
    expect((await post(required.id, { 'x-zcc-caller-credential': 'agent-token' })).status).toBe(403);
    const token = signInteractionProof(secret, { threadId: thread.id, interactionId: required.id, body: '{"value":true}' }, 'human', 'window:7');
    expect((await post(required.id, { [INTERACTION_PROOF_HEADER]: 'forged' })).status).toBe(403);
    const response = await post(required.id, { [INTERACTION_PROOF_HEADER]: token });
    expect(response.status).toBe(200);
    expect((await response.json()).resolution).toEqual({ kind: 'plugin_submitted', actor: 'human' });
    await expect(required.pending).resolves.toEqual({ outcome: 'submitted', value: true, actor: 'human' });
    expect((await post(required.id, { [INTERACTION_PROOF_HEADER]: token })).status).toBe(403);
    for (const actor of ['agent', 'unknown'] as const) {
      const optional = ask(false);
      expect((await post(optional.id, actor === 'agent' ? { 'x-zcc-caller-credential': 'agent-token' } : {})).status).toBe(200);
      await expect(optional.pending).resolves.toEqual({ outcome: 'submitted', value: true, actor });
    }
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});
