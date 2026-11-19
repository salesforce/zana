import type { DesignDocStore } from './store.js';

/** The host caps a pinned item key at this many characters. */
export const MAX_PIN_ITEM_KEY_LENGTH = 256;

export interface ResolvedPin {
  available: boolean;
  title?: string;
}

/**
 * What a pinned tab may learn about a doc without opening its page: whether it
 * is still visible from `projectId` (the project's own docs, global docs and
 * received docs not yet mapped to a project, which the page lists everywhere)
 * and its current title. A missing, deleted or other-project doc is simply
 * unavailable, so the answer never confirms that it exists elsewhere.
 */
export function resolvePinnedDoc(store: DesignDocStore, projectId: string, itemKey: string): ResolvedPin {
  const scope = store.scopeOf(itemKey);
  if (!scope || (!scope.global && !scope.unassigned && scope.projectId !== projectId)) return { available: false };
  const doc = store.find(itemKey);
  return doc ? { available: true, title: doc.title } : { available: false };
}
