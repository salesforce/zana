import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | undefined;
let directory: string | undefined;
afterEach(async () => {
  await server?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  server = undefined;
  directory = undefined;
});

it('fails closed before dispatch and binds native tool policy to registered terminal identity', async () => {
  directory = mkdtempSync(join(tmpdir(), 'zcc-product-tool-policy-'));
  server = await startProductServer({ dataDir: directory, origins: { serverPort: 0, devAppPort: 5173 } });
  const post = (id: string, body: unknown) => fetch(`${server!.url}api/v1/terminals/${id}/tool-policy`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const input = { invocationId: 'invoke-1', toolName: 'Read', input: { path: '/work/file' } };
  const missing = await post('unknown', input);
  expect(missing.status).toBe(404);
  await expect(missing.json()).resolves.toMatchObject({ code: 'unknown-session' });

  server.ctx.terminalSessions.set('terminal-1', {
    id: 'terminal-1', projectId: 'project-1', hostId: 'host-1', title: 'Agent', profile: 'codex', cwd: '/work', status: 'running', createdAt: Date.now()
  });
  const noService = await post('terminal-1', input);
  expect(noService.status).toBe(200);
  await expect(noService.json()).resolves.toEqual({ action: 'deny', reason: 'plugin service is unavailable' });

  const decideToolPolicy = vi.fn(async () => ({ action: 'deny', reason: 'restricted path' }));
  server.ctx.plugins = { decideToolPolicy } as never;
  for (const bad of [{ toolName: 'Read' }, { invocationId: 'invoke-1' }, { invocationId: '', toolName: 'Read' }]) {
    const response = await post('terminal-1', bad);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid-tool-policy-request' });
  }
  expect(decideToolPolicy).not.toHaveBeenCalled();

  const response = await post('terminal-1', { ...input, projectId: 'forged', threadId: 'forged', providerId: 'forged' });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ action: 'deny', reason: 'restricted path' });
  expect(decideToolPolicy).toHaveBeenCalledWith({
    invocationId: 'invoke-1', toolName: 'Read', input: { path: '/work/file' },
    threadId: 'terminal-1', projectId: 'project-1', providerId: 'codex'
  });
  const fallback = await post('terminal-1', { invocationId: 'invoke-2', toolName: 'Read', input: null });
  expect(fallback.status).toBe(200);
  expect(decideToolPolicy).toHaveBeenLastCalledWith(expect.objectContaining({ input: {} }));
  const nested = await post('terminal-1', {
    invocationId: 'invoke-3', toolName: 'Read',
    input: { path: '/work/file', nested: [{ password: 'never-leak', ok: 'kept' }, { authToken: 'hidden', deep: { apiKey: 'hidden-too' } }] }
  });
  expect(nested.status).toBe(200);
  expect(decideToolPolicy).toHaveBeenLastCalledWith(expect.objectContaining({
    input: { path: '/work/file', nested: [{ password: '[REDACTED]', ok: 'kept' }, { authToken: '[REDACTED]', deep: { apiKey: '[REDACTED]' } }] }
  }));
  await post('terminal-1', { invocationId: 'invoke-4', toolName: 'Read', input: { long: 'x'.repeat(17_000) } });
  expect(decideToolPolicy).toHaveBeenLastCalledWith(expect.objectContaining({ input: { long: '[REDACTED]' } }));
});
