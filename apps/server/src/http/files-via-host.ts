import type {
  HostMkdirRequest,
  HostMovePathRequest,
  HostRemovePathRequest,
  HostFileWriteRequest,
  HostFileReadRequest,
  HostFileListRequest,
  HostPathListRequest,
  HostFileListResponse,
  HostPathListResponse
} from '@zana-ai/zcc-server-contract';
import { FILE_LIST_LIMIT_MAX } from '@zana-ai/zcc-domain/thread-runtime';
import type {
  HostListPathsResult,
  HostPathMutationResult,
  HostReadPathResult,
  HostWriteFileResult
} from '@zana-ai/zcc-contracts/host-rpc';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';
import type { ProductHttpContext } from './product-context.js';

export class HostFilesError extends Error {
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
    throw new HostFilesError(503, error.code, error.message);
  }
  if (error instanceof AmbiguousHostError) {
    throw new HostFilesError(409, error.code, error.message);
  }
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    const code = (error as { code: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'invalid_path' || code === 'path_escape') {
      throw new HostFilesError(400, code, message);
    }
    if (code === 'path_not_found') {
      throw new HostFilesError(404, code, message);
    }
    throw new HostFilesError(500, code, message);
  }
  throw error;
}

function resolveFileHostId(ctx: ProductHttpContext, hostId: string | undefined): string {
  try {
    return ctx.hostHub.resolveHostId(hostId);
  } catch (error) {
    mapHostError(error);
  }
}

export async function writeHostFile(
  ctx: ProductHttpContext,
  input: HostFileWriteRequest
): Promise<HostWriteFileResult> {
  const hostId = resolveFileHostId(ctx, input.hostId);
  try {
    return await ctx.hostHub.callHostOnlineRpc<HostWriteFileResult>({
      hostId,
      command: {
        type: 'host.write_file',
        path: input.path,
        content: input.content,
        contentEncoding: input.contentEncoding ?? 'utf8',
        createParents: input.createParents ?? false,
        ...(input.rootPath !== undefined ? { rootPath: input.rootPath } : {}),
        ...(input.expectedSha256 !== undefined ? { expectedSha256: input.expectedSha256 } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {})
      }
    });
  } catch (error) {
    mapHostError(error);
  }
}

export async function mkdirHostPath(
  ctx: ProductHttpContext,
  input: HostMkdirRequest
): Promise<HostPathMutationResult> {
  const hostId = resolveFileHostId(ctx, input.hostId);
  try {
    return await ctx.hostHub.callHostOnlineRpc<HostPathMutationResult>({
      hostId,
      command: {
        type: 'host.mkdir',
        path: input.path,
        recursive: input.recursive ?? false,
        ...(input.rootPath !== undefined ? { rootPath: input.rootPath } : {})
      }
    });
  } catch (error) {
    mapHostError(error);
  }
}

export async function moveHostPath(
  ctx: ProductHttpContext,
  input: HostMovePathRequest
): Promise<HostPathMutationResult> {
  const hostId = resolveFileHostId(ctx, input.hostId);
  try {
    return await ctx.hostHub.callHostOnlineRpc<HostPathMutationResult>({
      hostId,
      command: {
        type: 'host.move_path',
        sourcePath: input.sourcePath,
        destinationPath: input.destinationPath,
        ...(input.rootPath !== undefined ? { rootPath: input.rootPath } : {})
      }
    });
  } catch (error) {
    mapHostError(error);
  }
}

export async function removeHostPath(
  ctx: ProductHttpContext,
  input: HostRemovePathRequest
): Promise<HostPathMutationResult> {
  const hostId = resolveFileHostId(ctx, input.hostId);
  try {
    return await ctx.hostHub.callHostOnlineRpc<HostPathMutationResult>({
      hostId,
      command: {
        type: 'host.remove_path',
        path: input.path,
        recursive: input.recursive ?? false,
        ...(input.rootPath !== undefined ? { rootPath: input.rootPath } : {})
      }
    });
  } catch (error) {
    mapHostError(error);
  }
}

export const FILE_LIST_DEFAULT_LIMIT = 80;

function resolveListLimit(limit: number | undefined): number {
  const requested = Number.isFinite(limit) ? Number(limit) : FILE_LIST_DEFAULT_LIMIT;
  return Math.min(FILE_LIST_LIMIT_MAX, Math.max(1, requested));
}

export async function readHostFile(
  ctx: ProductHttpContext,
  input: HostFileReadRequest
): Promise<HostReadPathResult> {
  const hostId = resolveFileHostId(ctx, input.hostId);
  try {
    return await ctx.hostHub.callHostOnlineRpc<HostReadPathResult>({
      hostId,
      command: {
        type: 'host.read_path',
        path: input.path,
        ...(input.rootPath !== undefined ? { rootPath: input.rootPath } : {})
      }
    });
  } catch (error) {
    mapHostError(error);
  }
}

export async function listHostFiles(
  ctx: ProductHttpContext,
  input: HostFileListRequest
): Promise<HostFileListResponse> {
  const listed = await listHostPaths(ctx, {
    hostId: input.hostId,
    path: input.path,
    query: input.query,
    limit: input.limit,
    includeFiles: true,
    includeDirectories: false
  });
  return {
    files: listed.paths.map((entry) => ({ path: entry.path, name: entry.name })),
    truncated: listed.truncated
  };
}

export async function listHostPaths(
  ctx: ProductHttpContext,
  input: HostPathListRequest
): Promise<HostPathListResponse> {
  if (!input.includeFiles && !input.includeDirectories) {
    throw new HostFilesError(400, 'invalid-input', 'At least one path kind must be included');
  }
  const hostId = resolveFileHostId(ctx, input.hostId);
  try {
    return await ctx.hostHub.callHostOnlineRpc<HostListPathsResult>({
      hostId,
      command: {
        type: 'host.list_paths',
        path: input.path,
        limit: resolveListLimit(input.limit),
        includeFiles: input.includeFiles,
        includeDirectories: input.includeDirectories,
        ...(input.query !== undefined ? { query: input.query } : {})
      }
    });
  } catch (error) {
    mapHostError(error);
  }
}
