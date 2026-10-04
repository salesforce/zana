import { posix } from 'node:path';
import { z } from 'zod';
import { getConversationThread, getEnvironment, getPrimaryHost } from '@zana-ai/zcc-db';
import type { HostReadPathResult, HostWriteFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from './product-context.js';
import { projectFileRoot } from './project-fs-via-host.js';
import { isSafeRelPath } from './library-via-host.js';

// BB monaco-editor resolveTarget, with Zana's authoritative project/source gate.
const id = z.string().min(1).max(256);
const file = z.object({
  path: z.string().min(1).max(4096).refine(path => !/[\x00-\x1f]/.test(path)),
  source: z.object({ kind: z.enum(['workspace', 'host', 'thread-storage']), projectId: id.nullable(),
    environmentId: id.nullable(), threadId: id.nullable(), hostId: id.optional() }).strict()
}).strict();
const write = file.extend({ content: z.string().refine(value => Buffer.byteLength(value) <= 8 * 1024 * 1024), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() });
const unsupported = (message: string) => Object.assign(new Error(message), { code: 'unsupported' });

function resolveTarget(ctx: ProductHttpContext, input: z.infer<typeof file>) {
  const source = input.source;
  if (source.kind !== 'workspace' || !source.projectId) throw unsupported('This file is not a project file');
  const project = ctx.toProjects().find(row => row.id === source.projectId);
  if (!project) throw unsupported('This project is not registered');
  const thread = source.threadId ? getConversationThread(ctx.db, source.threadId) : null;
  if (source.threadId && (!thread || thread.projectId !== project.id)) throw new Error('File thread does not belong to the project');
  if (thread && source.environmentId && thread.environmentId !== source.environmentId) throw new Error('File environment does not belong to the thread');
  const environmentId = thread?.environmentId ?? source.environmentId;
  const environment = environmentId ? getEnvironment(ctx.db, environmentId) : null;
  if (environmentId && !environment) throw new Error('File environment is unavailable');
  const hostId = source.hostId ?? environment?.hostId ?? thread?.hostId ?? project.hostId ?? getPrimaryHost(ctx.db)?.id;
  if (!hostId) throw unsupported('This project has no execution machine');
  if (thread && thread.hostId !== hostId) throw new Error('File machine does not belong to the thread');
  const target = projectFileRoot(ctx, { projectId: project.id, hostId, ...(environmentId ? { environmentId } : {}) });
  const path = posix.resolve(target.root, input.path);
  const relPath = posix.relative(target.root, path);
  if (!isSafeRelPath(relPath)) throw new Error('File path is not inside the selected checkout');
  return { hostId, path, rootPath: target.root };
}

export async function readPluginProjectFile(ctx: ProductHttpContext, input: unknown): Promise<HostReadPathResult> {
  const target = resolveTarget(ctx, file.parse(input));
  return ctx.hostHub.callHostOnlineRpc({ hostId: target.hostId, command: { type: 'host.read_path', path: target.path, rootPath: target.rootPath } });
}

export async function writePluginProjectFile(ctx: ProductHttpContext, input: unknown): Promise<HostWriteFileResult> {
  const args = write.parse(input);
  const target = resolveTarget(ctx, args);
  return ctx.hostHub.callHostOnlineRpc({ hostId: target.hostId, command: { type: 'host.write_file',
    path: target.path, rootPath: target.rootPath, content: args.content, contentEncoding: 'utf8', expectedSha256: args.expectedSha256, createParents: true } });
}
