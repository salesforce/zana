import type { HostReadFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { ProjectFsError } from '../../http/project-fs-via-host.js';
import { isSafeRelPath } from '../../http/library-via-host.js';
import { confinePathToRoot } from './thread-path-confine.js';

const IMAGE_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp']);

export function imageContentType(path: string): string | null {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = lower.slice(dot);
  if (!IMAGE_EXT.has(ext)) return null;
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  return 'image/webp';
}

export async function readThreadHostFile(
  ctx: ProductHttpContext,
  threadId: string,
  candidate: string
): Promise<{ path: string; relPath: string; content: string; encoding: 'utf8'; contentType: string | null }> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  if (!environment?.path) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not provisioned');
  }
  const relPath = confinePathToRoot(environment.path, candidate);
  if (!relPath || !isSafeRelPath(relPath)) {
    throw new ProjectFsError(403, 'path-escape', 'path is not inside the thread environment');
  }
  try {
    const result = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({
      hostId: thread.hostId,
      command: {
        type: 'host.read_file',
        root: environment.path,
        relPath
      }
    });
    return {
      path: candidate,
      relPath,
      content: result.content,
      encoding: 'utf8',
      contentType: imageContentType(relPath)
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'path_not_found') {
      throw new ProjectFsError(404, 'path_not_found', 'file not found');
    }
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'too_large') {
      throw new ProjectFsError(413, 'too_large', 'file exceeds the read cap');
    }
    throw error;
  }
}
