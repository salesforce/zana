export const DEFAULT_HEIGHT_PX = 224;
export const MIN_HEIGHT_PX = 120;
export const MAX_HEIGHT_PX = 1_200;
export const MAX_HTML_CHARS = 5 * 1024 * 1024;

export function parsePreviewHeight(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0) return DEFAULT_HEIGHT_PX;
  if (!/^\d+$/.test(normalized)) return null;
  const height = Number(normalized);
  return Number.isSafeInteger(height) && height >= MIN_HEIGHT_PX && height <= MAX_HEIGHT_PX
    ? height
    : null;
}

export function requireWorkspaceHtmlFile(value) {
  const file = typeof value === 'string' ? value.trim() : '';
  if (!file) return null;
  if (file.split(/[/\\]/).includes('..')) return null;
  if (file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file) || file.startsWith('\\\\')) return null;
  const slashNormalized = file.replace(/\\/g, '/');
  if (!/\.html?$/i.test(slashNormalized)) return null;
  return slashNormalized;
}

export function hostFileContentUrl(threadId, file) {
  const params = new URLSearchParams({ path: file });
  return `/api/v1/threads/${encodeURIComponent(threadId)}/host-files/content?${params.toString()}`;
}
