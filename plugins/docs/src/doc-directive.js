function isSafeRelPath(relPath) {
  const normalized = String(relPath).split('\\').join('/').trim();
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  const parts = normalized.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function parseDocDirectiveAttributes(attributes) {
  const rawPath = typeof attributes?.path === 'string' ? attributes.path.trim() : '';
  if (!isSafeRelPath(rawPath)) return null;
  const path = rawPath.split('\\').join('/');
  const title =
    typeof attributes?.title === 'string' && attributes.title.trim()
      ? attributes.title.trim()
      : path.split('/').pop() || path;
  const source =
    typeof attributes?.source === 'string' && attributes.source.trim().toLowerCase() === 'workspace'
      ? 'workspace'
      : 'library';
  const scopeRaw = typeof attributes?.scope === 'string' ? attributes.scope.trim().toLowerCase() : '';
  const scope = scopeRaw === 'global' ? 'global' : 'project';
  const vault =
    typeof attributes?.vault === 'string' && attributes.vault.trim() ? attributes.vault.trim() : null;
  return { path, title, source, scope, vault };
}
