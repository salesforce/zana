import {
  composerProjectLabel,
  composerProjectOptions,
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
};

export function composerProjectPickerRows(
  projects: readonly ComposerProject[]
): ComposerProjectPickerRow[] {
  return [
    ...composerProjectOptions(projects).map((row) => ({
      value: row.id,
      label: composerProjectLabel(row)
    })),
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
