import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { HostListDirResult, HostListFilesResult, HostReadFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { FsEntry, FsReadResult, Project } from '@zana-ai/zcc-domain/product';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';
import { isSafeRelPath } from './library-via-host.js';
import type { ProductHttpContext } from './product-context.js';

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

/**
 * Map a renderer-supplied absolute path onto one registered local project.
 * Longest matching root wins. Lexical only — the host still realpath-confines.
 */
export function authorizeProjectRelPath(
  projects: Project[],
  candidate: string
): { root: string; relPath: string } | null {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return null;
  const resolved = resolve(candidate);
  let best: { root: string; relPath: string; len: number } | null = null;
  for (const project of projects) {
    if (project.remote || !project.path) continue;
    const root = resolve(project.path);
    const rel = relative(root, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    if (!best || root.length > best.len) {
      best = {
        root: project.path,
        relPath: rel.split(sep).join('/'),
        len: root.length
      };
    }
  }
  return best ? { root: best.root, relPath: best.relPath } : null;
}

export async function listProjectDir(ctx: ProductHttpContext, path: string): Promise<FsEntry[]> {
  const authorized = authorizeProjectRelPath(ctx.toProjects(), path);
  if (!authorized) {
    throw new ProjectFsError(403, 'path-escape', 'path is not inside a known project');
  }
  if (authorized.relPath && !isSafeRelPath(authorized.relPath)) {
    throw new ProjectFsError(403, 'path-escape', 'path is not inside a known project');
  }
  let result: HostListDirResult;
  try {
    const hostId = ctx.hostHub.resolveHostId();
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

export async function readProjectFile(ctx: ProductHttpContext, path: string): Promise<FsReadResult> {
  const authorized = authorizeProjectRelPath(ctx.toProjects(), path);
  if (!authorized || !authorized.relPath) {
    return { ok: false, message: 'Path is not inside a known project' };
  }
  if (!isSafeRelPath(authorized.relPath)) {
    return { ok: false, message: 'Path is not inside a known project' };
  }
  try {
    const hostId = ctx.hostHub.resolveHostId();
    const result = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({
      hostId,
      command: {
        type: 'host.read_file',
        root: authorized.root,
        relPath: authorized.relPath
      }
    });
    return { ok: true, content: result.content, bytes: Buffer.byteLength(result.content, 'utf8'), binary: false };
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
  } = {}
): Promise<{ paths: ProjectPathEntry[]; truncated: boolean }> {
  const project = ctx.toProjects().find((row) => row.id === projectId);
  if (!project) {
    throw new ProjectFsError(404, 'unknown-project', 'project is not registered');
  }
  if (!project.path) {
    throw new ProjectFsError(400, 'path-unavailable', 'project has no local path');
  }

  let result: HostListFilesResult;
  try {
    const hostId = ctx.hostHub.resolveHostId();
    result = await ctx.hostHub.callHostOnlineRpc<HostListFilesResult>({
      hostId,
      command: { type: 'host.list_files', roots: [project.path] }
    });
  } catch (error) {
    mapHostError(error);
  }

  const query = (opts.query ?? '').trim().toLowerCase();
  const includeFiles = opts.includeFiles !== false;
  const includeDirectories = opts.includeDirectories !== false;
  const requested = Number.isFinite(opts.limit) ? Number(opts.limit) : PATH_SEARCH_DEFAULT_LIMIT;
  const limit = Math.min(PATH_SEARCH_MAX_LIMIT, Math.max(1, requested));
  const mapped: ProjectPathEntry[] = [];
  for (const file of result.files) {
    if (!file.relPath || isDeniedProjectRelPath(file.relPath)) continue;
    const kind = file.kind === 'dir' ? 'directory' : 'file';
    if (kind === 'file' && !includeFiles) continue;
    if (kind === 'directory' && !includeDirectories) continue;
    const name = basename(file.relPath);
    if (query && !file.relPath.toLowerCase().includes(query) && !name.toLowerCase().includes(query)) {
      continue;
    }
    mapped.push({
      kind,
      path: file.relPath,
      name,
      score: 0,
      positions: []
    });
  }
  return {
    paths: mapped.slice(0, limit),
    truncated: mapped.length > limit
  };
}
