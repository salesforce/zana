import {
  composerProjectLabel,
  composerProjectOptions,
  isRemoteWorkspaceProject,
  scratchWorkspaceProject,
  type ComposerProject
} from './composer-project-default.js';

export const COMPOSER_NEW_PROJECT_VALUE = '__composer:new-project__';
export const COMPOSER_NO_PROJECT_VALUE = '__composer:no-project__';

export const COMPOSER_NEW_PROJECT_LABEL = 'New project';
export const COMPOSER_NO_PROJECT_LABEL = "Don't work in a project";

export type ComposerProjectPickerRow = {
  value: string;
  label: string;
  sticky?: boolean;
  action?: 'new-project' | 'no-project';
  remote?: boolean;
  description?: string;
};

/** Muted second line + search haystack for SSH-backed and host-bound projects. */
export function composerProjectRemoteDescription(
  project: Pick<ComposerProject, 'remote' | 'hostId'> | undefined
): string | undefined {
  const remote = project?.remote;
  const host = remote?.host?.trim();
  if (remote && host) {
    const user = remote.user?.trim();
    return `Remote · ${user ? `${user}@${host}` : host}`;
  }
  if (project?.hostId) return 'Remote machine';
  return undefined;
}

export function composerProjectPickerRows(
  projects: readonly ComposerProject[]
): ComposerProjectPickerRow[] {
  return [
    ...composerProjectOptions(projects).map((row) => {
      const description = composerProjectRemoteDescription(row);
      return {
        value: row.id,
        label: composerProjectLabel(row),
        ...(isRemoteWorkspaceProject(row) ? { remote: true as const, ...(description ? { description } : {}) } : {})
      };
    }),
    {
      value: COMPOSER_NEW_PROJECT_VALUE,
      label: COMPOSER_NEW_PROJECT_LABEL,
      sticky: true,
      action: 'new-project' as const
    },
    {
      value: COMPOSER_NO_PROJECT_VALUE,
      label: COMPOSER_NO_PROJECT_LABEL,
      sticky: true,
      action: 'no-project' as const
    }
  ];
}

export function resolveComposerProjectPickerChange(
  nextValue: string,
  projects: readonly ComposerProject[]
): { type: 'new-project' } | { type: 'project'; projectId: string } {
  if (nextValue === COMPOSER_NEW_PROJECT_VALUE) return { type: 'new-project' };
  if (nextValue === COMPOSER_NO_PROJECT_VALUE) {
    return { type: 'project', projectId: scratchWorkspaceProject(projects)?.id ?? '' };
  }
  return { type: 'project', projectId: nextValue };
}
