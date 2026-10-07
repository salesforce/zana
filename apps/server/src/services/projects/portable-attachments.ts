import { readFile, stat, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { promptInputSchema, PROMPT_ATTACHMENT_MAX_BYTES, type PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import { projectAttachmentDir, pathLooksRuntimeReadable, resolveStoredAttachmentPath, storeAttachment } from './attachments.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';

/** Provenance is advisory until matched to main's project registry and confined storage. */
export async function normalizePortableAttachments(ctx: Pick<ProductHttpContext, 'dataDir' | 'toProjects'>, input: unknown, projectId: string, hostId: string): Promise<unknown> {
  if (!Array.isArray(input)) return input;
  const created: string[] = [];
  const copies = new Map<string, PromptInput>();
  try {
    const result: unknown[] = [];
    for (const value of input) {
      const parsed = promptInputSchema.safeParse(value);
      if (!parsed.success || (parsed.data.type !== 'localImage' && parsed.data.type !== 'localFile')) { result.push(value); continue; }
      const { sourceProjectId, hostId: sourceHost, ...part } = parsed.data;
      if (pathLooksRuntimeReadable(part.path)) {
        if (sourceProjectId || (sourceHost && sourceHost !== hostId)) throw new ThreadCreateError(400, 'attachment-host-mismatch', 'This attachment belongs to another machine. Upload it before sending.');
        result.push(part); continue;
      }
      if (sourceHost) throw new ThreadCreateError(400, 'invalid-attachment-source', 'Uploaded attachments must identify a project rather than a machine.');
      if (!sourceProjectId || sourceProjectId === projectId) { result.push(part); continue; }
      if (!ctx.toProjects().some(project => project.id === sourceProjectId)) throw new ThreadCreateError(404, 'unknown-project', 'Attachment source project is no longer registered.');
      const key = JSON.stringify([sourceProjectId, part.path, part.type]);
      let copy = copies.get(key);
      if (!copy) {
        resolveStoredAttachmentPath(ctx.dataDir, sourceProjectId, part.path);
        const source = await resolveContainedReal(projectAttachmentDir(ctx.dataDir, sourceProjectId), part.path);
        if (!source) throw new ThreadCreateError(400, 'invalid-attachment-source', 'Attachment path escapes its source project.');
        const metadata = await stat(source);
        if (!metadata.isFile() || metadata.size > PROMPT_ATTACHMENT_MAX_BYTES) throw new ThreadCreateError(400, 'invalid-attachment-source', 'Attachment is unavailable or too large.');
        const bytes = await readFile(source);
        if (bytes.length > PROMPT_ATTACHMENT_MAX_BYTES) throw new ThreadCreateError(400, 'invalid-attachment-source', 'Attachment is too large.');
        const uploaded = await storeAttachment(ctx.dataDir, projectId, { name: 'name' in part && part.name || basename(part.path), type: 'mimeType' in part && part.mimeType || (part.type === 'localImage' ? 'image/png' : 'application/octet-stream'), size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
        copy = { ...part, ...uploaded, type: part.type };
        created.push(resolveStoredAttachmentPath(ctx.dataDir, projectId, uploaded.path));
        copies.set(key, copy!);
      }
      result.push(copy);
    }
    return result;
  } catch (error) { await Promise.allSettled(created.map(path => unlink(path))); throw error; }
}
