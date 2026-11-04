import { win32 } from 'node:path';
import { stat } from 'node:fs/promises';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import type { HostFileMetadataResult, HostListPathsResult } from '@zana-ai/zcc-contracts/host-rpc';
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import type { PreviewPathRequest, PreviewPathResult } from '@zana-ai/zcc-server-contract';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ProjectFsError } from '../../http/project-fs-via-host.js';
import { isSafeRelPath } from '../../http/library-via-host.js';
import { confinePathToRoot, threadPathApi } from './thread-path-confine.js';
import { threadLocalPreviewRoots } from './thread-preview-roots.js';

const LOOKUP_LIMIT = 50;
const LOOKUP_TIMEOUT_MS = 5000;

export type PreviewPathCandidateResult =
  | { kind: 'resolved'; path: string }
  | { kind: 'ambiguous' | 'incomplete'; paths: string[] }
  | { kind: 'not_found' };

export function isBarePreviewPath(path: string): boolean {
  return !/[\\/]/u.test(path) && !/^[a-z]:/iu.test(path);
}

function createCandidateCollector(caseInsensitive: boolean) {
  const candidates = new Set<string>();
  const add = (path: string, preferNew = false) => {
    if (caseInsensitive) {
      for (const existing of candidates) {
        if (existing.toLowerCase() === path.toLowerCase()) {
          if (preferNew) {
            candidates.delete(existing);
            candidates.add(path);
          }
          return;
        }
      }
    }
    candidates.add(path);
  };
  return { candidates, add };
}

export async function resolvePreviewPathCandidate(
  requested: string,
  hints: readonly string[],
  exists: (path: string) => Promise<boolean>,
  search: () => Promise<{ paths: string[]; truncated: boolean }>,
  explicitPath = !isBarePreviewPath(requested),
  caseInsensitive = false
): Promise<PreviewPathCandidateResult> {
  if (explicitPath) {
    return (await exists(requested)) ? { kind: 'resolved', path: requested } : { kind: 'not_found' };
  }

  const matches = [...new Set(hints.filter((path) => {
    const base = path.split(/[/\\\\]/u).at(-1);
    return caseInsensitive ? base?.toLowerCase() === requested.toLowerCase() : base === requested;
  }))];
  const { candidates, add } = createCandidateCollector(caseInsensitive);
  for (const path of matches) {
    if (await exists(path)) add(path);
    if (candidates.size >= LOOKUP_LIMIT) break;
  }
  if (candidates.size > 1) return { kind: 'ambiguous', paths: [...candidates] };

  if (await exists(requested)) {
    add(requested);
    if (candidates.size > 1) return { kind: 'ambiguous', paths: [...candidates] };
    return { kind: 'resolved', path: requested };
  }

  const result = await search();
  for (const path of result.paths) {
    add(path, true);
    if (candidates.size >= LOOKUP_LIMIT) break;
  }

  const paths = [...candidates];
  if (result.truncated) return { kind: 'incomplete', paths };
  if (paths.length > 1) return { kind: 'ambiguous', paths };
  if (paths.length === 1) return { kind: 'resolved', path: paths[0]! };
  return { kind: 'not_found' };
}
const activeByHost = new Map<string, number>();

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code: unknown }).code;
  return code === 'path_not_found' || code === 'invalid_path' || code === 'ENOTDIR' || code === 'ENOENT';
}

async function searchExactHostName(
  ctx: ProductHttpContext,
  hostId: string,
  root: string,
  requested: string,
  deadline: number,
  confine: (candidate: string) => string | null
): Promise<{ paths: string[]; truncated: boolean }> {
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0) return { paths: [], truncated: true };
  const active = activeByHost.get(hostId) ?? 0;
  if (active >= 2) throw new ProjectFsError(429, 'preview-busy', 'File lookup is busy. Try again.');
  activeByHost.set(hostId, active + 1);
  try {
    const result = await ctx.hostHub.callHostOnlineRpc<HostListPathsResult>({
      hostId,
      timeoutMs,
      command: {
        type: 'host.list_paths',
        path: root,
        exactName: requested,
        timeoutMs: Math.max(1, timeoutMs - 500),
        limit: LOOKUP_LIMIT,
        includeFiles: true,
        includeDirectories: false
      }
    });
    const found = result.paths
      .filter((entry) => entry.kind === 'file')
      .map((entry) => confine(entry.path))
      .filter((path): path is string => Boolean(path));
    return { paths: [...new Set(found)], truncated: result.truncated || Date.now() >= deadline };
  } finally {
    const remaining = (activeByHost.get(hostId) ?? 1) - 1;
    if (remaining > 0) activeByHost.set(hostId, remaining);
    else activeByHost.delete(hostId);
  }
}

