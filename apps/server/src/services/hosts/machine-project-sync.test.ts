import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { upsertHost } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from '../../http/product-server.js';
import { createMachineProjectSync, type MachineProjectSync } from './machine-project-sync.js';
import { ProjectCatalogue } from '@zana-ai/zcc-host-daemon/project-catalogue';
import { inspectDirectories } from '@zana-ai/zcc-host-daemon/inspect-directories';

let root: string, server: ProductServer, hostId: string, primaryId: string, registry: ProjectCatalogue, sync: MachineProjectSync;
let online: string[], session: object;
let rpc: ReturnType<typeof vi.spyOn>;
const revision = 'a'.repeat(64);
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'project-auto-sync-')));
  server = await startProductServer({ dataDir: join(root, 'server'), origins: { serverPort: 0 } });
  await server.ctx.machineProjectSync?.dispose();
  primaryId = upsertHost(server.ctx.db, { name: 'Local', hostKeyHash: 'a'.repeat(64), isPrimary: true, homeDir: root }).id;
  hostId = upsertHost(server.ctx.db, { name: 'Remote', hostKeyHash: 'b'.repeat(64), isPrimary: false, homeDir: root }).id;
  online = [hostId]; session = {};
  vi.spyOn(server.ctx.hostHub, 'connectedHostIds').mockImplementation(() => online);
  vi.spyOn(server.ctx.hostHub, 'getSession').mockImplementation(() => session as any);
  registry = new ProjectCatalogue(join(root, 'daemon'), join(root, 'source'));
  rpc = vi.spyOn(server.ctx.hostHub, 'callHostOnlineRpc').mockImplementation(async ({ command }) => {
    if (command.type === 'project.catalogue.list') return registry.page(command.offset, command.limit);
    if (command.type === 'project.catalogue.register') return { projects: await registry.register(command.projects) };
    if (command.type === 'host.inspect_directories') return inspectDirectories(command.paths);
    throw new Error(`Unexpected ${command.type}`);
  });
  sync = server.ctx.machineProjectSync = createMachineProjectSync(server.ctx);
});
afterEach(async () => { await sync.dispose(); await registry.close(); await server.close(); vi.restoreAllMocks(); vi.useRealTimers(); await fs.rm(root, { recursive: true, force: true }); });
async function folder(name = 'api') { const path = join(root, name); await fs.mkdir(path); return path; }
async function localSource(projects: unknown[]) { await fs.mkdir(join(root, 'source'), { recursive: true }); await fs.writeFile(join(root, 'source', 'projects.json'), JSON.stringify({ version: 1, projects })); }
const listPage = (projects: unknown[], nextOffset: number | null = null) => ({ revision, projects, nextOffset });

