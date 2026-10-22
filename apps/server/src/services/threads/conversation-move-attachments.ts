import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, link, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { resolveContained, resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { PROMPT_ATTACHMENT_MAX_BYTES } from '@zana-ai/zcc-domain/thread-runtime';
import { listConversationThreadEventsWindow } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { pathLooksRuntimeReadable, resolveStoredAttachmentPath } from '../projects/attachments.js';

/** Copy only this conversation's uploaded attachments; keep their stable history paths. */
export async function copyMovedThreadAttachments(
  ctx: ProductHttpContext, threadId: string, from: string, to: string
): Promise<() => Promise<void>> {
  const created: string[] = [];
  const seen = new Set<string>();
  const cleanup = async () => { await Promise.allSettled(created.map(path => unlink(path))); };
  let beforeSeq: number | undefined;
  let bytes = 0;
  let scanned = 0;
  try {
    for (;;) {
      const rows = listConversationThreadEventsWindow(ctx.db, threadId, {
        type: 'client/turn/requested', limit: 50, beforeSeq, maxBytes: 2 * 1024 * 1024
      });
      if (rows.length === 0) break;
      scanned += rows.length;
      if (scanned > 10_000) throw new ThreadCreateError(413, 'move-history-too-large', 'This conversation is too large to move.');
      for (const row of rows) {
        const input = (row.payload as { input?: unknown[] } | null)?.input;
        for (const value of Array.isArray(input) ? input : []) {
          const part = value as { type?: string; path?: string } | null;
          if (!part || !['localImage', 'localFile'].includes(part.type ?? '') || typeof part.path !== 'string'
            || pathLooksRuntimeReadable(part.path) || seen.has(part.path)) continue;
          seen.add(part.path);
          if (basename(part.path) !== part.path || part.path.includes('\\')) {
            throw new ThreadCreateError(403, 'attachment-escape', 'Attachment path must be an uploaded filename.');
          }
          if (seen.size > 200) throw new ThreadCreateError(413, 'move-attachments-too-large', 'This conversation has too many attachments to move.');
          const attachmentRoot = join(ctx.dataDir, 'attachments');
          const sourceRoot = await resolveContainedReal(attachmentRoot, from);
          const source = sourceRoot && await resolveContainedReal(sourceRoot, part.path);
          if (!source) throw new ThreadCreateError(409, 'attachment-unavailable', 'A conversation attachment is no longer available.');
          const info = await stat(source);
          bytes += info.size;
          if (!info.isFile() || info.size > PROMPT_ATTACHMENT_MAX_BYTES || bytes > 100 * 1024 * 1024) {
            throw new ThreadCreateError(413, 'move-attachments-too-large', 'This conversation’s attachments are too large to move.');
          }
          const targetRoot = resolveContained(attachmentRoot, to);
          if (!targetRoot) throw new ThreadCreateError(403, 'attachment-escape', 'Attachment directory is outside the destination project.');
          await mkdir(targetRoot, { recursive: true });
          const parent = await resolveContainedReal(attachmentRoot, to);
          if (!parent) throw new ThreadCreateError(403, 'attachment-escape', 'Attachment directory is outside the destination project.');
          const destination = join(parent, basename(resolveStoredAttachmentPath(ctx.dataDir, to, part.path)));
          const temporary = `${destination}.${randomUUID()}.tmp`;
          try {
            await copyFile(source, temporary, constants.COPYFILE_EXCL);
            await chmod(temporary, 0o600);
            // Publishing with link is atomic and exclusive: a concurrent move cannot overwrite it.
            await link(temporary, destination);
            created.push(destination);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const existing = await resolveContainedReal(parent, part.path);
            if (!existing || (await stat(existing)).size !== info.size
              || !(await readFile(source)).equals(await readFile(existing))) {
              throw new ThreadCreateError(409, 'attachment-conflict', 'An attachment with this name already exists in the destination project.');
            }
          } finally {
            await unlink(temporary).catch(() => {});
          }
        }
      }
      beforeSeq = rows[0]!.sequence;
      await setImmediate();
    }
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
