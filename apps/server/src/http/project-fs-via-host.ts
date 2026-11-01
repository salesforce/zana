import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { HostListDirResult, HostListPathsResult, HostReadFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { FsEntry, FsReadResult, Project } from '@zana-ai/zcc-domain/product';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';
import { isSafeRelPath } from './library-via-host.js';
import type { ProductHttpContext } from './product-context.js';
import { getEnvironment, getPrimaryHost } from '@zana-ai/zcc-db';
import { projectSources } from '@zana-ai/zcc-domain/project';
import { resolveProjectHost } from './project-host.js';

export interface ProjectFileScope { projectId: string; hostId: string; environmentId?: string }
export function parseProjectFileScope(input: unknown): ProjectFileScope | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProjectFsError(400, 'invalid-scope', 'Invalid project file scope');
  const row = input as Record<string, unknown>;
  if (typeof row.projectId !== 'string' || !row.projectId || row.projectId.length > 256 || typeof row.hostId !== 'string' || !row.hostId || row.hostId.length > 128 || (row.environmentId !== undefined && (typeof row.environmentId !== 'string' || !row.environmentId || row.environmentId.length > 128)) || Object.keys(row).some(key => !['projectId', 'hostId', 'environmentId'].includes(key))) {
    throw new ProjectFsError(400, 'invalid-scope', 'Invalid project file scope');
  }
  return row as unknown as ProjectFileScope;
}

/** Resolve the authority's saved source/environment, never a caller-provided root. */
export function projectFileRoot(ctx: ProductHttpContext, scope: ProjectFileScope): { root: string; hostId: string } {
  const project = ctx.toProjects().find(row => row.id === scope.projectId);
  if (!project) throw new ProjectFsError(404, 'unknown-project', 'project is not registered');
  if (scope.environmentId) {
    const environment = getEnvironment(ctx.db, scope.environmentId);
    if (!environment || environment.projectId !== project.id || environment.hostId !== scope.hostId || !environment.path) {
      throw new ProjectFsError(409, 'environment-unavailable', 'environment does not belong to this project and machine');
    }
    if (environment.status !== 'ready') {
      const message = environment.status === 'provisioning'
        ? 'Environment preparation is still in progress'
        : environment.status === 'failed'
          ? 'Environment preparation failed. Create a new worktree or choose another checkout.'
          : `Environment is unavailable (${environment.status})`;
      throw new ProjectFsError(409, 'environment-unavailable', message);
    }
    return { root: environment.path, hostId: scope.hostId };
  }
  const source = projectSources(project, project.hostId ?? getPrimaryHost(ctx.db)?.id).find(row => row.hostId === scope.hostId);
  if (!source) throw new ProjectFsError(409, 'source-unavailable', 'project has no checkout on the selected machine');
  return { root: source.path, hostId: source.hostId };
}

export function authorizeScopedPath(ctx: ProductHttpContext, path: string, scope?: ProjectFileScope) {
  if (!scope) return authorizeProjectRelPath(ctx.toProjects(), path);
  const { root, hostId } = projectFileRoot(ctx, scope);
  return authorizeProjectRelPath([{ id: scope.projectId, name: '', path: root, hostId, createdAt: 0, lastActiveAt: 0 }], path);
}

export class ProjectFsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function mapHostError(error: unknown): never {
  if (error instanceof HostUnavailableError) {
    throw new ProjectFsError(503, error.code, error.message);
  }
  if (error instanceof AmbiguousHostError) {
    throw new ProjectFsError(409, error.code, error.message);
  }
  throw error;
}

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * Map a renderer-supplied absolute path onto one registered local project.
 * Longest matching root wins. Lexical only — the host still realpath-confines.
 */
