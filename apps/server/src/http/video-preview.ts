import { isAbsolute } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FILE_RANGE_MAX_BYTES, videoContentType } from '@zana-ai/zcc-domain';
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import { readConfinedFileRange } from '@zana-ai/zcc-host-daemon/read-file-range';
import type { HostReadFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from './product-context.js';
import { authorizeProjectRelPath, ProjectFsError } from './project-fs-via-host.js';
import { isSafeRelPath } from './library-via-host.js';
import { confinePathToRoot } from '../services/threads/thread-path-confine.js';
import { threadStorageRoot } from '../services/threads/thread-storage.js';
import { projectAttachmentDir } from '../services/projects/attachments.js';

type RangeReader = (offset: number, length: number) => Promise<HostReadFileResult>;

function confined(root: string, candidate: string): string {
  const rel = confinePathToRoot(root, candidate);
  if (!rel || !isSafeRelPath(rel)) throw new ProjectFsError(403, 'path-escape', 'path is outside the preview scope');
  return rel;
}

function videoReader(ctx: ProductHttpContext, params: URLSearchParams): RangeReader {
  const candidate = params.get('path') ?? '';
  const threadId = params.get('threadId');
  const source = params.get('source') ?? 'workspace';
  if (source !== 'workspace' && source !== 'thread-storage') {
    throw new ProjectFsError(400, 'invalid-source', 'invalid preview source');
  }
  const hostReader = (hostId: string, root: string, relPath: string): RangeReader => (offset, length) =>
    ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({
      hostId, command: { type: 'host.read_file', root, relPath, byteRange: { offset, length } }
    });
  const localReader = (root: string): RangeReader => {
    const rel = confined(root, candidate);
    return (offset, length) => readConfinedFileRange(root, rel, offset, length);
  };
  if (threadId) {
    if (!/^[A-Za-z0-9._-]+$/.test(threadId) || threadId === '.' || threadId === '..') {
      throw new ProjectFsError(400, 'invalid-thread-id', 'invalid thread id');
    }
    const thread = getConversationThread(ctx.db, threadId);
    if (!thread) {
      // CLI-agent panels use a session id. As with preview_file, main resolves
      // their registered project rather than treating that id as a conversation.
      const project = ctx.toProjects().find((row) => row.id === params.get('projectId'));
      if (source !== 'workspace' || !project?.path || project.remote) {
        throw new ProjectFsError(404, 'unknown-thread', 'thread is not registered');
      }
      return hostReader(ctx.hostHub.resolveHostId(project.hostId), project.path, confined(project.path, candidate));
    }
    if (source === 'thread-storage') return localReader(threadStorageRoot(ctx.dataDir, threadId));
    if (thread.projectId && isAbsolute(candidate)) {
      const root = projectAttachmentDir(ctx.dataDir, thread.projectId);
      if (confinePathToRoot(root, candidate)) return localReader(root);
    }
    const env = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
    if (!env?.path) throw new ProjectFsError(409, 'environment_not_ready', 'environment is not provisioned');
    return hostReader(thread.hostId, env.path, confined(env.path, candidate));
  }
  if (source === 'thread-storage') throw new ProjectFsError(400, 'missing-thread', 'thread storage requires a thread');
  const project = authorizeProjectRelPath(ctx.toProjects(), candidate);
  if (!project || !project.relPath || !isSafeRelPath(project.relPath)) {
    throw new ProjectFsError(403, 'path-escape', 'path is not inside a known project');
  }
  return hostReader(ctx.hostHub.resolveHostId(project.hostId), project.root, project.relPath);
}

/** Single HTTP byte ranges, including suffixes. Multipart ranges are rejected. */
export function videoByteRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

/** Origin-guarded by product HTTP. Streams at most one bounded host read ahead. */
export async function sendVideoPreview(
  request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, params: URLSearchParams
): Promise<void> {
  const contentType = videoContentType(params.get('path') ?? '');
  if (!contentType) throw new ProjectFsError(415, 'unsupported-video', 'unsupported video file type');
  // Media requests can omit Origin. Never allow a foreign page to embed local files.
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ProjectFsError(403, 'foreign-origin', 'video must be opened from the app');
  }
  const read = videoReader(ctx, params);
  let info: HostReadFileResult;
  try {
    info = await read(0, 0);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error
      && ['path_not_found', 'ENOENT', 'EISDIR', 'ENOTDIR'].includes(String(error.code))) {
      throw new ProjectFsError(404, 'path_not_found', 'video file not found');
    }
    throw error;
  }
  const size = info.totalBytes;
  if (size === undefined || !Number.isSafeInteger(size) || size < 0 || info.encoding !== 'base64') {
    throw new ProjectFsError(502, 'invalid-video-response', 'host does not support video streaming');
  }
  const range = videoByteRange(request.headers.range, size);
  const headers = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin'
  };
  if (!range) {
    response.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': '0' }).end();
    return;
  }
  const partial = Boolean(request.headers.range);
  response.writeHead(partial ? 206 : 200, {
    ...headers, 'content-length': String(range.end - range.start + 1),
    ...(partial ? { 'content-range': `bytes ${range.start}-${range.end}/${size}` } : {})
  });
  if (request.method === 'HEAD') { response.end(); return; }
  async function* chunks() {
    for (let offset = range!.start; offset <= range!.end && !response.destroyed;) {
      const length = Math.min(FILE_RANGE_MAX_BYTES, range!.end - offset + 1);
      const result = await read(offset, length);
      const bytes = Buffer.from(result.content, 'base64');
      if (result.encoding !== 'base64' || result.totalBytes !== size || bytes.length !== length) {
        throw new Error('video changed while reading');
      }
      offset += bytes.length;
      yield bytes;
    }
  }
  try {
    await pipeline(Readable.from(chunks()), response);
  } catch {
    // Includes seek/navigation cancellation. The pipeline releases its iterator.
    response.destroy();
  }
}
