import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { posix, relative, sep } from 'node:path';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { getPrimaryHost } from '@zana-ai/zcc-db';
import { PROMPT_ATTACHMENT_MAX_BYTES, promptInputSchema } from '@zana-ai/zcc-domain/thread-runtime';
import type { HostWriteFileResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { HOST_DATA_DIR_PROBE_SLUG, hostDataDirFromCloneDefaultPath } from '../threads/worktree-paths.js';
import { pathLooksRuntimeReadable, projectAttachmentDir, resolvePromptAttachmentPath, resolveStoredAttachmentPath } from './attachments.js';

type HostAttachmentContext = Pick<ProductHttpContext, 'db' | 'dataDir' | 'hostHub'>;

function storedAttachmentPaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const paths = new Set<string>();
  for (const value of input) {
    const parsed = promptInputSchema.safeParse(value);
    if (!parsed.success || (parsed.data.type !== 'localImage' && parsed.data.type !== 'localFile')) continue;
    if (!pathLooksRuntimeReadable(parsed.data.path)) paths.add(parsed.data.path);
  }
  return [...paths];
}

function stageFailure(message: string): ThreadCreateError {
  return new ThreadCreateError(502, 'attachment-stage-failed', message);
}

/**
 * Uploaded attachments live in the server's data dir, which a remote machine
 * cannot read. Copy each one into that machine's own data dir (mirroring the
 * local `attachments/<projectId>/` layout) and resolve prompt paths there.
 * Paths are derived here from main's stored attachment, never from the caller.
 */
export async function attachmentPathResolverForHost(
  ctx: HostAttachmentContext,
  args: { hostId: string; projectId: string; input: unknown }
): Promise<(path: string) => string> {
  const local = (path: string) => resolvePromptAttachmentPath(ctx.dataDir, args.projectId, path);
  const stored = storedAttachmentPaths(args.input);
  if (stored.length === 0 || args.hostId === getPrimaryHost(ctx.db)?.id) return local;

  let remoteDataDir: string;
  try {
    const probe = await ctx.hostHub.callHostOnlineRpc<{ path: string }>({
      hostId: args.hostId,
      command: { type: 'project.clone_default_path', projectSlug: HOST_DATA_DIR_PROBE_SLUG }
    });
    remoteDataDir = hostDataDirFromCloneDefaultPath(probe.path);
  } catch (error) {
    throw stageFailure(`Could not prepare attachments on the remote machine: ${error instanceof Error ? error.message : String(error)}`);
  }

  const localDir = projectAttachmentDir(ctx.dataDir, args.projectId);
  const remoteDir = posix.join(remoteDataDir, 'attachments', args.projectId);
  const staged = new Map<string, string>();
  for (const path of stored) {
    const contained = resolveStoredAttachmentPath(ctx.dataDir, args.projectId, path);
    const source = await resolveContainedReal(localDir, path);
    if (!source) throw new ThreadCreateError(400, 'invalid-attachment-source', 'Attachment path escapes its project.');
    const metadata = await stat(source).catch(() => null);
    if (!metadata?.isFile() || metadata.size > PROMPT_ATTACHMENT_MAX_BYTES) {
      throw new ThreadCreateError(400, 'invalid-attachment-source', 'Attachment is unavailable or too large.');
    }
    const bytes = await readFile(source);
    const target = posix.join(remoteDir, ...relative(localDir, contained).split(sep));
    let result: HostWriteFileResult;
    try {
      result = await ctx.hostHub.callHostOnlineRpc<HostWriteFileResult>({
        hostId: args.hostId,
        command: {
          type: 'host.write_file',
          path: target,
          rootPath: remoteDataDir,
          content: bytes.toString('base64'),
          contentEncoding: 'base64',
          createParents: true,
          expectedSha256: null,
          mode: 0o600
        }
      });
    } catch (error) {
      throw stageFailure(`Could not copy ${posix.basename(target)} to the remote machine: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Stored names are unique, so an existing identical file is a re-send.
    if (result.outcome === 'conflict' && result.currentSha256 !== createHash('sha256').update(bytes).digest('hex')) {
      throw stageFailure(`A different file already exists at ${target} on the remote machine.`);
    }
    staged.set(path, target);
  }
  return (path) => staged.get(path) ?? local(path);
}