export function authorizeProjectRelPath(
  projects: Project[],
  candidate: string
): { root: string; relPath: string; hostId?: string } | null {
  // `isAbsolute` follows this server's OS; a Windows host's paths must still
  // pass when the server runs on POSIX. Local projects re-check below.
  if (typeof candidate !== 'string' || !(isAbsolute(candidate) || WINDOWS_ABSOLUTE_PATH.test(candidate))) return null;
  let best: { root: string; relPath: string; hostId?: string; len: number } | null = null;
  const matchingHosts = new Set<string | undefined>();
  for (const project of projects) {
    if (project.remote || !project.path) continue;
    if (project.hostId) {
      // A Windows checkout's paths arrive with `\` separators and any letter
      // case; only then fold them. On POSIX hosts `\` is a filename character.
      const windowsRoot = WINDOWS_ABSOLUTE_PATH.test(project.path);
      const normalize = (value: string) =>
        (windowsRoot ? value.replace(/\\/g, '/') : value).replace(/\/+$/, '') || '/';
      const fold = (value: string) => (windowsRoot ? value.toLowerCase() : value);
      const root = normalize(project.path);
      const path = normalize(candidate);
      let relPath: string | null = null;
      if (fold(path) === fold(root)) relPath = '';
      else if (fold(path).startsWith(`${fold(root)}/`)) relPath = path.slice(root.length + 1);
      if (relPath === null) continue;
      matchingHosts.add(project.hostId);
      if (!best || root.length > best.len) {
        best = { root: project.path, relPath, hostId: project.hostId, len: root.length };
      }
      continue;
    }
    if (!isAbsolute(candidate)) continue;
    const resolved = resolve(candidate);
    const root = resolve(project.path);
    const rel = relative(root, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    matchingHosts.add(undefined);
    if (!best || root.length > best.len) {
      best = {
        root: project.path,
        relPath: rel.split(sep).join('/'),
        hostId: undefined,
        len: root.length
      };
    }
  }
  if (matchingHosts.size > 1) throw new ProjectFsError(409, 'ambiguous-source', 'Choose the project and machine for this path');
  return best ? { root: best.root, relPath: best.relPath, hostId: best.hostId } : null;
}

export async function listProjectDir(ctx: ProductHttpContext, path: string, scope?: ProjectFileScope): Promise<FsEntry[]> {
  const authorized = authorizeScopedPath(ctx, path, scope);
  if (!authorized) {
    throw new ProjectFsError(403, 'path-escape', 'path is not inside a known project');
  }
  if (authorized.relPath && !isSafeRelPath(authorized.relPath)) {
    throw new ProjectFsError(403, 'path-escape', 'path is not inside a known project');
  }
  let result: HostListDirResult;
  try {
    const hostId = resolveProjectHost(ctx, authorized.hostId);
    result = await ctx.hostHub.callHostOnlineRpc<HostListDirResult>({
      hostId,
      command: {
        type: 'host.list_dir',
        root: authorized.root,
        relPath: authorized.relPath
      }
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'path_not_found') {
      return [];
    }
    mapHostError(error);
  }
  return result.entries;
}

export async function readProjectFile(ctx: ProductHttpContext, path: string, scope?: ProjectFileScope): Promise<FsReadResult> {
  const authorized = authorizeScopedPath(ctx, path, scope);
  if (!authorized || !authorized.relPath) {
    return { ok: false, message: 'Path is not inside a known project' };
  }
  if (!isSafeRelPath(authorized.relPath)) {
    return { ok: false, message: 'Path is not inside a known project' };
  }
  try {
    const hostId = resolveProjectHost(ctx, authorized.hostId);
    const result = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({
      hostId,
      command: {
        type: 'host.read_file',
        root: authorized.root,
        relPath: authorized.relPath
      }
    });
    if (result.encoding === 'base64') {
      return {
        ok: true,
        binary: true,
        bytes: Buffer.byteLength(result.content, 'base64'),
        sha256: createHash('sha256').update(Buffer.from(result.content, 'base64')).digest('hex')
      };
    }
    return { ok: true, content: result.content, bytes: Buffer.byteLength(result.content, 'utf8'), binary: false, sha256: createHash('sha256').update(result.content).digest('hex') };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'path_not_found') {
      return { ok: false, message: 'file not found' };
    }
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'too_large') {
      return { ok: false, message: 'file exceeds the read cap' };
    }
    mapHostError(error);
  }
}

