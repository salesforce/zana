import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, normalize, resolve, win32 } from 'node:path';
import { resolveContained } from '@zana-ai/zcc-path-confine';

export const IMAGE_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;
export const FILE_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

const HEIF_IMAGE_MIME_TYPES = new Set([
  'image/heic',
  'image/heic-sequence',
  'image/heif',
  'image/heif-sequence'
]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
};

export class ProjectAttachmentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ProjectAttachmentError';
  }
}

export interface UploadedPromptAttachment {
  type: 'localImage' | 'localFile';
  path: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
}

export interface StoredAttachmentContent {
  content: Buffer;
  etag: string;
  mimeType?: string;
}

function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, '-');
  return base.length > 0 ? base : 'attachment';
}

function buildStoredFilename(originalName: string): string {
  const sanitized = sanitizeFilename(originalName);
  const extension = extname(sanitized);
  const stem = extension.length > 0 ? sanitized.slice(0, -extension.length) : sanitized;
  return `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
}

export function projectAttachmentDir(dataDir: string, projectId: string): string {
  return join(dataDir, 'attachments', projectId);
}

function resolveAttachmentPath(attachmentDir: string, relativePath: string): string {
  const normalizedRelativePath = normalize(relativePath.replaceAll('\\', '/'));
  const contained = resolveContained(resolve(attachmentDir), normalizedRelativePath);
  if (!contained || contained === resolve(attachmentDir)) {
    throw new ProjectAttachmentError(
      400,
      'invalid_request',
      'Attachment path must refer to a file inside the project directory'
    );
  }
  return contained;
}

export function pathLooksRuntimeReadable(rawPath: string): boolean {
  return (
    isAbsolute(rawPath)
    || win32.isAbsolute(rawPath)
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(rawPath)
  );
}

export function resolvePromptAttachmentPath(
  dataDir: string,
  projectId: string,
  rawPath: string
): string {
  if (pathLooksRuntimeReadable(rawPath)) return rawPath;
  return resolveAttachmentPath(projectAttachmentDir(dataDir, projectId), rawPath);
}

function isHeifImageUpload(mimeType: string): boolean {
  return HEIF_IMAGE_MIME_TYPES.has(mimeType.split(';')[0]?.trim().toLowerCase() ?? '');
}

function mimeFromName(name: string, fallback?: string): string | undefined {
  const ext = extname(name).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] ?? (fallback && fallback.length > 0 ? fallback : undefined);
}

export async function storeAttachment(
  dataDir: string,
  projectId: string,
  file: { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
): Promise<UploadedPromptAttachment> {
  if (file.name.trim().length === 0) {
    throw new ProjectAttachmentError(400, 'invalid_request', 'Attachment filename is required');
  }
  if (isHeifImageUpload(file.type)) {
    throw new ProjectAttachmentError(
      400,
      'invalid_request',
      'HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.'
    );
  }
  const isImage = (file.type || '').startsWith('image/') || Boolean(IMAGE_MIME_BY_EXT[extname(file.name).toLowerCase()]);
  const sizeLimit = isImage ? IMAGE_ATTACHMENT_LIMIT_BYTES : FILE_ATTACHMENT_LIMIT_BYTES;
  if (file.size > sizeLimit) {
    throw new ProjectAttachmentError(
      400,
      'invalid_request',
      `Attachment exceeds ${Math.floor(sizeLimit / (1024 * 1024))}MB limit`
    );
  }

  const dir = projectAttachmentDir(dataDir, projectId);
  await mkdir(dir, { recursive: true });
  const storedName = buildStoredFilename(file.name);
  const outputPath = join(dir, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(outputPath, bytes);

  return {
    type: isImage ? 'localImage' : 'localFile',
    path: storedName,
    name: file.name,
    mimeType: mimeFromName(file.name, file.type || undefined),
    sizeBytes: file.size
  };
}

export function localAttachmentMarker(args: {
  kind: 'image' | 'file';
  path: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
}): string {
  const namePart = args.name && args.name.length > 0 ? ` "${args.name}"` : '';
  const details: string[] = [];
  if (args.mimeType) details.push(args.mimeType);
  if (args.sizeBytes !== undefined) details.push(`${args.sizeBytes} bytes`);
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `[Attached ${args.kind}${namePart}${suffix}. It is on disk at ${args.path} — use the Read tool to view it.]`;
}

export function attachmentMarkersFromInput(
  promptInput: unknown,
  resolvePath: (path: string) => string
): string[] {
  if (!Array.isArray(promptInput)) return [];
  const markers: string[] = [];
  for (const part of promptInput) {
    if (!part || typeof part !== 'object' || !('type' in part)) continue;
    const type = (part as { type: unknown }).type;
    const path = (part as { path?: unknown }).path;
    if (typeof path !== 'string' || path.length === 0) continue;
    if (type === 'localImage') {
      markers.push(localAttachmentMarker({ kind: 'image', path: resolvePath(path) }));
    } else if (type === 'localFile') {
      const name = (part as { name?: unknown }).name;
      const mimeType = (part as { mimeType?: unknown }).mimeType;
      const sizeBytes = (part as { sizeBytes?: unknown }).sizeBytes;
      markers.push(localAttachmentMarker({
        kind: 'file',
        path: resolvePath(path),
        name: typeof name === 'string' ? name : undefined,
        mimeType: typeof mimeType === 'string' ? mimeType : undefined,
        sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : undefined
      }));
    }
  }
  return markers;
}

export function hostPromptFromInput(
  promptInput: unknown,
  flattened: readonly string[],
  resolvePath?: (path: string) => string
): string[] {
  const texts = flattened.map((part) => part.trim()).filter((part) => part.length > 0);
  const markers = resolvePath ? attachmentMarkersFromInput(promptInput, resolvePath) : [];
  return [...texts, ...markers];
}

export async function readAttachment(
  dataDir: string,
  projectId: string,
  relativePath: string
): Promise<StoredAttachmentContent> {
  const resolved = resolveAttachmentPath(projectAttachmentDir(dataDir, projectId), relativePath);
  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new ProjectAttachmentError(404, 'invalid_request', 'Attachment not found');
  }
  return {
    content: await readFile(resolved),
    etag: `"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`,
    mimeType: mimeFromName(resolved)
  };
}
