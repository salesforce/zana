export function libraryPanelSubPath({ scope, projectId, relPath }) {
  const safe = String(relPath ?? '')
    .split(/[/\\]/)
    .filter((part) => part.length > 0)
    .join('/');
  if (scope === 'global') return `global/${safe}`;
  const id = typeof projectId === 'string' && projectId.trim() ? projectId.trim() : '_';
  return `project/${id}/${safe}`;
}

export function parseLibraryPanelSubPath(subPath) {
  const parts = String(subPath ?? '')
    .split('/')
    .filter((part) => part.length > 0);
  if (parts[0] === 'global' && parts.length >= 2) {
    return { scope: 'global', relPath: parts.slice(1).join('/') };
  }
  if (parts[0] === 'project' && parts.length >= 3) {
    return { scope: 'project', projectId: parts[1], relPath: parts.slice(2).join('/') };
  }
  return null;
}
