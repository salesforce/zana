/**
 * Main-side resolution of `doc://` cross-doc links. The renderer's parse is
 * advisory; every call here re-validates the ref and path.
 *
 * Visibility rule (UX scoping, NOT an authorization boundary): `caller.docId`
 * is supplied by the renderer, so a compromised renderer can name any doc as
 * the caller. The rule only keeps links from crossing project boundaries in
 * normal use. The target must be in the caller's effective project (including a
 * project a received doc is mapped to) or genuinely global. A global caller
 * sees only global docs. Unassigned received docs (foreign project, unmapped)
 * are reachable only from themselves, and see only themselves. A doc may
 * always link to itself. Scope is computed by doc id on the server.
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
    if (!to.global && (from.projectId === null || to.projectId !== from.projectId)) return { error: 'forbidden' };
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
