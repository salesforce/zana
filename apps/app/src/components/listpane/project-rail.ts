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
/**
 * Stable disclosure key for a project row in the Projects rail.
 * Primary-machine Default Project uses `local:<projectId>` so async host
 * hydration (which flips `machine.id` from `'local'` to `primary.id`)
 * never invalidates a user's saved expand/collapse state.
 */
export function projectRailDisclosureId(
  project: Project,
  machine?: { id: string; primary: boolean }
): string {
  if (!isScratchWorkspaceProject(project) || !machine) return project.id;
  return `${machine.primary ? 'local' : machine.id}:${project.id}`;
}

/**
 * Stable collapse-section key for a machine group in the Projects rail.
 * Primary machine uses `sidebar:machine:local` so async host hydration
 * never flips the section key from `local` to `primary.id`.
 */
export function machineSectionKey(machine: { id: string; primary: boolean }): string {
  return `sidebar:machine:${machine.primary ? 'local' : machine.id}`;
}
