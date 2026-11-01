import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { upsertHost } from '@zana-ai/zcc-db';
import { inspectDirectories } from '../../../host-daemon/src/inspect-directories.js';
import { mkdirHostPath } from '../../../host-daemon/src/host-fs.js';
import { startProductServer, type ProductServer } from './product-server.js';
import { HostUnavailableError } from './host-hub.js';
import { validatedProjectPath } from './machine-project-api.js';

let server: ProductServer, root: string, hostId: string, primaryId: string, online: string[];
let rpc: ReturnType<typeof vi.spyOn>;
const call = (path: string, body: unknown) => fetch(`${server.url}api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const input = (name = 'new-project') => ({ hostId, parentPath: join(root, 'remote'), name, operationId: randomUUID() });
beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'machine-project-api-')));
  mkdirSync(join(root, 'remote')); mkdirSync(join(root, 'local'));
  server = await startProductServer({ dataDir: join(root, 'data'), origins: { serverPort: 0 } });
  await server.ctx.machineProjectSync?.dispose();
  primaryId = upsertHost(server.ctx.db, { name: 'Local', hostKeyHash: 'a'.repeat(64), isPrimary: true, homeDir: join(root, 'local') }).id;
  hostId = upsertHost(server.ctx.db, { name: 'Remote', hostKeyHash: 'b'.repeat(64), isPrimary: false, homeDir: join(root, 'remote') }).id;
  online = [primaryId, hostId];
  vi.spyOn(server.ctx.hostHub, 'connectedHostIds').mockImplementation(() => online);
  vi.spyOn(server.ctx.hostHub, 'resolveHostId').mockImplementation(id => { if (!id || !online.includes(id)) throw new HostUnavailableError(); return id; });
  vi.spyOn(server.ctx.hostHub, 'ensureHostSessionReady').mockImplementation(id => { if (!online.includes(id)) throw new HostUnavailableError(); });
  rpc = vi.spyOn(server.ctx.hostHub, 'callHostOnlineRpc').mockImplementation(async ({ command }) => {
    if (command.type === 'host.inspect_directories') return inspectDirectories(command.paths);
    if (command.type === 'project.catalogue.register') return { projects: command.projects.map(row => ({ id: randomUUID(), name: 'project', ...row })) };
    if (command.type === 'host.mkdir') return mkdirHostPath(command);
    if (command.type === 'project.clone_default_path') return { path: '/remote/checkouts/project' };
    throw new Error('Unexpected command');
  });
});
afterEach(async () => { await server?.close(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

it('registers the canonical remote folder and deduplicates aliases', async () => {
  const folder = join(root, 'remote', 'repo'), alias = join(root, 'remote', 'alias'); mkdirSync(folder); symlinkSync(folder, alias);
  const first = await call('/projects', { path: alias, hostId }); expect(first.status).toBe(200);
  const project = (await first.json()).project;
  expect(project).toMatchObject({ path: folder, hostId, name: 'repo' });
  const again = await call('/projects', { path: folder, hostId });
  expect((await again.json()).project.id).toBe(project.id);
  expect(server.ctx.projects.list()).toHaveLength(1);
});
it('preserves an explicitly selected primary machine as the registered target', async () => {
  const path = join(root, 'local');
  const first = await call('/projects', { path, hostId: primaryId });
  expect(first.status).toBe(200);
  const project = (await first.json()).project;
  expect(project).toMatchObject({ path, hostId: primaryId });
  const again = await call('/projects', { path, hostId: primaryId });
  expect((await again.json()).project.id).toBe(project.id);
});
it('rejects missing folders, files, unknown machines and invalid remote paths', async () => {
  const file = join(root, 'remote', 'file'); writeFileSync(file, '');
  for (const body of [{ path: file, hostId }, { path: join(root, 'missing'), hostId }, { path: root, hostId: 'missing' }, { path: 'relative', hostId }]) {
    expect((await call('/projects', body)).ok).toBe(false);
  }
  expect(server.ctx.projects.list()).toHaveLength(0);
});
it.each([null, { path: '/repo', hostId: 4 }, { path: '/repo', hostId: '' }, { path: '/repo\u0000bad' }])('rejects malformed registration without falling back to local: %j', async body => {
  expect((await call('/projects', body)).status).toBe(400);
  expect(server.ctx.projects.list()).toHaveLength(0);
});
it('does not register on another machine when the selected host is offline', async () => {
  online = [primaryId];
  expect((await call('/projects', { path: join(root, 'remote'), hostId })).status).toBe(503);
  expect((await call('/projects/create-folder', input())).status).toBe(503);
  expect(server.ctx.projects.list()).toHaveLength(0);
});
it('creates only on the selected host, broadcasts, and replays the same operation', async () => {
  const request = input();
  const emit = vi.spyOn(server.ctx.hub, 'emit');
  const responses = await Promise.all([call('/projects/create-folder', request), call('/projects/create-folder', request)]);
  expect(responses.map(r => r.status)).toEqual([201, 201]);
  const projects = await Promise.all(responses.map(r => r.json()));
  expect(projects[0].project.id).toBe(projects[1].project.id);
  expect(projects[0].project).toMatchObject({ path: join(root, 'remote', request.name), hostId });
  expect(existsSync(join(root, 'local', request.name))).toBe(false);
  expect(rpc.mock.calls.filter(([arg]) => arg.command.type === 'host.mkdir')).toHaveLength(1);
  expect(emit).toHaveBeenCalledWith('projects:changed', expect.any(Array));
  const conflict = await call('/projects/create-folder', { ...request, name: 'another' }); expect(conflict.status).toBe(409);
});
it('creates local projects without turning their saved target into a remote', async () => {
  const response = await call('/projects/create-folder', { ...input(), hostId: primaryId, parentPath: join(root, 'local') });
  expect(response.status).toBe(201);
  expect((await response.json()).project.hostId).toBeUndefined();
});
it('canonicalizes a HOME alias before authorizing its parent folder', async () => {
  const alias = join(root, 'home-alias'); symlinkSync(join(root, 'remote'), alias);
  upsertHost(server.ctx.db, { id: hostId, name: 'Remote', hostKeyHash: 'b'.repeat(64), homeDir: alias });
  expect((await call('/projects/create-folder', input())).status).toBe(201);
});
it('keeps local and remote registrations distinct even when absolute paths coincide', async () => {
  const path = join(root, 'remote');
  const remote = await call('/projects', { path, hostId });
  const local = await call('/projects', { path });
  expect((await remote.json()).project.id).not.toBe((await local.json()).project.id);
  expect(server.ctx.projects.list()).toHaveLength(2);
});
it('validates and labels a Windows path on its own host without applying the server OS path rules', async () => {
  rpc.mockResolvedValueOnce({ directories: [{ requestedPath: 'C:\\repos\\alias', path: 'C:\\repos\\api', status: 'ready' }] });
  const response = await call('/projects', { path: 'C:\\repos\\alias', hostId });
  expect(response.status).toBe(200);
  expect((await response.json()).project).toMatchObject({ hostId, name: 'api', path: 'C:\\repos\\api' });
});
it('confines creation after resolving parent symlinks, and never overwrites existing folders', async () => {
  mkdirSync(join(root, 'outside')); symlinkSync(join(root, 'outside'), join(root, 'remote', 'escape'));
  expect((await call('/projects/create-folder', { ...input(), parentPath: join(root, 'remote', 'escape') })).status).toBe(409);
  mkdirSync(join(root, 'remote', 'existing')); writeFileSync(join(root, 'remote', 'existing', 'keep'), 'keep');
  expect((await call('/projects/create-folder', input('existing'))).status).toBe(409);
  expect(existsSync(join(root, 'remote', 'existing', 'keep'))).toBe(true);
});
it('permits a registered canonical anchor outside HOME', async () => {
  const outside = join(root, 'outside'); mkdirSync(outside);
  await server.ctx.projects.add(outside, { hostId });
  expect((await call('/projects/create-folder', { ...input(), parentPath: outside })).status).toBe(201);
});
it('keeps newly created folders if central registration fails and explains recovery', async () => {
  vi.spyOn(server.ctx.projects, 'add').mockRejectedValueOnce(new Error('disk full'));
  const response = await call('/projects/create-folder', input('kept'));
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('Open existing folder');
  expect(existsSync(join(root, 'remote', 'kept'))).toBe(true);
});
it.each([{ name: '../escape' }, { parentPath: 'relative' }, { name: '.' }, { name: 'trailing.' }, { extra: true }, { operationId: 'invalid' }])('rejects invalid create request %j', async patch => {
  expect((await call('/projects/create-folder', { ...input(), ...patch })).status).toBe(400);
  expect(server.ctx.projects.list()).toHaveLength(0);
});
it('returns folder state without deleting registrations and refreshes after reconnect', async () => {
  const missing = await server.ctx.projects.add(join(root, 'absent'), { hostId });
  const ready = await server.ctx.projects.add(join(root, 'remote'), { hostId });
  const response = await call('/projects/availability', { projectIds: [missing.id, ready.id, 'unknown'] });
  expect((await response.json()).statuses).toEqual({ [missing.id]: 'missing', [ready.id]: 'ready', unknown: 'unknown' });
  online = [primaryId];
  expect((await (await call('/projects/availability', { projectIds: [ready.id] })).json()).statuses[ready.id]).toBe('offline');
  online.push(hostId); rpc.mockRejectedValueOnce(new Error('permission or transport failure'));
  expect((await (await call('/projects/availability', { projectIds: [ready.id] })).json()).statuses[ready.id]).toBe('unknown');
  expect(server.ctx.projects.list()).toHaveLength(2);
});
it('checks the remote checkout of a legacy SSH project, never its local placeholder', async () => {
  const project = await server.ctx.projects.add(join(root, 'placeholder'), { hostId });
  vi.spyOn(server.ctx, 'toProjects').mockReturnValue([{ ...project, remote: { host: 'ssh-box', remotePath: join(root, 'remote') } } as any]);
  const response = await call('/projects/availability', { projectIds: [project.id] });
  expect((await response.json()).statuses[project.id]).toBe('ready');
});
it('bounds the availability deadline across machines', async () => {
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const host = upsertHost(server.ctx.db, { name: `Host ${i}`, hostKeyHash: String(i).repeat(64) });
    online.push(host.id); ids.push((await server.ctx.projects.add(join(root, 'remote'), { hostId: host.id })).id);
  }
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
  rpc.mockImplementation(async ({ command }: any) => {
    now += 16_000;
    return { directories: command.paths.map((path: string) => ({ requestedPath: path, path, status: 'ready' })) };
  });
  const response = await call('/projects/availability', { projectIds: ids });
  const statuses = (await response.json()).statuses;
  expect(statuses[ids[0]]).toBe('ready');
  expect(ids.slice(1).every(id => statuses[id] === 'unknown')).toBe(true);
  expect(rpc).toHaveBeenCalledOnce();
});
it('bounds availability input and reads remote clone roots from the correct daemon', async () => {
  expect((await call('/projects/availability', { projectIds: Array(101).fill('p') })).status).toBe(400);
  const response = await fetch(`${server.url}api/v1/projects/clone-root?hostId=${hostId}`);
  expect(await response.json()).toEqual({ path: '/remote/checkouts' });
  expect(rpc).toHaveBeenCalledWith({ hostId, command: { type: 'project.clone_default_path', projectSlug: 'project' } });
});
it('rejects inaccessible and malformed daemon directory reports', async () => {
  rpc.mockResolvedValueOnce({ directories: [{ requestedPath: '/repo', path: null, status: 'inaccessible' }] });
  await expect(validatedProjectPath(server.ctx, '/repo', hostId)).rejects.toThrow('not accessible');
  rpc.mockResolvedValueOnce({ directories: [{ requestedPath: '/repo', path: 'relative', status: 'ready' }] });
  await expect(validatedProjectPath(server.ctx, '/repo', hostId)).rejects.toThrow('not accessible');
});
