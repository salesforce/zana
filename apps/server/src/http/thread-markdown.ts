import type { HostReadFileResult, HostWriteFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import { createHash } from 'node:crypto';
import type { FsReadResult, FsWriteResult } from '@zana-ai/zcc-domain/product';
import { threadMarkdownQuerySchema, threadMarkdownWriteSchema } from '@zana-ai/zcc-server-contract';
import { confinePathToRoot, threadPathApi } from '../services/threads/thread-path-confine.js';
import type { ProductHttpContext } from './product-context.js';
import { projectFileRoot, ProjectFsError } from './project-fs-via-host.js';
import { resolveProjectHost } from './project-host.js';

/** Resolve reads and writes identically. Preview-only attachment roots confer no write authority. */
function target(ctx: ProductHttpContext, threadId: string, candidate: string, projectId?: string) {
  const thread = getConversationThread(ctx.db, threadId);
  const project = ctx.toProjects().find(row => row.id === (thread?.projectId ?? projectId));
  if (!project || project.remote) throw new ProjectFsError(403, 'read-only', 'This preview has no writable checkout.');
  const environment = thread?.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  if (thread && (!environment || environment.hostId !== thread.hostId || environment.projectId !== thread.projectId)) throw new ProjectFsError(409, 'environment-unavailable', 'The thread checkout is unavailable.');
  const hostId = thread?.hostId ?? resolveProjectHost(ctx, project.hostId);
  const { root } = projectFileRoot(ctx, { projectId: project.id, hostId, ...(environment ? { environmentId: environment.id } : {}) });
  const relPath = confinePathToRoot(root, candidate);
  if (!relPath || !/\.(md|markdown)$/i.test(relPath)) throw new ProjectFsError(403, 'read-only', 'Only Markdown files inside this checkout can be edited.');
  return { root, relPath, hostId, path: threadPathApi(root).resolve(root, relPath) };
}

export async function readThreadMarkdown(ctx: ProductHttpContext, threadId: string, input: unknown): Promise<FsReadResult> {
  const parsed = threadMarkdownQuerySchema.safeParse(input);
  if (!parsed.success) throw new ProjectFsError(400, 'invalid-request', 'Invalid Markdown path');
  const source = target(ctx, threadId, parsed.data.path, parsed.data.projectId);
  const file = await ctx.hostHub.callHostOnlineRpc<HostReadFileResult>({ hostId: source.hostId, command: { type: 'host.read_file', root: source.root, relPath: source.relPath } });
  if (file.encoding !== 'utf8' || Buffer.byteLength(file.content) > 2_000_000) throw new ProjectFsError(413, 'read-only', 'This file is binary or too large to edit.');
  return { ok: true, content: file.content, sha256: createHash('sha256').update(file.content).digest('hex'), bytes: Buffer.byteLength(file.content) };
}

export async function writeThreadMarkdown(ctx: ProductHttpContext, threadId: string, input: unknown): Promise<FsWriteResult> {
  const parsed = threadMarkdownWriteSchema.safeParse(input);
  if (!parsed.success || Buffer.byteLength(parsed.data.content) > 2_000_000) throw new ProjectFsError(400, 'invalid-request', 'Saving requires a bounded draft and its read revision.');
  const source = target(ctx, threadId, parsed.data.path, parsed.data.projectId);
  const result = await ctx.hostHub.callHostOnlineRpc<HostWriteFileResult>({ hostId: source.hostId, command: {
    type: 'host.write_file', rootPath: source.root, path: source.path, content: parsed.data.content,
    contentEncoding: 'utf8', createParents: false, expectedSha256: parsed.data.expectedSha256
  } });
  return result.outcome === 'conflict' ? { ok: false, message: 'This file changed on its machine. Review the latest version before saving.' } : { ok: true, sha256: result.sha256, bytes: result.sizeBytes };
}
