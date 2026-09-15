import type { Project } from '@zana-ai/zcc-domain/product';
import { isScratchWorkspaceProject } from '../composer-project-default.js';

/** Keep the incoming relative order, but lift starred projects to the top. */
export function pinFavoriteProjectsFirst(projects: readonly Project[]): Project[] {
  const favorites: Project[] = [];
  const rest: Project[] = [];
  for (const project of projects) {
    if (project.favorite) favorites.push(project);
    else rest.push(project);
  }
  return [...favorites, ...rest];
}

/** Default Project stays the first row, ahead of stars and any chosen sort. */
export function pinDefaultProjectFirst(projects: readonly Project[]): Project[] {
  const defaults: Project[] = [];
  const rest: Project[] = [];
  for (const project of projects) {
    if (isScratchWorkspaceProject(project)) defaults.push(project);
    else rest.push(project);
  }
  return [...defaults, ...rest];
}

/**
 * Project-rail disclosure. An explicit user toggle always wins; otherwise
 * open the tree whenever there is something to nest (live agents or recent
 * threads) so those sessions are visible without a click.
 */
export function isProjectRailExpanded(
  explicit: boolean | undefined,
  hasNestedSessions: boolean
): boolean {
  return explicit ?? hasNestedSessions;
}