function createHostLookup(
  ctx: ProductHttpContext,
  hostId: string,
  root: string,
  requested: string,
  deadline: number
): {
  paths: ReturnType<typeof threadPathApi>;
  confine(candidate: string): string | null;
  exists(relPath: string): Promise<boolean>;
  search(): Promise<{ paths: string[]; truncated: boolean }>;
} {
  const paths = threadPathApi(root);
  const confine = (candidate: string): string | null => {
    const rel = confinePathToRoot(root, candidate);
    return rel && isSafeRelPath(rel) ? rel : null;
  };
  const exists = async (relPath: string): Promise<boolean> => {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw new ProjectFsError(504, 'preview-timeout', 'File lookup timed out. Try again.');
    try {
      await ctx.hostHub.callHostOnlineRpc<HostFileMetadataResult>({
        hostId,
        timeoutMs,
        command: {
          type: 'host.file_metadata',
          path: paths.resolve(root, relPath),
          rootPath: root
        }
      });
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  };
  const search = () => searchExactHostName(ctx, hostId, root, requested, deadline, confine);
  return { paths, confine, exists, search };
}

async function resolveLocalPreviewPath(
  ctx: ProductHttpContext,
  projectId: string | null,
  requested: string
): Promise<string | null> {
  const dataPaths = threadPathApi(ctx.dataDir);
  if (!dataPaths.isAbsolute(requested)) return null;
  for (const root of threadLocalPreviewRoots(ctx.dataDir, projectId)) {
    const relPath = confinePathToRoot(root, requested);
    if (!relPath || !isSafeRelPath(relPath)) continue;
    const realPath = await resolveContainedReal(root, relPath);
    if (!realPath) throw new ProjectFsError(404, 'path_not_found', 'file not found');
    try {
      const s = await stat(realPath);
      if (!s.isFile()) throw new ProjectFsError(404, 'path_not_found', 'file not found');
    } catch (error) {
      if (error instanceof ProjectFsError) throw error;
      throw new ProjectFsError(404, 'path_not_found', 'file not found');
    }
    return requested;
  }
  return null;
}

/** Resolve a Markdown file token against the thread's authoritative checkout. */
export async function resolveThreadPreviewPath(
  ctx: ProductHttpContext,
  threadId: string,
  input: PreviewPathRequest
): Promise<PreviewPathResult> {
  const thread = getConversationThread(ctx.db, threadId);
  const project = !thread && input.projectId
    ? ctx.toProjects().find((row) => row.id === input.projectId)
    : null;
  if (!thread && (!project?.path || project.remote)) {
    throw new ProjectFsError(404, 'unknown-thread', 'thread is not registered');
  }
  if (thread && input.projectId && input.projectId !== thread.projectId) {
    throw new ProjectFsError(403, 'scope-mismatch', 'preview scope does not match the thread');
  }
  const root = thread
    ? (thread.environmentId ? getEnvironment(ctx.db, thread.environmentId)?.path : null)
    : project?.path;
  const requested = input.path;
  const localPath = await resolveLocalPreviewPath(ctx, thread?.projectId ?? project?.id ?? null, requested);
  if (localPath) return { kind: 'resolved', path: localPath };
  if (!root) throw new ProjectFsError(409, 'environment_not_ready', 'environment is not provisioned');
  const hostId = thread ? thread.hostId : ctx.hostHub.resolveHostId(project?.hostId);
  const isBare = isBarePreviewPath(requested);
  const access = createHostLookup(ctx, hostId, root, requested, Date.now() + LOOKUP_TIMEOUT_MS);
  const isCaseInsensitive = threadPathApi(root) === win32;
  const hintMatches = (candidatePath: string) => {
    const base = access.paths.basename(candidatePath);
    return isCaseInsensitive
      ? base.toLowerCase() === requested.toLowerCase()
      : base === requested;
  };
  const hintPaths = isBare
    ? [...new Set((input.hints ?? []).map(access.confine).filter((path): path is string =>
      Boolean(path && hintMatches(path))))].slice(0, LOOKUP_LIMIT)
    : [];
  const requestedRel = access.confine(requested);
  if (!requestedRel) throw new ProjectFsError(403, 'path-escape', 'path is not inside the thread workspace');

  const result = await resolvePreviewPathCandidate(
    requestedRel,
    hintPaths,
    access.exists,
    access.search,
    !isBare,
    isCaseInsensitive
  );
  return result.kind === 'not_found'
    ? {
        kind: 'not_found',
        path: requestedRel,
        ...(!isBare ? { checkedPath: access.paths.resolve(root, requestedRel) } : {})
      }
    : result;
}
