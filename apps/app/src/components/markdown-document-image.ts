/** Resolve a Markdown image against its document, not the app URL or attachment store.
 * This is only path resolution; the file reader still authorizes and confines reads.
 */
export function resolveDocumentImagePath(documentPath: string, src: string): string | null {
  let path = src.trim();
  if (!path || path.startsWith('#') || path.startsWith('//')) return null;
  try {
    if (/^file:/iu.test(path)) {
      const url = new URL(path);
      if (url.hostname && url.hostname !== 'localhost') return null;
      path = decodeURIComponent(url.pathname);
    } else {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(path) && !/^[a-z]:[/\\]/iu.test(path)) return null;
      path = decodeURIComponent(path.split(/[?#]/u)[0]);
    }
  } catch {
    return null;
  }
  if (!path || path.includes('\0')) return null;
  path = path.replace(/\\/gu, '/');
  if (!path.startsWith('/') && !/^[a-z]:\//iu.test(path)) {
    const base = documentPath.replace(/\\/gu, '/');
    path = base.slice(0, base.lastIndexOf('/') + 1) + path;
  }
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '.') continue;
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..' && parts.at(-1) !== '' && !/^[a-z]:$/iu.test(parts.at(-1)!)) {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  // Preserve unresolved traversal so the authoritative reader rejects escapes.
  return parts.join('/');
}
