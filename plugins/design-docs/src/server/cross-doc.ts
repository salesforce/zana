/**
 * Main-side resolution of `doc://` cross-doc links. The renderer's parse is
 * advisory; every call here re-validates the ref and path.
 *
 * Links resolve across projects: a link names a doc by id, and project is only
 * how docs are filed. The one exception is an unassigned received doc (foreign
 * project, not yet mapped): it is reachable only from itself and links to it
 * from elsewhere report `forbidden` until the user maps it to a project. The
 * caller id is renderer-supplied, so this is UX scoping, not an authorization
 * boundary. A doc may always link to itself.
 */
import { DesignDocPathError, normalizeDocPath } from '../shared/paths.js';
import type { DesignDocStore } from './store.js';

export type CrossDocError = 'missing-doc' | 'missing-file' | 'forbidden';
export type CrossDocTarget = { docId: string; path: string } | { error: CrossDocError };

export function resolveCrossDocTarget(
  store: DesignDocStore,
  docRef: string,
  path: string | null,
  caller: { docId: string }
): CrossDocTarget {
  const target = store.find(docRef);
  if (!target) return { error: 'missing-doc' };
  const source = store.find(caller.docId);
  if (!source) return { error: 'forbidden' };
  if (source.id !== target.id) {
    const from = store.scopeOf(source.id);
    const to = store.scopeOf(target.id);
    if (!from || !to || from.unassigned || to.unassigned) return { error: 'forbidden' };
  }
  let wanted = target.entryPath;
  if (path !== null) {
    try {
      wanted = normalizeDocPath(path);
    } catch (error) {
      if (error instanceof DesignDocPathError) return { error: 'missing-file' };
      throw error;
    }
  }
  const file = store.get(target.id).files.find((entry) => entry.path === wanted);
  return file ? { docId: target.id, path: file.path } : { error: 'missing-file' };
}
