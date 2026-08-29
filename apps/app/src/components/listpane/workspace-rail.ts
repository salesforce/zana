import type { Project } from '@zana-ai/zcc-domain/product';

/** Keep the incoming relative order, but lift starred workspaces to the top. */
export function pinFavoriteProjectsFirst(projects: readonly Project[]): Project[] {
  const favorites: Project[] = [];
  const rest: Project[] = [];
  for (const project of projects) {
    if (project.favorite) favorites.push(project);
    else rest.push(project);
  }
  return [...favorites, ...rest];
}

/**
 * Workspace-rail disclosure. An explicit user toggle always wins; otherwise
 * open the tree whenever there is something to nest (live agents or recent
 * threads) so those sessions are visible without a click.
 */
export function isWorkspaceRailExpanded(
  explicit: boolean | undefined,
  hasNestedSessions: boolean
): boolean {
  return explicit ?? hasNestedSessions;
}
