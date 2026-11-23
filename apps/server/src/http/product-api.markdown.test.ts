import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startProductServer, type ProductServer } from './product-server.js';
import { HostUnavailableError } from './host-hub.js';
import { ProjectFsError } from './project-fs-via-host.js';

const markdown = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('./thread-markdown.js', () => ({ readThreadMarkdown: markdown.read, writeThreadMarkdown: markdown.write }));
let server: ProductServer;
let dataDir: string;
beforeEach(async () => {
  vi.clearAllMocks();
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-markdown-http-'));
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
});
afterEach(async () => { await server?.close(); rmSync(dataDir, { recursive: true, force: true }); });

it('dispatches reads and revision-checked writes with the decoded thread and exact HTTP input', async () => {
  const read = { ok: true, content: '# Saved', sha256: 'read-revision' };
  markdown.read.mockResolvedValue(read);
  const response = await fetch(`${server.url}api/v1/threads/thread%20one/markdown?path=notes%2Fa.md&projectId=p`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(read);
  expect(markdown.read).toHaveBeenCalledExactlyOnceWith(server.ctx, 'thread one', { path: 'notes/a.md', projectId: 'p' });
  const body = { path: 'notes/a.md', content: 'draft\r\n', expectedSha256: 'read-revision' };
  markdown.write.mockResolvedValueOnce({ ok: true, sha256: 'written' }).mockResolvedValueOnce({ ok: false, message: 'Changed on disk' });
  const write = () => fetch(`${server.url}api/v1/threads/thread%20one/markdown`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  expect(await (await write()).json()).toEqual({ ok: true, sha256: 'written' });
  expect(markdown.write).toHaveBeenCalledWith(server.ctx, 'thread one', body);
  expect(await (await write()).json()).toEqual({ ok: false, message: 'Changed on disk' });
  expect(markdown.write).toHaveBeenCalledTimes(2);
});

it('preserves authority and host error status codes without retrying or falling back', async () => {
  markdown.read.mockRejectedValueOnce(new ProjectFsError(403, 'read-only', 'Outside checkout'));
  let response = await fetch(`${server.url}api/v1/threads/t/markdown?path=..%2Foutside.md`);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ ok: false, code: 'read-only', message: 'Outside checkout' });
  markdown.write.mockRejectedValueOnce(new HostUnavailableError('h'));
  response = await fetch(`${server.url}api/v1/threads/t/markdown`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'a.md' })
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false });
  expect(markdown.read).toHaveBeenCalledOnce();
  expect(markdown.write).toHaveBeenCalledOnce();
});
