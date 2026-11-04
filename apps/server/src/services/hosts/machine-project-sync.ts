import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getHost, getPrimaryHost } from '@zana-ai/zcc-db';
import { machineProjectPageSchema, machineProjectSchema, type MachineProject } from '@zana-ai/zcc-contracts/machine-projects';
import type { ProductHttpContext } from '../../http/product-context.js';
import { createCoalescedReconciler } from './coalesced-reconciler.js';

const entrySchema = z.object({ projectId: z.string(), path: z.string().max(4096), name: z.string().max(256), hidden: z.boolean() });
const hostStateSchema = z.object({ lastSyncedAt: z.number(), entries: z.record(z.string(), entrySchema) });
const stateSchema = z.record(z.string(), hostStateSchema);
type HostState = z.infer<typeof hostStateSchema>;
export type MachineProjectSyncStatus = { hostId: string; status: 'syncing' | 'synced' | 'offline' | 'error'; lastSyncedAt: number | null; error?: string };

/** One bounded machine inventory -> existing product identities. Never import histories or replay work. */
export function createMachineProjectSync(ctx: ProductHttpContext) {
  const file = join(ctx.dataDir, 'machine-project-sync.json');
  const pending = new Set<string>(), errors = new Map<string, string>(), syncing = new Set<string>();
  const rememberError = (hostId: string, error: string) => {
    if (!errors.has(hostId) && errors.size >= 128) errors.delete(errors.keys().next().value!);
    errors.set(hostId, error);
  };
  let disposed = false, state: z.infer<typeof stateSchema> = {};
  let writeTail: Promise<unknown> = Promise.resolve();
  const loaded = (async () => {
    try {
      const handle = await fs.open(file, 'r');
      try {
        const buffer = Buffer.alloc(4 * 1024 * 1024 + 1);
        let length = 0;
        while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
        if (length >= buffer.length) throw new Error('Machine project sync cache exceeds its size limit');
        state = stateSchema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')));
        if (Object.keys(state).length > 128 || Object.values(state).reduce((sum, row) => sum + Object.keys(row.entries).length, 0) > 10_000) throw new Error('Machine project sync cache exceeds its entry limit');
      } finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  })();
  // A corrupt cache must never be replaced with an empty inventory, which could resurrect hidden rows.
  void loaded.catch(() => {});
  const save = () => {
    const task = writeTail.then(async () => {
      const bytes = JSON.stringify(state);
      if (Buffer.byteLength(bytes) > 4 * 1024 * 1024 || Object.values(state).reduce((sum, row) => sum + Object.keys(row.entries).length, 0) > 10_000) throw new Error('Machine project sync cache is full');
      await fs.mkdir(ctx.dataDir, { recursive: true });
      const temp = `${file}.tmp-${randomUUID()}`;
      try {
        const handle = await fs.open(temp, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temp, file);
      } finally { await fs.rm(temp, { force: true }); }
    });
    writeTail = task.catch(() => {}); return task;
  };
  const belongs = (project: ReturnType<typeof ctx.projects.list>[number], hostId: string) =>
    !project.quickAgent && (project.hostId ?? (!project.remote ? getPrimaryHost(ctx.db)?.id : undefined)) === hostId;
  const status = (hostId: string): MachineProjectSyncStatus => ({ hostId,
    status: !ctx.hostHub.connectedHostIds().includes(hostId) ? 'offline' : errors.has(hostId) ? 'error' : syncing.has(hostId) || !state[hostId]?.lastSyncedAt ? 'syncing' : 'synced',
    lastSyncedAt: state[hostId]?.lastSyncedAt || null, ...(errors.has(hostId) ? { error: errors.get(hostId) } : {}) });
  const publish = (hostId: string) => { if (!disposed) ctx.hub.emit('projects:sync', status(hostId)); };

  async function syncHost(hostId: string) {
    const host = getHost(ctx.db, hostId);
    if (!host || host.destroyedAt || host.enrollmentCapability !== 'execution' || !ctx.hostHub.connectedHostIds().includes(hostId)) return;
    if (!state[hostId] && Object.keys(state).length >= 128) throw new Error('Machine project sync cache is full');
    const session = ctx.hostHub.getSession(hostId);
    const deadline = Date.now() + 30_000;
    const rpc = async <T>(command: Parameters<typeof ctx.hostHub.callHostOnlineRpc>[0]['command']): Promise<T> => {
      if (disposed || ctx.hostHub.getSession(hostId) !== session || Date.now() >= deadline) throw new Error('Machine changed connection or project sync timed out');
      const result = await ctx.hostHub.callHostOnlineRpc<T>({ hostId, command, timeoutMs: Math.min(15_000, deadline - Date.now()) });
      if (disposed || ctx.hostHub.getSession(hostId) !== session) throw new Error('Machine changed connection during project sync');
      return result;
    };
    const previous = state[hostId] ?? { lastSyncedAt: 0, entries: {} };
    const next: HostState = structuredClone(previous);
    let changed = false;
    const local = ctx.projects.list().filter(project => belongs(project, hostId));
    if (local.length > 1000) throw new Error('Machine project catalogue exceeds its project limit');
    const known = new Set(Object.values(next.entries).map(row => row.projectId));
    const unseeded = local.filter(project => !known.has(project.id));
    // Seed pre-existing registrations on this server, so the first daemon upgrade loses no projects.
    for (let offset = 0; offset < unseeded.length; offset += 100) {
      const batch = unseeded.slice(offset, offset + 100);
      const paths = batch.map(project => project.remote && typeof project.remote === 'object'
        ? (project.remote as { remotePath?: string }).remotePath ?? host.homeDir : project.path);
      if (!paths.some(Boolean)) continue;
      const inspected = await rpc<import('@zana-ai/zcc-contracts/host-rpc').HostInspectDirectoriesResult>({ type: 'host.inspect_directories', paths: paths.filter((path): path is string => Boolean(path)) });
      const valid = batch.flatMap((project, index) => {
        const directory = inspected.directories.find(row => row.requestedPath === paths[index]);
        return directory?.status === 'ready' && directory.path ? [{ project, path: directory.path }] : [];
      });
      if (!valid.length) continue;
      const registered = await rpc<{ projects: MachineProject[] }>({ type: 'project.catalogue.register', projects: valid.map(row => ({ path: row.path, name: row.project.name })) });
      for (const row of valid) {
        const entry = registered.projects.map(item => machineProjectSchema.parse(item)).find(entry => entry.path === row.path);
        if (!entry) throw new Error('Machine returned an incomplete project registration');
        next.entries[entry.id] ??= { projectId: row.project.id, path: entry.path, name: entry.name, hidden: false };
      }
    }
    let entries: MachineProject[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      entries = [];
      let offset = 0, revision: string | undefined, complete = false;
      for (let page = 0; page < 10; page++) {
        const result = machineProjectPageSchema.parse(await rpc({ type: 'project.catalogue.list', offset, limit: 100 }));
        if (revision && revision !== result.revision) break;
        revision = result.revision;
        entries.push(...result.projects);
        if (result.nextOffset === null) { complete = true; break; }
        if (result.nextOffset !== offset + result.projects.length || result.projects.length !== 100) throw new Error('Machine returned invalid project pagination');
        offset = result.nextOffset;
      }
      if (complete) break;
      if (attempt === 2) throw new Error('Machine project list changed during synchronization; retrying');
    }
    if (new Set(entries.map(row => row.id)).size !== entries.length || new Set(entries.map(row => row.path)).size !== entries.length) throw new Error('Machine returned duplicate project identities');
    const current = ctx.projects.list().filter(project => belongs(project, hostId));
    const byId = new Map(current.map(project => [project.id, project]));
    const byPath = new Map(current.map(project => [project.path, project]));
    const priorByPath = new Map(Object.entries(next.entries).map(([id, entry]) => [entry.path, { id, entry }]));
    let processed = 0;
    for (const entry of entries) {
      if (++processed % 10 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      if (disposed || ctx.hostHub.getSession(hostId) !== session) throw new Error('Machine disconnected during project sync');
      const prior = priorByPath.get(entry.path);
      const record = next.entries[entry.id] ?? prior?.entry;
      if (record && record.path !== entry.path) throw new Error('A machine project changed folders; explicit relocation is required');
      // A reinstalled daemon can mint a new catalogue ID for the same folder.
      // Carry the existing identity/removal choice forward and retire its old mapping.
      if (prior && prior.id !== entry.id) delete next.entries[prior.id];
      if (record) next.entries[entry.id] = record;
      let project = byId.get(record?.projectId ?? '') ?? byPath.get(entry.path);
      // A user removed this registration on this server. Preserve that choice across reconnects.
      if (!project && record) { record.hidden = true; continue; }
      if (!project) { project = await ctx.projects.add(entry.path, host.isPrimary ? undefined : { hostId }); changed = true; }
      if (record && project.name === record.name && project.name !== entry.name) {
        project = await ctx.projects.update(project.id, { name: entry.name }) ?? project; changed = true;
      } else if (!record && project.name === (entry.path.split(/[\\/]/).pop() || entry.path) && project.name !== entry.name) {
        project = await ctx.projects.update(project.id, { name: entry.name }) ?? project; changed = true;
      }
      next.entries[entry.id] = { projectId: project.id, path: entry.path, name: entry.name, hidden: false };
    }
    if (Object.keys(next.entries).length > 1000) throw new Error('Machine project sync cache is full');
    next.lastSyncedAt = Date.now();
    state[hostId] = next;
    await save();
    errors.delete(hostId);
    if (changed && !disposed) ctx.hub.emit('projects:changed', ctx.projects.list());
  }
  const worker = createCoalescedReconciler(async () => {
    try { await loaded; } catch { for (const id of pending) { rememberError(id, 'Project sync cache is unreadable; cached projects have been kept'); publish(id); } pending.clear(); return; }
    const queue = [...pending]; pending.clear();
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      let hostId: string | undefined;
      while ((hostId = queue.shift())) {
        syncing.add(hostId); publish(hostId);
        try { await syncHost(hostId); }
        catch (error) { rememberError(hostId, error instanceof Error ? error.message : 'Project sync failed'); }
        finally { syncing.delete(hostId); publish(hostId); }
      }
    }));
  }, () => {});
  function request(hostId?: string): Promise<void> {
    if (disposed) return Promise.resolve();
    for (const id of hostId ? [hostId] : ctx.hostHub.connectedHostIds()) if (pending.size < 128) pending.add(id);
    return worker.request();
  }
  const stopProjects = ctx.hub.subscribe('projects:changed', () => { void request(); });
  const timer = setInterval(() => { for (const id of errors.keys()) if (ctx.hostHub.connectedHostIds().includes(id)) void request(id); }, 15_000);
  timer.unref();
  return { request, status, async dispose() { disposed = true; stopProjects(); clearInterval(timer); pending.clear(); await worker.dispose(); await writeTail; } };
}
export type MachineProjectSync = ReturnType<typeof createMachineProjectSync>;
