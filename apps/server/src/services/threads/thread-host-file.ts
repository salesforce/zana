import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import type { HostReadFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { ProjectFsError } from '../../http/project-fs-via-host.js';
import { isSafeRelPath } from '../../http/library-via-host.js';
import { confinePathToRoot } from './thread-path-confine.js';
import { projectAttachmentDir } from '../projects/attachments.js';

const IMAGE_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
export const IMAGE_READ_MAX_BYTES = 10 * 1024 * 1024;

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
  candidate: string,
  projectId?: string
): Promise<{ path: string; relPath: string; content: string; encoding: 'utf8' | 'base64'; contentType: string | null }> {
  const thread = getConversationThread(ctx.db, threadId);
  // CLI preview tabs are owned by a PTY session, not a conversation row.
  // Resolve their scope from the registered project, as preview_file does.
  const project = !thread && projectId
    ? ctx.toProjects().find((row) => row.id === projectId)
    : null;
  if (!thread && (!project?.path || !isAbsolute(project.path) || project.remote)) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  // Uploaded images live on the server, outside the host checkout. Resolve only
  // this thread's project attachment root, derived from the authoritative row.
  // Relative paths keep their existing meaning: files in the environment.
  if (thread?.projectId && isAbsolute(candidate)) {
    const root = projectAttachmentDir(ctx.dataDir, thread.projectId);
    const attachmentPath = confinePathToRoot(root, candidate);
    if (attachmentPath && isSafeRelPath(attachmentPath)) {
      const real = await resolveContainedReal(root, attachmentPath);
      if (!real) throw new ProjectFsError(404, 'path_not_found', 'attachment not found');
      const file = await open(real, 'r');
      try {
        const info = await file.stat();
        if (!info.isFile()) throw new ProjectFsError(404, 'path_not_found', 'attachment not found');
        const contentType = imageContentType(attachmentPath);
        const cap = contentType ? IMAGE_READ_MAX_BYTES : 2_000_000;
        if (info.size > cap) throw new ProjectFsError(413, 'too_large', 'file exceeds the read cap');
        // Bound the read too, in case the file grows after stat().
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of file.createReadStream({ end: cap, autoClose: false })) {
          size += chunk.length;
          if (size > cap) throw new ProjectFsError(413, 'too_large', 'file exceeds the read cap');
          chunks.push(chunk);
        }
        return {
          path: candidate,
          relPath: attachmentPath,
          content: Buffer.concat(chunks).toString(contentType ? 'base64' : 'utf8'),
          encoding: contentType ? 'base64' : 'utf8',
          contentType
        };
      } finally {
        await file.close();
      }
    }
  }
  const environment = thread?.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  const root = thread ? environment?.path : project?.path;
  if (!root) {
    throw new ThreadCreateError(409, 'environment_not_ready', 'environment is not provisioned');
  }
  const relPath = confinePathToRoot(root, candidate);
  if (!relPath || !isSafeRelPath(relPath)) {
    throw new ProjectFsError(403, 'path-escape', 'path is not inside the thread environment');
  }
  try {
    const result = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({
      hostId: thread ? thread.hostId : ctx.hostHub.resolveHostId(project?.hostId),
      command: {
        type: 'host.read_file',
        root,
        relPath
      }
    });
    return {
      path: candidate,
      relPath,
      content: result.content,
      encoding: result.encoding,
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
