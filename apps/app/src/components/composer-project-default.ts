import { DEFAULT_PROJECT_DISPLAY_NAME, type Project } from '@zana-ai/zcc-domain/product';

/** Folder basename of the built-in scratch workspace (`~/zcc-workspace`). */
export const SCRATCH_WORKSPACE_NAME = 'zcc-workspace';

/** Picker label for the scratch default when the user has not chosen a project. */
export const DEFAULT_COMPOSER_WORKSPACE_LABEL = DEFAULT_PROJECT_DISPLAY_NAME;

const SCRATCH_FOLDER_NAMES = new Set([SCRATCH_WORKSPACE_NAME, 'cc-workspace']);

export type ComposerProject = Pick<Project, 'id' | 'name' | 'quickAgent' | 'remote' | 'hostId'>;

/** SSH remotes and folders bound to a non-primary host daemon. */
export function isRemoteWorkspaceProject(
  project: Pick<ComposerProject, 'remote' | 'hostId'> | undefined
): boolean {
  return Boolean(project?.remote) || Boolean(project?.hostId);
}

export function isScratchWorkspaceProject(
  project: Pick<Project, 'name' | 'quickAgent'>
): boolean {
  return Boolean(project.quickAgent) || SCRATCH_FOLDER_NAMES.has(project.name);
}

export function scratchWorkspaceProject(
  projects: readonly ComposerProject[]
): ComposerProject | undefined {
  const local = projects.filter((project) => !isRemoteWorkspaceProject(project));
  return local.find((project) => project.quickAgent)
    ?? local.find((project) => project.name === SCRATCH_WORKSPACE_NAME);
}

export function composerProjectLabel(project: ComposerProject): string {
  return SCRATCH_FOLDER_NAMES.has(project.name) ? DEFAULT_COMPOSER_WORKSPACE_LABEL : project.name;
}

/** Local projects first, scratch first within each machine group; otherwise preserve order. */
export function composerProjectOptions<T extends Pick<Project, 'quickAgent' | 'remote' | 'hostId'>>(projects: readonly T[]): T[] {
  return [...projects].sort((left, right) =>
    Number(isRemoteWorkspaceProject(left)) - Number(isRemoteWorkspaceProject(right))
    || Number(Boolean(right.quickAgent)) - Number(Boolean(left.quickAgent)));
}

/**
 * Unpinned composer default: last-used local project, then local sidebar
 * selection. Remote projects require an explicit pick or pinned launch, so an
 * old remote sidebar selection cannot silently change the execution machine.
 * A pinned project-view launch never consults this — it passes
 * `pinnedId` into `resolveComposerProjectId` instead.
 */
export function preferredComposerProjectId(input: {
  projects: readonly ComposerProject[];
  lastProjectId?: string | null;
  selectedProjectId?: string | null;
}): string | undefined {
  return [input.lastProjectId, input.selectedProjectId].find((id): id is string =>
    Boolean(id && input.projects.some((project) => project.id === id && !isRemoteWorkspaceProject(project))));
}

/**
 * Default project for a new-thread composer. A pinned project always wins.
 * Otherwise keep a valid current pick, then a preferred id (last-used, then
 * sidebar selection), then the scratch workspace so an unselected composer
 * still has `zcc-workspace`.
 */
export function resolveComposerProjectId(
  projects: readonly ComposerProject[],
  currentId: string,
  pinnedId?: string,
  preferredId?: string | null
): string {
  if (pinnedId) return pinnedId;
  if (currentId && projects.some((project) => project.id === currentId)) return currentId;
  if (preferredId && projects.some((project) => project.id === preferredId)) return preferredId;
  return scratchWorkspaceProject(projects)?.id ?? '';
}

/** Optional controlled project pick shared across Modern / CLI Agent / Autonomous. */
export type ComposerProjectSelectionProps = {
  composerProjectId?: string;
  onComposerProjectIdChange?: (projectId: string) => void;
};
