const IMAGE_CONTENT_TYPES = new Set([
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
]);

export type HostImageFile = {
  contentType: string | null;
  content: string;
  encoding?: 'utf8' | 'base64';
};

export function imageContentTypeFromPath(path: string): string | null {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return null;
}

export function imagePreviewSrc(file: HostImageFile): string | null {
  if (!file.contentType || !IMAGE_CONTENT_TYPES.has(file.contentType)) return null;
  if (file.encoding === 'base64') {
    if (!file.content) return null;
    return `data:${file.contentType};base64,${file.content}`;
  }
  if (file.contentType === 'image/svg+xml') {
    return `data:image/svg+xml,${encodeURIComponent(file.content)}`;
  }
  return null;
}

export function resolveQuestionAnswer(draft: string, prompts: string[]): string {
  return draft.trim() || prompts[0] || '';
}
