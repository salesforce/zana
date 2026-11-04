import type { IncomingMessage, ServerResponse } from 'node:http';
import { posix, win32 } from 'node:path';
import { z } from 'zod';
import { getHost, getPrimaryHost } from '@zana-ai/zcc-db';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { HostInspectDirectoriesResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from './product-context.js';
import { HostUnavailableError } from './host-hub.js';
import { resolveProjectHost } from './project-host.js';
import { readJsonBody, sendJson } from './json.js';

const absolutePath = z.string().min(1).max(4096).refine(path => !/[\x00-\x1f]/.test(path) && (posix.isAbsolute(path) || win32.isAbsolute(path)), 'Choose an absolute folder path');
const createInput = z.object({
  hostId: z.string().min(1).max(128),
  parentPath: absolutePath,
  name: z.string().min(1).max(120).refine(name => name === name.trim() && !/[\\/:\x00-\x1f]/.test(name) && name !== '.' && name !== '..' && !/[. ]$/.test(name), 'Choose a folder name without separators'),
  operationId: z.string().uuid()
}).strict();
const operations = new WeakMap<ProductHttpContext, Map<string, { input: string; createdAt: number; result: Promise<Project> }>>();
const pathTools = (path: string) => /^[A-Za-z]:[\\/]|^\\\\/.test(path) ? win32 : posix;
function contains(root: string, path: string): boolean {
  const tools = pathTools(root), rel = tools.relative(root, path);
  return rel === '' || (!rel.startsWith(`..${tools.sep}`) && rel !== '..' && !tools.isAbsolute(rel));
}

export async function inspectProjectDirectories(ctx: ProductHttpContext, hostId: string, paths: string[], timeoutMs = 15_000) {
  ctx.hostHub.ensureHostSessionReady(hostId);
  return ctx.hostHub.callHostOnlineRpc<HostInspectDirectoriesResult>({ hostId,
    command: { type: 'host.inspect_directories', paths }, timeoutMs });
}

/** Registration authority stays in the server; only its selected host resolves paths. */
export async function validatedProjectPath(ctx: ProductHttpContext, path: string, hostId: string): Promise<string> {
  if (!absolutePath.safeParse(path).success) throw Object.assign(new Error('Choose an absolute folder path'), { status: 400 });
  const host = getHost(ctx.db, hostId);
  if (!host || host.destroyedAt || host.enrollmentCapability !== 'execution') throw Object.assign(new Error('Machine is not registered'), { status: 404 });
  const result = await inspectProjectDirectories(ctx, hostId, [path]);
  const entry = result.directories.find(row => row.requestedPath === path);
  if (entry?.status !== 'ready' || !entry.path || !absolutePath.safeParse(entry.path).success) {
    throw Object.assign(new Error(entry?.status === 'missing' ? 'Folder does not exist on this machine' : entry?.status === 'not-directory' ? 'Choose a folder, not a file' : 'Folder is not accessible on this machine'), { status: 400 });
  }
  return entry.path;
}

async function createFolder(ctx: ProductHttpContext, input: z.infer<typeof createInput>): Promise<Project> {
  const hostId = resolveProjectHost(ctx, input.hostId);
  const host = getHost(ctx.db, hostId);
  if (!host || host.destroyedAt || host.enrollmentCapability !== 'execution') throw new Error('Machine is not registered');
  const parent = await validatedProjectPath(ctx, input.parentPath, hostId);
  const primary = getPrimaryHost(ctx.db);
  const roots = [host.homeDir, host.isPrimary ? ctx.config.getConfig().cloneRoot : undefined,
    ...ctx.toProjects().filter(p => !p.remote && (p.hostId ?? primary?.id) === hostId && (contains(p.path, parent) || contains(p.path, input.parentPath))).map(p => p.path)]
    .filter((root): root is string => Boolean(root));
  // A renderer-picked parent is not itself authority. Realpath-match an existing
  // HOME/project anchor before granting the mkdir capability (Rules 1 and 2).
  let root: string | undefined;
  for (const candidate of roots.slice(0, 100)) {
    try {
      const canonical = await validatedProjectPath(ctx, candidate, hostId);
      if (contains(canonical, parent)) { root = canonical; break; }
    } catch (error) { if (error instanceof HostUnavailableError) throw error; }
  }
  if (!root) throw new Error('Choose a parent folder inside this machine’s home folder or a registered project');
  const target = pathTools(parent).join(parent, input.name);
  await ctx.hostHub.callHostOnlineRpc({ hostId,
    command: { type: 'host.mkdir', path: target, rootPath: root, boundaryPath: parent, recursive: false } });
  try {
    const path = await validatedProjectPath(ctx, target, hostId);
    await ctx.hostHub.callHostOnlineRpc({ hostId, command: { type: 'project.catalogue.register', projects: [{ path }] } });
    const project = await ctx.projects.add(path, host.isPrimary ? undefined : { hostId });
    ctx.hub.emit('projects:changed', ctx.projects.list());
    return project as Project;
  } catch {
    throw new Error(`Folder created at ${target}. Use Open existing folder to finish adding it; its files have been kept.`);
  }
}

/** New creation and read-only availability surfaces, under the existing product auth. */
export async function handleMachineProjectApi(req: IncomingMessage, res: ServerResponse, ctx: ProductHttpContext, path: string, method: string): Promise<boolean> {
  if (method === 'GET' && path === '/api/v1/projects/sync-status') {
    const hostId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('hostId') ?? '';
    const host = getHost(ctx.db, hostId);
    if (!host || host.destroyedAt || host.enrollmentCapability !== 'execution') sendJson(res, 404, { error: 'Machine is not registered' });
    else sendJson(res, 200, ctx.machineProjectSync?.status(hostId) ?? { hostId, status: 'offline', lastSyncedAt: null });
    return true;
  }
  if (method !== 'POST' || !['/api/v1/projects/create-folder', '/api/v1/projects/availability'].includes(path)) return false;
  try {
    const body = await readJsonBody(req);
    if (path.endsWith('/create-folder')) {
      const input = createInput.parse(body);
      let cache = operations.get(ctx);
      if (!cache) { cache = new Map(); operations.set(ctx, cache); }
      // Bounded, session-local replay protection. Existing folders are never
      // silently adopted on an unknown/restarted operation; Open existing is explicit.
      for (const [id, operation] of cache) if (Date.now() - operation.createdAt > 15 * 60_000) cache.delete(id);
      const key = JSON.stringify(input), previous = cache.get(input.operationId);
      if (previous && previous.input !== key) { sendJson(res, 409, { error: 'This creation request was already used for another folder' }); return true; }
      if (!previous && cache.size >= 128) { sendJson(res, 429, { error: 'Too many folder creation requests; try again later' }); return true; }
      const operation = previous ?? { input: key, createdAt: Date.now(), result: createFolder(ctx, input) };
      cache.set(input.operationId, operation);
      try { sendJson(res, 201, { project: await operation.result }); }
      catch (error) { cache.delete(input.operationId); throw error; }
      return true;
    }
    const { projectIds } = z.object({ projectIds: z.array(z.string().min(1).max(256)).max(100) }).strict().parse(body);
    const projects = ctx.toProjects();
    const primary = getPrimaryHost(ctx.db);
    const online = new Set(ctx.hostHub.connectedHostIds());
    const statuses: Record<string, string> = {};
    const byHost = new Map<string, Array<{ id: string; path: string }>>();
    for (const id of new Set(projectIds)) {
      const project = projects.find(p => p.id === id);
      if (!project) { statuses[id] = 'unknown'; continue; }
      const hostId = project.hostId ?? (!project.remote ? primary?.id : undefined);
      if (!hostId || !online.has(hostId)) { statuses[id] = 'offline'; continue; }
      if (project.quickAgent) { statuses[id] = 'ready'; continue; }
      const folder = project.remote ? project.remote.remotePath ?? getHost(ctx.db, hostId)?.homeDir : project.path;
      if (!folder) { statuses[id] = 'unknown'; continue; }
      byHost.set(hostId, [...byHost.get(hostId) ?? [], { id: project.id, path: folder }]);
    }
    // Four hosts at a time, with one overall deadline, so a slow machine does
    // not leave every other machine's availability waiting indefinitely.
    const queue = [...byHost], deadline = Date.now() + 15_000;
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      let next: typeof queue[number] | undefined;
      while ((next = queue.shift())) {
        const [hostId, rows] = next, remaining = deadline - Date.now();
        try {
          if (remaining <= 0) throw new Error('Availability deadline reached');
          const result = await inspectProjectDirectories(ctx, hostId, rows.map(p => p.path), remaining);
          for (const project of rows) statuses[project.id] = result.directories.find(d => d.requestedPath === project.path)?.status ?? 'unknown';
        } catch { for (const project of rows) statuses[project.id] = ctx.hostHub.connectedHostIds().includes(hostId) ? 'unknown' : 'offline'; }
      }
    }));
    sendJson(res, 200, { statuses });
  } catch (error) {
    sendJson(res, error instanceof z.ZodError ? 400 : error instanceof HostUnavailableError ? 503 : 409,
      { error: error instanceof z.ZodError ? 'Choose a machine, an absolute folder path, and a valid folder name' : error instanceof Error ? error.message : 'Project operation failed' });
  }
  return true;
}
