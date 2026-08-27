import { join } from 'node:path';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { getConversationThread } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { ProjectFsError } from '../../http/project-fs-via-host.js';
import { isSafeRelPath } from '../../http/library-via-host.js';
import { confinePathToRoot } from './thread-path-confine.js';
import { imageContentType } from './thread-host-file.js';

const STORAGE_WALK_CAP = 500;
const STORAGE_FILE_BYTE_CAP = 2_000_000;
const THREAD_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function threadStorageRoot(dataDir: string, threadId: string): string {
  return join(dataDir, 'thread-storage', threadId);
}

function assertThreadId(threadId: string): void {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new ThreadCreateError(400, 'invalid-thread-id', 'thread id is not valid');
  }
}

export async function listThreadStorageFiles(
  ctx: ProductHttpContext,
  threadId: string
): Promise<{ files: Array<{ path: string; name: string }>; truncated: boolean; storageRootPath: string }> {
  assertThreadId(threadId);
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const root = threadStorageRoot(ctx.dataDir, threadId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const files: Array<{ path: string; name: string }> = [];
  const truncated = await walkStorageFiles(root, '', files, STORAGE_WALK_CAP);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated, storageRootPath: root };
}

async function walkStorageFiles(
  dir: string,
  prefix: string,
  files: Array<{ path: string; name: string }>,
  cap: number
): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!isSafeRelPath(rel)) continue;
    if (entry.isDirectory()) {
      const truncated = await walkStorageFiles(join(dir, entry.name), rel, files, cap);
      if (truncated) return true;
    } else if (entry.isFile()) {
      files.push({ path: rel, name: entry.name });
      if (files.length >= cap) return true;
    }
  }
  return false;
}

export async function readThreadStorageFile(
  ctx: ProductHttpContext,
  threadId: string,
  candidate: string
): Promise<{ path: string; relPath: string; content: string; encoding: 'utf8'; contentType: string | null }> {
  assertThreadId(threadId);
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const root = threadStorageRoot(ctx.dataDir, threadId);
  const relPath = confinePathToRoot(root, candidate);
  if (!relPath || !isSafeRelPath(relPath)) {
    throw new ProjectFsError(403, 'path-escape', 'path is not inside thread storage');
  }
  const abs = join(root, relPath);
  try {
    const info = await stat(abs);
    if (!info.isFile()) {
      throw new ProjectFsError(404, 'path_not_found', 'file not found');
    }
    if (info.size > STORAGE_FILE_BYTE_CAP) {
      throw new ProjectFsError(413, 'too_large', 'file exceeds the read cap');
    }
    const content = await readFile(abs, 'utf8');
    return {
      path: candidate,
      relPath,
      content,
      encoding: 'utf8',
      contentType: imageContentType(relPath)
    };
  } catch (error) {
    if (error instanceof ProjectFsError) throw error;
    throw new ProjectFsError(404, 'path_not_found', 'file not found');
  }
}
