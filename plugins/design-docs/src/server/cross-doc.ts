/**
 * Main-side resolution of `doc://` cross-doc links. The renderer's parse is
 * advisory; every call here re-validates the ref and path and decides whether
 * the calling doc may read the target.
 *
 * Visibility rule: the target must appear in the list the caller's own doc is
 * shown in, i.e. a doc in the caller's effective project (including a project
 * a received doc is mapped to) or a genuinely global doc. A global caller sees
 * only global docs. Unassigned received docs (foreign project, unmapped) are
 * visible only to themselves. A doc may always link to itself. Caller scope is
 * derived from the caller doc on the server, never from renderer input.
 */
import { MAX_LIST_LIMIT } from '../shared/limits.js';
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
    const scope = store.list({ query: source.slug, contents: false, limit: MAX_LIST_LIMIT }).find((row) => row.id === source.id);
    const visible = store.list({ projectId: scope?.projectId ?? null, query: target.slug, contents: false, limit: MAX_LIST_LIMIT });
    if (!visible.some((row) => row.id === target.id)) return { error: 'forbidden' };
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
