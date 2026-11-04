import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startProductServer, type ProductServer } from './product-server.js';
import { InvitationError } from '../services/peers/peer-invitation.js';

let server: ProductServer | null = null;
let dataDir = '';
afterEach(async () => {
  await server?.close();
  server = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = '';
});

async function start() {
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-peer-uses-api-'));
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
  server = await startProductServer({ dataDir, enrollToken: 'enroll-token-enroll-token-enroll', origins: { serverPort: 0, devAppPort: 5173 } });
  return server;
}

const ID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const url = (path: string) => `${server!.url}api/v1${path}`;
const post = (path: string, body?: unknown) => fetch(url(path), { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const PROMPT = { id: ID, pluginId: 'plugin-x', request: { binding: { action: 'a', target: 't', targetLabel: 'l', subject: 's' }, title: 't', summary: 's' } };

function fake(s: ProductServer) {
  const listeners = new Set<() => void>();
  const uses = {
    prompts: vi.fn(() => [PROMPT]),
    onChange: vi.fn((listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }),
    decide: vi.fn(async () => 'approved'),
    dispose: vi.fn()
  };
  s.ctx.peerUseRequests = uses as never;
  return { uses, listeners };
}

describe('/api/v1/peer-uses', () => {
  it('is unavailable without the use layer', async () => {
    const s = await start();
    s.ctx.peerUseRequests = undefined;
    expect((await fetch(url('/peer-uses/prompts'))).status).toBe(503);
  });

  it('streams the open prompts on connect and on every change, and unsubscribes on close', async () => {
    const s = await start(); const { uses, listeners } = fake(s);
    const abort = new AbortController();
    const response = await fetch(url('/peer-uses/prompts'), { signal: abort.signal });
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const reader = response.body!.getReader(); const decoder = new TextDecoder();
    const lines = async () => JSON.parse(decoder.decode((await reader.read()).value).trim());
    expect(await lines()).toEqual({ prompts: [PROMPT] });
    uses.prompts.mockReturnValueOnce([]);
    [...listeners][0]!();
    expect(await lines()).toEqual({ prompts: [] });
    abort.abort();
    await vi.waitFor(() => expect(listeners.size).toBe(0));
  });

  it('forwards an approval with its proof and maps failures to fixed reasons', async () => {
    const s = await start(); const { uses } = fake(s);
    const ok = await post(`/peer-uses/${ID}/decision`, { approved: true, token: 'tok' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'approved' });
    expect(uses.decide).toHaveBeenCalledWith(ID, true, 'tok');
    uses.decide.mockRejectedValueOnce(new InvitationError('owner_proof_required'));
    expect((await post(`/peer-uses/${ID}/decision`, { approved: true })).status).toBe(403);
    uses.decide.mockRejectedValueOnce(new InvitationError('not_found'));
    expect((await post(`/peer-uses/${ID}/decision`, { approved: false })).status).toBe(404);
    uses.decide.mockRejectedValueOnce(new InvitationError('unknown_connection'));
    expect((await post(`/peer-uses/${ID}/decision`, { approved: false })).status).toBe(400);
    uses.decide.mockRejectedValueOnce(new Error('/Users/me/secret'));
    const crash = await post(`/peer-uses/${ID}/decision`, { approved: false });
    expect(crash.status).toBe(503);
    expect(JSON.stringify(await crash.json())).not.toContain('/Users');
  });

  it('rejects a malformed id, body or token and unknown routes', async () => {
    const s = await start(); const { uses } = fake(s);
    expect((await post('/peer-uses/not-a-uuid/decision', { approved: true })).status).toBe(404);
    expect((await post(`/peer-uses/${ID}/decision`, { approved: 'yes' })).status).toBe(400);
    expect((await post(`/peer-uses/${ID}/decision`, { approved: true, token: 5 })).status).toBe(400);
    expect((await post(`/peer-uses/${ID}/decision`, { approved: true, token: 'x'.repeat(3000) })).status).toBe(400);
    expect((await post(`/peer-uses/${ID}/decision`)).status).toBe(400);
    const bad = await fetch(url(`/peer-uses/${ID}/decision`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(bad.status).toBe(400);
    expect((await post(`/peer-uses/${ID}/other`, { approved: true })).status).toBe(404);
    expect(uses.decide).not.toHaveBeenCalled();
  });
});
