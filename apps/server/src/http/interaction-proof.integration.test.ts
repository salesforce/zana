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

it('enforces human proof bound to the PTY session at the HTTP boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pty-interaction-proof-'));
  const secret = 's'.repeat(32);
  const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 }, uiSendSecret: secret });
  try {
    const store = server.ctx.ptyInteractions;
    store.noteSession({ sessionId: 'pty-1', projectId: 'p' });
    store.noteSession({ sessionId: 'pty-2', projectId: 'p' });
    const ask = (sessionId: string, requireHuman: boolean) => {
      const pending = store.request({ pluginId: 'fixture', sessionId, rendererId: 'form', title: 'Confirm', payload: {}, requireHuman, timeoutMs: 5000 });
      return { pending, id: store.list(sessionId)[0]!.id };
    };
    const url = (sessionId: string, tail: string) => new URL(`api/v1/pty-sessions/${sessionId}/${tail}`, server.url);
    const post = (sessionId: string, id: string, headers: Record<string, string> = {}) =>
      fetch(url(sessionId, `interactions/${id}/respond`), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"value":true}' });
    const body = '{"value":true}';

    const required = ask('pty-1', true);
    expect((await (await fetch(url('pty-1', 'interactions'))).json())).toHaveLength(1);
    expect((await post('pty-1', required.id)).status).toBe(403);
    expect((await post('pty-1', required.id, { [INTERACTION_PROOF_HEADER]: 'forged' })).status).toBe(403);
    // A proof minted for another session, or for a thread of the same id, is refused.
    const other = signInteractionProof(secret, { sessionId: 'pty-2', interactionId: required.id, body }, 'human', 'window:7');
    expect((await post('pty-1', required.id, { [INTERACTION_PROOF_HEADER]: other })).status).toBe(403);
    const asThread = signInteractionProof(secret, { threadId: 'pty-1', interactionId: required.id, body }, 'human', 'window:7');
    expect((await post('pty-1', required.id, { [INTERACTION_PROOF_HEADER]: asThread })).status).toBe(403);
    const token = signInteractionProof(secret, { sessionId: 'pty-1', interactionId: required.id, body }, 'human', 'window:7');
    const ok = await post('pty-1', required.id, { [INTERACTION_PROOF_HEADER]: token });
    expect(ok.status).toBe(200);
    await expect(required.pending).resolves.toEqual({ outcome: 'submitted', value: true, actor: 'human' });
    expect((await post('pty-1', required.id, { [INTERACTION_PROOF_HEADER]: token })).status).toBe(403);

    const optional = ask('pty-1', false);
    expect((await post('pty-1', optional.id, { 'x-zcc-caller-credential': 'agent-token' })).status).toBe(200);
    await expect(optional.pending).resolves.toEqual({ outcome: 'submitted', value: true, actor: 'agent' });

    const cancelled = ask('pty-2', false);
    expect((await fetch(url('pty-1', `interactions/${cancelled.id}/cancel`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    expect((await fetch(url('pty-2', `interactions/${cancelled.id}/cancel`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(200);
    await expect(cancelled.pending).resolves.toEqual({ outcome: 'cancelled', reason: 'user' });
    expect((await fetch(url('missing', 'interactions'))).status).toBe(200);
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('demands a main-drawn sheet for native-sheet and tells main what to show', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-sheet-proof-'));
  const secret = 's'.repeat(32);
  const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 }, uiSendSecret: secret });
  try {
    const host = upsertHost(server.ctx.db, { id: 'h', name: 'host', hostKeyHash: 'hash' });
    const thread = createConversationThread(server.ctx.db, { projectId: 'p', hostId: host.id, providerId: 'codex' });
    const pending = server.ctx.pendingInteractions.requestPluginInteraction({ pluginId: 'fixture', threadId: thread.id, rendererId: 'form', title: 'Approve plan', payload: {}, requireHuman: 'native-sheet', timeoutMs: 5000 });
    const id = server.ctx.pendingInteractions.listPendingThreadInteractions(thread.id)[0]!.id;
    const body = '{"value":true}';
    const post = (actor: 'human' | 'cli', source: string) => fetch(new URL(`api/v1/threads/${thread.id}/interactions/${id}/respond`, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [INTERACTION_PROOF_HEADER]: signInteractionProof(secret, { threadId: thread.id, interactionId: id, body }, actor, source) },
      body
    });
    // The control socket (cli) and the renderer window are both insufficient.
    expect((await post('cli', 'control:operator')).status).toBe(403);
    const windowOnly = await post('human', 'window:7');
    expect(windowOnly.status).toBe(403);
    expect(await windowOnly.json()).toMatchObject({ error: 'native-sheet-required', title: 'Approve plan', pluginId: 'fixture' });
    const sheet = await post('human', 'sheet:7');
    expect(sheet.status).toBe(200);
    await expect(pending).resolves.toEqual({ outcome: 'submitted', value: true, actor: 'human' });
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('applies the same native-sheet rule to PTY sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pty-native-sheet-'));
  const secret = 's'.repeat(32);
  const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 }, uiSendSecret: secret });
  try {
    const store = server.ctx.ptyInteractions;
    store.noteSession({ sessionId: 'pty-1', projectId: 'p' });
    const pending = store.request({ pluginId: 'fixture', sessionId: 'pty-1', rendererId: 'form', title: 'Approve plan', payload: {}, requireHuman: 'native-sheet', timeoutMs: 5000 });
    const id = store.list('pty-1')[0]!.id;
    const body = '{"value":true}';
    const post = (source: string) => fetch(new URL(`api/v1/pty-sessions/pty-1/interactions/${id}/respond`, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [INTERACTION_PROOF_HEADER]: signInteractionProof(secret, { sessionId: 'pty-1', interactionId: id, body }, 'human', source) },
      body
    });
    const windowOnly = await post('window:7');
    expect(windowOnly.status).toBe(403);
    expect(await windowOnly.json()).toMatchObject({ error: 'native-sheet-required', title: 'Approve plan' });
    expect((await post('sheet:7')).status).toBe(200);
    await expect(pending).resolves.toEqual({ outcome: 'submitted', value: true, actor: 'human' });
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});
