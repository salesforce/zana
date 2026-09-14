import type { LibraryDoc, LibraryScope } from '@zana-ai/zcc-domain/product';

export interface LibraryDeepLink {
  scope: LibraryScope;
  projectId?: string;
  relPath: string;
}

/** Decode `/plugins/docs/panel/{global|project/<id>}/<relPath>`. */
export function parseLibraryPanelSubPath(subPath: string | undefined | null): LibraryDeepLink | null {
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

export function matchLibraryDeepLink(
  docs: readonly LibraryDoc[],
  link: LibraryDeepLink
): LibraryDoc | undefined {
  return docs.find((doc) => {
    if (doc.relPath !== link.relPath) return false;
    if (link.scope === 'global') return doc.scope !== 'project';
    return doc.scope === 'project' && doc.projectId === link.projectId;
  });
}