export async function readProjectImage(ctx: ProductHttpContext, path: string, scope?: ProjectFileScope) {
  const source = authorizeScopedPath(ctx, path, scope);
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif' } as Record<string, string>)[extname(path).toLowerCase()];
  if (!mime || !source?.relPath || !isSafeRelPath(source.relPath)) throw new ProjectFsError(403, 'invalid-image', 'Choose an image inside this checkout');
  const file = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({ hostId: resolveProjectHost(ctx, source.hostId), command: { type: 'host.read_file', root: source.root, relPath: source.relPath } });
  const base64 = file.encoding === 'base64' ? file.content : Buffer.from(file.content, 'utf8').toString('base64');
  if (Buffer.byteLength(base64, 'base64') > 10 * 1024 * 1024) throw new ProjectFsError(413, 'image-too-large', 'Image exceeds the preview limit');
  return { ok: true, dataUrl: `data:${mime};base64,${base64}` };
}

const PATH_SEARCH_DENY = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.DS_Store'
]);

const PATH_SEARCH_DEFAULT_LIMIT = 80;
const PATH_SEARCH_MAX_LIMIT = 200;

export function isDeniedProjectRelPath(relPath: string): boolean {
  return relPath.split('/').some((part) => PATH_SEARCH_DENY.has(part));
}

export interface ProjectPathEntry {
  kind: 'file' | 'directory';
  path: string;
  name: string;
  score: number;
  positions: number[];
}

export async function listProjectPaths(
  ctx: ProductHttpContext,
  projectId: string,
  opts: {
    query?: string;
    limit?: number;
    includeFiles?: boolean;
    includeDirectories?: boolean;
    hostId?: string;
  } = {}
): Promise<{ paths: ProjectPathEntry[]; truncated: boolean }> {
  const project = ctx.toProjects().find((row) => row.id === projectId);
  if (!project) {
    throw new ProjectFsError(404, 'unknown-project', 'project is not registered');
  }
  if (!project.path) {
    throw new ProjectFsError(400, 'path-unavailable', 'project has no local path');
  }
  const source = opts.hostId ? projectFileRoot(ctx, { projectId, hostId: opts.hostId }) : { root: project.path, hostId: project.hostId };

  let result: HostListPathsResult;
  try {
    const hostId = resolveProjectHost(ctx, source.hostId);
    const query = (opts.query ?? '').trim();
    const includeFiles = opts.includeFiles !== false;
    const includeDirectories = opts.includeDirectories !== false;
    if (!includeFiles && !includeDirectories) {
      return { paths: [], truncated: false };
    }
    const requested = Number.isFinite(opts.limit) ? Number(opts.limit) : PATH_SEARCH_DEFAULT_LIMIT;
    const limit = Math.min(PATH_SEARCH_MAX_LIMIT, Math.max(1, requested));
    result = await ctx.hostHub.callHostOnlineRpc<HostListPathsResult>({
      hostId,
      command: {
        type: 'host.list_paths',
        path: source.root,
        limit,
        includeFiles,
        includeDirectories,
        ...(query ? { query } : {})
      }
    });
  } catch (error) {
    mapHostError(error);
  }

  const mapped: ProjectPathEntry[] = [];
  for (const entry of result.paths) {
    if (!entry.path || isDeniedProjectRelPath(entry.path)) continue;
    mapped.push({
      kind: entry.kind,
      path: entry.path,
      name: entry.name,
      score: entry.score,
      positions: entry.positions
    });
  }
  return {
    paths: mapped,
    truncated: result.truncated
  };
}
