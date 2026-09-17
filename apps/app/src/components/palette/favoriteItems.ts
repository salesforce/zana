import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { favoriteKey, isThreadFavoriteKey } from '../../store.js';

/** Translate existing stars to palette keys. The item catalogue still controls visibility. */
export function favoritePaletteKeys(
  projects: readonly Project[], terminals: Readonly<Record<string, TerminalSession[]>>,
  favoriteIds: Readonly<Record<string, true>>
): ReadonlySet<string> {
  const keys = new Set(projects.filter((project) => project.favorite).map((project) => `project:${project.id}`));
  for (const key of Object.keys(favoriteIds)) {
    if (isThreadFavoriteKey(key)) keys.add(key);
  }
  for (const sessions of Object.values(terminals)) {
    for (const session of sessions) {
      if (favoriteIds[favoriteKey(session)]) keys.add(`tab:${session.id}`);
    }
  }
  return keys;
}
