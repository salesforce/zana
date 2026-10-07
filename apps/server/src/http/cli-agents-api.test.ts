import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { upsertHost } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer;
let dir: string;
const row = { id: 's', projectId: 'p', hostId: 'primary', profile: 'shell', status: 'running' };
async function boot(projectHostId?: string, remote?: { host: string }) {
  dir = mkdtempSync(join(tmpdir(), 'zcc-cli-api-'));
  writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: [
    { id: 'p', name: 'Project', path: dir, hostId: projectHostId, remote, createdAt: 1, lastActiveAt: 1 }
  ] }));
  server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 } });
  upsertHost(server.ctx.db, { id: 'primary', name: 'Primary', hostKeyHash: 'a'.repeat(64), isPrimary: true });
  const ops = {
    create: vi.fn(async (): Promise<unknown> => ({ ok: true, value: row })),
    status: vi.fn(async (): Promise<unknown> => ({ ok: true, value: { state: 'idle' } })),
    list: vi.fn(async (): Promise<unknown> => ({ ok: true, value: [row] })),
    get: vi.fn(async (): Promise<unknown> => ({ ok: true, value: row })),
    reply: vi.fn(async (): Promise<unknown> => ({ ok: true, value: true })),
    close: vi.fn(async (): Promise<unknown> => ({ ok: true, value: true }))
  };
  server.ctx.cliAgentOps = ops;
  return ops;
}
async function request(path = '', method = 'GET', body?: unknown) {
  const response = await fetch(`${server.url}api/v1/cli-agents${path}`, {
    method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  });
  return { status: response.status, body: await response.json() };
}
afterEach(async () => { await server?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

it('returns unavailability without a desktop bridge', async () => {
  await boot(); server.ctx.cliAgentOps = undefined;
  expect((await request()).status).toBe(502);
});

it('validates the project and machine before forwarding any executable intent', async () => {
  const ops = await boot();
  for (const body of [{}, { projectId: 'p', profile: 'bad' }, { projectId: 12, profile: 'shell' }])
    expect((await request('', 'POST', body)).status).toBe(400);
  expect((await request('', 'POST', { projectId: 'missing', profile: 'shell' })).status).toBe(404);
  for (const hostId of ['secondary', '', 0, null])
    expect((await request('', 'POST', { projectId: 'p', profile: 'shell', hostId })).status).toBe(409);
  expect(ops.create).not.toHaveBeenCalled();
});

it('rejects a foreign project owner even when the caller selects the primary', async () => {
  const ops = await boot('secondary');
  expect((await request('', 'POST', { projectId: 'p', hostId: 'primary', profile: 'shell' })).status).toBe(409);
  expect(ops.create).not.toHaveBeenCalled();
});

it.each([undefined, 'secondary'])('forwards registered SSH CLI launches with daemon binding %s', async hostId => {
  const ops = await boot(hostId, { host: 'ssh-box' });
  for (const requested of [undefined, 'primary', ...(hostId ? [hostId] : [])]) {
    expect((await request('', 'POST', { projectId: 'p', profile: 'shell', hostId: requested })).status).toBe(201);
    expect(ops.create).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p', hostId: requested }));
  }
  ops.create.mockClear();
  for (const requested of ['other', '', null, 42]) {
    expect((await request('', 'POST', { projectId: 'p', profile: 'shell', hostId: requested })).status).toBe(409);
  }
  expect(ops.create).not.toHaveBeenCalled();
});

it('forwards the primary selection and validates optional launch fields', async () => {
  const ops = await boot('primary');
  const fields = { projectId: 'p', hostId: 'primary', profile: 'shell', prompt: 'task', personaId: 'persona',
    extraArgs: ['safe', 1], harnessRouting: {}, worktree: { branch: 'feature' }, environment: 'local',
    isolateScratch: 'scratch', title: 'title', cols: 110, rows: 42 };
  const result = await request('', 'POST', fields);
  expect(result).toMatchObject({ status: 201, body: { agent: { hostId: 'primary', status: 'idle' } } });
  expect(ops.create).toHaveBeenCalledWith({ ...fields, extraArgs: ['safe'] });
  for (const worktree of [true, false, 'invalid']) {
    ops.status.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'gone' });
    expect((await request('', 'POST', { projectId: 'p', profile: 'shell', worktree, isolateScratch: true })).body.agent.status).toBe('running');
  }
});

it.each([
  ['NOT_FOUND', 404], ['unknown-session', 404], ['CANCELLED', 403], ['FORBIDDEN_AGENT', 403],
  ['host_disconnected', 502], ['UNAVAILABLE', 502], ['BAD_ARGS', 400], ['INVALID', 400], ['DENIED', 400]
])('preserves %s authorization failures across create, list, get, and stop', async (code, httpStatus) => {
  const ops = await boot();
  const failure = { ok: false, code, message: 'denied' };
  for (const method of ['create', 'list', 'get', 'close'] as const) ops[method].mockResolvedValue(failure);
  expect((await request('', 'POST', { projectId: 'p', profile: 'shell' })).status).toBe(httpStatus);
  expect((await request()).status).toBe(httpStatus);
  expect((await request('/s')).status).toBe(httpStatus);
  expect((await request('/s/stop', 'POST', {})).status).toBe(httpStatus);
});

it('handles list envelopes and filters tags before status requests', async () => {
  const ops = await boot();
  ops.list.mockResolvedValue({ ok: true, value: { value: [row, { ...row, id: 'tagged', title: 'keep' }] } });
  ops.status.mockResolvedValue({ ok: true, value: { status: 'working' } });
  expect((await request('?tag=keep')).body.agents).toEqual([expect.objectContaining({ id: 'tagged', hostId: 'primary', status: 'working' })]);
  expect(ops.status).toHaveBeenCalledExactlyOnceWith('tagged');
  ops.list.mockResolvedValue({ ok: true, value: {} });
  expect((await request()).body.agents).toEqual([]);
  ops.list.mockResolvedValue({ ok: true, value: [row] });
  ops.status.mockResolvedValue({ ok: false, code: 'NOT_FOUND', message: 'gone' });
  expect((await request()).body.agents[0].status).toBe('running');
});

it('validates single-session responses without inventing an execution owner', async () => {
  const ops = await boot();
  for (const value of [null, {}, { value: { id: 'missing-project' } }]) {
    ops.get.mockResolvedValueOnce({ ok: true, value });
    expect((await request('/s')).status).toBe(404);
  }
  ops.get.mockResolvedValue({ ok: true, value: { value: row } });
  ops.status.mockResolvedValueOnce({ ok: true, value: { value: { state: 'done' } } });
  expect((await request('/s')).body.agent).toMatchObject({ hostId: 'primary', status: 'done' });
  ops.status.mockResolvedValueOnce({ ok: true, value: null });
  expect((await request('/s')).body.agent.status).toBe('unknown');
});

it('validates replies and rejects unsupported route shapes', async () => {
  const ops = await boot();
  for (const text of ['', 1, null]) expect((await request('/s/reply', 'POST', { text })).status).toBe(400);
  expect(ops.reply).not.toHaveBeenCalled();
  expect((await request('/s/reply', 'POST', { text: 'hello' })).status).toBe(200);
  expect(ops.reply).toHaveBeenCalledWith('s', 'hello');
  expect((await request('/s/unknown', 'POST', {})).status).toBe(404);
  expect((await request('/s/stop', 'GET')).status).toBe(404);
});