it('automatically imports daemon registrations, broadcasts to viewers and leaves activity/history on the server', async () => {
  const path = await folder(); await localSource([{ path, name: 'Remote API' }]);
  const changed = vi.fn(), off = server.ctx.hub.subscribe('projects:changed', changed);
  await sync.request(hostId);
  const [project] = server.ctx.projects.list();
  expect(project).toMatchObject({ path, name: 'Remote API', hostId }); expect(changed).toHaveBeenCalledOnce();
  expect(sync.status(hostId)).toMatchObject({ status: 'synced', lastSyncedAt: expect.any(Number) });
  const touched = project.lastActiveAt;
  await sync.request(hostId); expect(server.ctx.projects.list()).toHaveLength(1);
  expect(server.ctx.projects.list()[0].lastActiveAt).toBe(touched); expect(changed).toHaveBeenCalledOnce(); off();
  const status = await fetch(`${server.url}api/v1/projects/sync-status?hostId=${hostId}`); expect((await status.json()).status).toBe('synced');
  expect((await fetch(`${server.url}api/v1/projects/sync-status?hostId=missing`)).status).toBe(404);
});
it('seeds existing projects without changing IDs, excludes Default Project and isolates machines', async () => {
  const path = await folder();
  const remote = await server.ctx.projects.add(path, { hostId });
  const local = await server.ctx.projects.add(path);
  await fs.writeFile(join(root, 'server', 'projects.json'), JSON.stringify({ version: 1, projects: [...server.ctx.projects.list(), { id: randomUUID(), name: 'Default', path: root, quickAgent: true }] }));
  online.push(primaryId); await sync.request();
  const projects = server.ctx.projects.list(); expect(projects).toHaveLength(3);
  expect(projects.find(row => row.hostId === hostId)?.id).toBe(remote.id);
  expect(projects.find(row => !row.hostId && !row.quickAgent)?.id).toBe(local.id);
  expect((await registry.page(0, 100)).projects).toHaveLength(1);
});
it('keeps removed registrations hidden across sync restarts and permits explicit re-add', async () => {
  const path = await folder(); await registry.register([{ path }]); await sync.request(hostId);
  const [project] = server.ctx.projects.list(); await server.ctx.projects.remove(project.id);
  await sync.request(hostId); expect(server.ctx.projects.list()).toHaveLength(0);
  await sync.dispose(); sync = server.ctx.machineProjectSync = createMachineProjectSync(server.ctx);
  await sync.request(hostId); expect(server.ctx.projects.list()).toHaveLength(0);
  const readded = await server.ctx.projects.add(path, { hostId }); await sync.request(hostId);
  expect(server.ctx.projects.list().map(row => row.id)).toEqual([readded.id]);
});
it('updates mirrored names while preserving viewer custom names and missing folders', async () => {
  const path = await folder(); await localSource([{ path, name: 'First' }]); await sync.request(hostId);
  const [project] = server.ctx.projects.list(); await localSource([{ path, name: 'Second name' }]); await sync.request(hostId);
  expect(server.ctx.projects.list()[0].name).toBe('Second name');
  await server.ctx.projects.update(project.id, { name: 'My name' });
  await localSource([{ path, name: 'Third name' }]); await sync.request(hostId);
  expect(server.ctx.projects.list()[0].name).toBe('My name');
  await fs.rm(path, { recursive: true }); await sync.request(hostId);
  expect(server.ctx.projects.list()[0].id).toBe(project.id);
});
it('retains project IDs and removal choices when a reinstalled daemon rotates catalogue IDs', async () => {
  const kept = await folder('kept'), hidden = await folder('hidden');
  await registry.register([{ path: kept }, { path: hidden }]); await sync.request(hostId);
  const projects = server.ctx.projects.list(), keptId = projects.find(row => row.path === kept)!.id;
  await server.ctx.projects.remove(projects.find(row => row.path === hidden)!.id); await sync.request(hostId);
  await fs.rm(registry.file);
  await registry.register([{ path: kept }, { path: hidden }]); await sync.request(hostId);
  expect(server.ctx.projects.list().map(row => row.id)).toEqual([keptId]);
  const cache = JSON.parse(await fs.readFile(join(root, 'server', 'machine-project-sync.json'), 'utf8'));
  expect(Object.keys(cache[hostId].entries)).toHaveLength(2);
});
it('retains cached projects during disconnection, retries failures and recovers without duplicates', async () => {
  const path = await folder(); await registry.register([{ path }]); await sync.request(hostId);
  const id = server.ctx.projects.list()[0].id, lastSyncedAt = sync.status(hostId).lastSyncedAt;
  online = []; await sync.request(hostId); expect(sync.status(hostId)).toMatchObject({ status: 'offline', lastSyncedAt });
  online = [hostId]; rpc.mockRejectedValueOnce(new Error('network unavailable')); await sync.request(hostId);
  expect(sync.status(hostId)).toMatchObject({ status: 'error', error: 'network unavailable', lastSyncedAt });
  await sync.request(hostId); expect(sync.status(hostId).status).toBe('synced'); expect(server.ctx.projects.list()[0].id).toBe(id);
});
it('ignores results from a replaced daemon session', async () => {
  rpc.mockImplementationOnce(async () => { session = {}; return listPage([{ id: randomUUID(), path: '/replaced', name: 'No' }]); });
  await sync.request(hostId); expect(server.ctx.projects.list()).toHaveLength(0); expect(sync.status(hostId).error).toContain('changed connection');
});
it('imports paged catalogues with a stable revision', async () => {
  const entries = Array.from({ length: 101 }, (_, i) => ({ id: randomUUID(), name: `Project ${i}`, path: join(root, `cached-${i}`) }));
  await fs.mkdir(join(root, 'daemon')); await fs.writeFile(registry.file, JSON.stringify({ version: 1, projects: entries }));
  await sync.request(hostId); expect(server.ctx.projects.list()).toHaveLength(101);
  expect(new Set(server.ctx.projects.list().map(row => row.id)).size).toBe(101);
});
it.each(['pagination', 'revision', 'duplicates', 'relocation'])('rejects unsafe catalogue %s without deleting cached rows', async kind => {
  const path = await folder(); const [entry] = await registry.register([{ path }]); await sync.request(hostId);
  rpc.mockImplementation(async () => {
    if (kind === 'pagination') return listPage([entry], 1);
    if (kind === 'duplicates') return listPage([entry, entry]);
    if (kind === 'relocation') return listPage([{ ...entry, path: '/another-folder' }]);
    return { revision: rpc.mock.calls.length % 2 ? 'a'.repeat(64) : 'b'.repeat(64), projects: Array.from({ length: 100 }, (_, i) => ({ ...entry, id: randomUUID(), path: `/p-${i}` })), nextOffset: 100 };
  });
  await sync.request(hostId); expect(sync.status(hostId).status).toBe('error'); expect(server.ctx.projects.list()).toHaveLength(1);
});
it('rejects incomplete seeding replies, skips unavailable roots and protects corrupt cache files', async () => {
  const path = await folder(); await server.ctx.projects.add(path, { hostId });
  rpc.mockImplementationOnce(async () => ({ directories: [{ requestedPath: path, path, status: 'ready' }] })).mockResolvedValueOnce({ projects: [] });
  await sync.request(hostId); expect(sync.status(hostId).error).toContain('incomplete');
  await fs.rm(path, { recursive: true }); await sync.request(hostId); expect(server.ctx.projects.list()).toHaveLength(1);
  await sync.dispose(); await fs.writeFile(join(root, 'server', 'machine-project-sync.json'), 'broken');
  sync = server.ctx.machineProjectSync = createMachineProjectSync(server.ctx); await sync.request(hostId);
  expect(sync.status(hostId).error).toContain('unreadable'); expect(await fs.readFile(join(root, 'server', 'machine-project-sync.json'), 'utf8')).toBe('broken');
});
it('coalesces triggers, retries only connected failures and releases subscriptions on shutdown', async () => {
  rpc.mockRejectedValue(new Error('offline')); await sync.request(hostId);
  vi.useFakeTimers(); await sync.dispose();
  sync = server.ctx.machineProjectSync = createMachineProjectSync(server.ctx);
  await Promise.all(Array.from({ length: 20 }, () => sync.request(hostId)));
  const before = rpc.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15_000); await sync.request(hostId); expect(rpc.mock.calls.length).toBeGreaterThan(before);
  await sync.dispose(); const stopped = rpc.mock.calls.length;
  server.ctx.hub.emit('projects:changed', []); await sync.request(hostId); await vi.advanceTimersByTimeAsync(30_000);
  expect(rpc.mock.calls.length).toBe(stopped);
});
