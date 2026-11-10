import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { controlCredentialForSession } from '@zana-ai/zcc-host-daemon/control-credential';
import type { ProductTerminalRecord } from './product-context.js';
import { startProductServer, type ProductServer } from './product-server.js';
import { SESSIONS_SELF_PATH, SESSION_CREDENTIAL_HEADER, SESSION_ID_HEADER } from './sessions-self-api.js';

let server: ProductServer | null = null;
const dirs: string[] = [];

afterEach(async () => {
  await server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function boot() {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-sessions-self-'));
  dirs.push(dataDir);
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
  return server;
}

function record(over: Partial<ProductTerminalRecord>): ProductTerminalRecord {
  return {
    id: 's-1', hostId: 'h', projectId: 'p-1', title: 't', profile: 'shell', cwd: '/', status: 'running', createdAt: 1, ...over
  } as ProductTerminalRecord;
}

async function get(url: string, headers: Record<string, string>, method = 'GET') {
  const response = await fetch(new URL(SESSIONS_SELF_PATH, url), { method, headers });
  return { status: response.status, json: await response.json().catch(() => null) as unknown };
}

describe('GET /api/v1/sessions/self', () => {
  it('returns only the caller session identity for a valid token', async () => {
    const s = await boot();
    s.ctx.terminalSessions.set('s-1', record({ threadId: 't-1', workspaceEnvironmentId: 'env-1' }));
    s.ctx.terminalSessions.set('s-2', record({ id: 's-2', projectId: 'p-2' }));
    await expect(get(s.url, {
      authorization: `Bearer ${controlCredentialForSession('s-1')}`, [SESSION_ID_HEADER]: 's-1'
    })).resolves.toEqual({
      status: 200, json: { sessionId: 's-1', threadId: 't-1', projectId: 'p-1', environmentId: 'env-1' }
    });
  });

  it('accepts the credential header the CLI sends', async () => {
    const s = await boot();
    s.ctx.terminalSessions.set('s-1', record({}));
    const r = await get(s.url, { [SESSION_CREDENTIAL_HEADER]: controlCredentialForSession('s-1'), [SESSION_ID_HEADER]: 's-1' });
    expect(r.status).toBe(200);
  });

  it('omits thread and environment when main bound none', async () => {
    const s = await boot();
    s.ctx.terminalSessions.set('s-1', record({}));
    const r = await get(s.url, { authorization: `Bearer ${controlCredentialForSession('s-1')}`, [SESSION_ID_HEADER]: 's-1' });
    expect(r).toEqual({ status: 200, json: { sessionId: 's-1', projectId: 'p-1' } });
  });

  it('rejects a bad, absent, malformed or cross-session token with the same 401', async () => {
    const s = await boot();
    s.ctx.terminalSessions.set('s-1', record({}));
    s.ctx.terminalSessions.set('s-2', record({ id: 's-2', projectId: 'p-2' }));
    const other = controlCredentialForSession('s-2');
    const cases: Record<string, string>[] = [
      {},
      { [SESSION_ID_HEADER]: 's-1' },
      { authorization: `Bearer ${other}` },
      { authorization: 'Bearer nope', [SESSION_ID_HEADER]: 's-1' },
      { authorization: `Basic ${other}`, [SESSION_ID_HEADER]: 's-2' },
      { authorization: `Bearer ${other}`, [SESSION_ID_HEADER]: 's-1' },
      { authorization: `Bearer ${controlCredentialForSession('unknown')}`, [SESSION_ID_HEADER]: 'unknown' }
    ];
    for (const headers of cases.slice(0, 6)) {
      expect(await get(s.url, headers)).toEqual({ status: 401, json: { error: 'invalid session credential' } });
    }
    // A valid credential for a session this server does not track is not found, not another session's data.
    expect((await get(s.url, cases[6]!)).status).toBe(404);
  });

  it('does not answer for an exited session', async () => {
    const s = await boot();
    s.ctx.terminalSessions.set('s-1', record({ status: 'exited' }));
    const r = await get(s.url, { authorization: `Bearer ${controlCredentialForSession('s-1')}`, [SESSION_ID_HEADER]: 's-1' });
    expect(r.status).toBe(404);
  });

  it('is GET-only', async () => {
    const s = await boot();
    const r = await fetch(new URL(SESSIONS_SELF_PATH, s.url), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    expect(r.status).not.toBe(200);
  });
});
