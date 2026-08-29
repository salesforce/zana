const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif'];
const HEIF_MIME_TYPES = new Set([
  'image/heic',
  'image/heic-sequence',
  'image/heif',
  'image/heif-sequence'
]);

export const COMPOSER_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
export const COMPOSER_IMAGE_MAX_COUNT = 16;

export interface ComposerImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Disk path when the OS supplied one; uploaded attachment path after persist. */
  path: string | null;
  previewSrc: string;
  file: File;
}

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/u).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

export function isComposerImageMime(mimeType: string | undefined): boolean {
  const mime = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return mime.startsWith('image/') && !HEIF_MIME_TYPES.has(mime);
}

export function isHeifImageMime(mimeType: string | undefined): boolean {
  const mime = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return HEIF_MIME_TYPES.has(mime);
}

export function isComposerImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(name));
}

export function isComposerImageFile(file: { name: string; type: string }): boolean {
  if (isHeifImageMime(file.type)) return false;
  return isComposerImageMime(file.type) || isComposerImageName(file.name);
}

export function imageFilesFromList(files: readonly File[]): File[] {
  return files.filter((file) => isComposerImageFile(file));
}

export function imageFilesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const fromItems: File[] = [];
  const items = data.items;
  if (items) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item || item.kind !== 'file') continue;
      if (!isComposerImageMime(item.type) && !item.type.startsWith('image/')) continue;
      if (isHeifImageMime(item.type)) continue;
      const file = item.getAsFile();
      if (file && isComposerImageFile(file)) fromItems.push(file);
    }
  }
  if (fromItems.length > 0) return uniqueFiles(fromItems);
  return uniqueFiles(imageFilesFromList(Array.from(data.files ?? [])));
}

function uniqueFiles(files: File[]): File[] {
  const seen = new Set<File>();
  const unique: File[] = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    unique.push(file);
  }
  return unique;
}

export function filterNonImageDroppedPaths<T extends { name: string }>(paths: readonly T[]): T[] {
  return paths.filter((row) => !isComposerImageName(row.name));
}

/** Keep image paths as mentions when the drop had no File payload to preview. */
export function mentionPathsAfterImageAttach<T extends { name: string }>(
  paths: readonly T[],
  attachedImageFiles: readonly File[]
): T[] {
  if (attachedImageFiles.length === 0) return [...paths];
  return filterNonImageDroppedPaths(paths);
}

export function composerImageRejectReason(file: File): string | null {
  if (isHeifImageMime(file.type)) {
    return 'HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.';
  }
  if (!isComposerImageFile(file)) return 'Only image files can be attached as previews.';
  if (file.size > COMPOSER_IMAGE_LIMIT_BYTES) {
    return `Image exceeds ${Math.floor(COMPOSER_IMAGE_LIMIT_BYTES / (1024 * 1024))}MB limit`;
  }
  return null;
}

export function nextComposerImageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
